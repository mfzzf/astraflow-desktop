import { randomUUID } from "node:crypto"

import type { ChatReasoningEffort, SupportedChatModel } from "@/lib/chat-models"
import { shouldAdoptRuntimeSessionTitle } from "@/lib/studio-session-title"
import {
  createStudioMessage,
  abandonUndoneStudioWorkspaceHistoryTurns,
  getLatestStudioAcpSessionSelection,
  getLatestStudioAgentProviderSessionId,
  getStudioMessage,
  getStudioSession,
  listStudioMessages,
  recordStudioModelUsageRun,
  recordStudioWorkspaceHistoryTurn,
  recordStudioAgentProviderEvent,
  setStudioSessionAvailableCommands,
  updateStudioSessionLatestRunUsage,
  updateStudioSessionTitle,
  updateStudioMessageSnapshot,
} from "@/lib/studio-db"
import type {
  StudioChatRunLiveSnapshot,
  StudioChatRunSnapshot,
  StudioChatRunStatus,
  StudioMediaGenerationOutput,
  StudioMessageActivity,
  StudioMessagePart,
  StudioMessageStatus,
} from "@/lib/studio-types"
import type { AgentEvent } from "@/lib/agent/events"
import { agentContentBlockText } from "@/lib/agent/structured-content"
import {
  beginGitWorktreeSnapshot,
  finishGitWorktreeSnapshot,
} from "@/lib/agent/git-worktree-snapshot"
import {
  beginPiWorkspaceHistorySnapshot,
  finishPiWorkspaceHistorySnapshot,
} from "@/lib/agent/pi-workspace-history"
import { createStudioRunFileWorkspaceTarget } from "@/lib/studio-file-workspace"
import {
  mergeAgentUsageSnapshots,
  normalizeAgentUsage,
} from "@/lib/agent/usage"
import { getAgentRuntimeProviderMetadata } from "@/lib/agent/provider-metadata"
import type { AgentRunInput, AgentRuntime } from "@/lib/agent/runtime"

const STUDIO_CHAT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
// Keep the persisted database snapshot conservative, but publish the in-memory
// live view often enough that text visibly advances instead of arriving in
// 300 ms chunks. The renderer coalesces these snapshots on animation frames.
const LIVE_SNAPSHOT_INTERVAL_MS = 50
const SNAPSHOT_PERSIST_INTERVAL_MS = 350
const ABORT_WATCHDOG_TIMEOUT_MS = 30_000
const COMPLETED_RUN_RETENTION_MS = 5 * 60_000

type ChatStreamSnapshot = {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
  reasoningContent: string
  reasoningDurationMs: number | null
}

type StudioMediaGenerationPart = Extract<
  StudioMessagePart,
  { type: "media_generation" }
>
type StudioSubagentPart = Extract<StudioMessagePart, { type: "subagent" }>
type StudioFilePart = Extract<StudioMessagePart, { type: "file" }>

function getDiffStats(diff: string | null | undefined) {
  if (!diff) {
    return null
  }

  let additions = 0
  let deletions = 0

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue
    }

    if (line.startsWith("+")) {
      additions += 1
      continue
    }

    if (line.startsWith("-")) {
      deletions += 1
    }
  }

  return { additions, deletions }
}

type StudioChatRunRecord = StudioChatRunSnapshot & {
  abortWatchdogTimer: ReturnType<typeof setTimeout> | null
  abortController: AbortController
  cleanupTimer: ReturnType<typeof setTimeout> | null
  finalizeStoppedSnapshot: (() => ChatStreamSnapshot) | null
  finalizeWorktreeSnapshot: (() => Promise<void>) | null
  forceFinalized: boolean
  latestSnapshot: ChatStreamSnapshot
  liveMessageBase: ReturnType<typeof getStudioMessage>
  userMessageId: string | null
  livePublishTimer: ReturnType<typeof setTimeout> | null
  lastLivePublishedAt: number
  persistSnapshot:
    ((status?: StudioMessageStatus, force?: boolean) => void) | null
  promise: Promise<void> | null
}

export type StudioChatRunListener = (
  snapshot: StudioChatRunLiveSnapshot
) => void

declare global {
  var astraflowStudioChatRuns: Map<string, StudioChatRunRecord> | undefined
  var astraflowStudioChatRunListeners:
    Map<string, Set<StudioChatRunListener>> | undefined
}

function getStudioChatRuns() {
  if (!globalThis.astraflowStudioChatRuns) {
    globalThis.astraflowStudioChatRuns = new Map()
  }

  return globalThis.astraflowStudioChatRuns
}

function getStudioChatRunListeners() {
  if (!globalThis.astraflowStudioChatRunListeners) {
    globalThis.astraflowStudioChatRunListeners = new Map()
  }

  return globalThis.astraflowStudioChatRunListeners
}

function nowIso() {
  return new Date().toISOString()
}

function toRunSnapshot(record: StudioChatRunRecord): StudioChatRunSnapshot {
  return {
    runId: record.runId,
    sessionId: record.sessionId,
    assistantMessageId: record.assistantMessageId,
    status: record.status,
    error: record.error,
    usage: record.usage,
    startedAt: record.startedAt,
    updatedAt: record.updatedAt,
  }
}

function getLiveMessageStatus(
  record: StudioChatRunRecord
): StudioMessageStatus {
  if (record.status === "error") {
    return "error"
  }

  if (record.status === "complete" || record.status === "cancelled") {
    return "complete"
  }

  return "streaming"
}

function toRunLiveSnapshot(
  record: StudioChatRunRecord
): StudioChatRunLiveSnapshot {
  if (!record.liveMessageBase) {
    record.liveMessageBase = getStudioMessage(record.assistantMessageId)
  }

  const message = record.liveMessageBase
  const latest = record.latestSnapshot

  return {
    ...toRunSnapshot(record),
    message: message
      ? {
          ...message,
          content: latest.content,
          activities: latest.activities,
          parts: latest.parts,
          reasoningContent: latest.reasoningContent,
          reasoningDurationMs: latest.reasoningDurationMs,
          status: getLiveMessageStatus(record),
        }
      : null,
  }
}

function emitRunLiveSnapshot(record: StudioChatRunRecord) {
  record.lastLivePublishedAt = Date.now()

  const listeners = getStudioChatRunListeners().get(record.sessionId)

  if (!listeners || listeners.size === 0) {
    return
  }

  const snapshot = toRunLiveSnapshot(record)

  for (const listener of listeners) {
    try {
      listener(snapshot)
    } catch (error) {
      console.error("[studio-chat] live_listener_failed", error)
    }
  }
}

function scheduleRunLiveSnapshot(record: StudioChatRunRecord, force = false) {
  if (force) {
    if (record.livePublishTimer) {
      clearTimeout(record.livePublishTimer)
      record.livePublishTimer = null
    }

    emitRunLiveSnapshot(record)
    return
  }

  const elapsed = Date.now() - record.lastLivePublishedAt

  if (elapsed >= LIVE_SNAPSHOT_INTERVAL_MS) {
    emitRunLiveSnapshot(record)
    return
  }

  if (record.livePublishTimer) {
    return
  }

  record.livePublishTimer = setTimeout(() => {
    record.livePublishTimer = null
    emitRunLiveSnapshot(record)
  }, LIVE_SNAPSHOT_INTERVAL_MS - elapsed)
}

function setRunStatus(
  record: StudioChatRunRecord,
  status: StudioChatRunStatus,
  error: string | null = record.error
) {
  record.status = status
  record.error = error
  record.updatedAt = nowIso()
}

function clearAbortWatchdog(record: StudioChatRunRecord) {
  if (!record.abortWatchdogTimer) {
    return
  }

  clearTimeout(record.abortWatchdogTimer)
  record.abortWatchdogTimer = null
}

function removeRunRecord(record: StudioChatRunRecord) {
  const runs = getStudioChatRuns()

  if (runs.get(record.sessionId)?.runId === record.runId) {
    runs.delete(record.sessionId)
  }
}

function scheduleRunCleanup(record: StudioChatRunRecord) {
  if (record.cleanupTimer) {
    clearTimeout(record.cleanupTimer)
  }

  record.cleanupTimer = setTimeout(() => {
    clearAbortWatchdog(record)

    if (record.livePublishTimer) {
      clearTimeout(record.livePublishTimer)
      record.livePublishTimer = null
    }

    if (record.promise === null) {
      removeRunRecord(record)
    }
  }, COMPLETED_RUN_RETENTION_MS)
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function isAbortLikeError(error: unknown, signal?: AbortSignal) {
  const record = getRecord(error)
  const name = typeof record?.name === "string" ? record.name : ""
  const message = error instanceof Error ? error.message : String(error)

  return (
    Boolean(signal?.aborted) ||
    name === "AbortError" ||
    name === "ResponseAborted" ||
    message.includes("ResponseAborted") ||
    message.includes("aborted")
  )
}

function debugIgnoredAgentEvent(
  label: string,
  payload: Record<string, unknown>
) {
  if (!STUDIO_CHAT_DEBUG) {
    return
  }

  console.debug(`[studio-chat:event] ${label}`, payload)
}

function isMediaGenerationToolName(toolName: string) {
  return (
    toolName === "studio_generate_image" || toolName === "studio_generate_video"
  )
}

function parseMediaGenerationOutput(
  value: unknown
): StudioMediaGenerationOutput | null {
  const record = getRecord(value)

  if (!record) {
    return null
  }

  const id = typeof record.id === "string" ? record.id : ""
  const index = typeof record.index === "number" ? record.index : null
  const contentUrl =
    typeof record.contentUrl === "string" ? record.contentUrl : ""

  if (!id || index === null || !contentUrl) {
    return null
  }

  return {
    id,
    index,
    sessionFileId:
      typeof record.sessionFileId === "string" ? record.sessionFileId : null,
    contentUrl,
    url: typeof record.url === "string" ? record.url : null,
    storagePath:
      typeof record.storagePath === "string" ? record.storagePath : null,
    mimeType: typeof record.mimeType === "string" ? record.mimeType : null,
    width: typeof record.width === "number" ? record.width : null,
    height: typeof record.height === "number" ? record.height : null,
    durationSeconds:
      typeof record.durationSeconds === "number"
        ? record.durationSeconds
        : record.durationSeconds === null
          ? null
          : undefined,
  }
}

function parseMediaGenerationToolOutput(
  output: string,
  parentTaskId: string | null
): Extract<AgentEvent, { type: "media_generation" }> | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(output)
  } catch {
    return null
  }

  const record = getRecord(parsed)
  const model = getRecord(record?.model)
  const outputs = Array.isArray(record?.outputs)
    ? record.outputs
        .map(parseMediaGenerationOutput)
        .filter(isMediaGenerationOutput)
    : []

  if (
    !record ||
    (record.kind !== "image" && record.kind !== "video") ||
    typeof record.generationId !== "string" ||
    !record.generationId ||
    (record.status !== "queued" &&
      record.status !== "running" &&
      record.status !== "polling" &&
      record.status !== "complete" &&
      record.status !== "partial" &&
      record.status !== "error" &&
      record.status !== "cancelled") ||
    typeof record.prompt !== "string" ||
    typeof model?.name !== "string"
  ) {
    return null
  }

  return {
    type: "media_generation",
    kind: record.kind,
    generationId: record.generationId,
    status: record.status,
    modelName: model.name,
    prompt: record.prompt,
    phase: typeof record.phase === "string" ? record.phase : null,
    progress:
      typeof record.progress === "number" && Number.isFinite(record.progress)
        ? Math.min(Math.max(record.progress, 0), 1)
        : null,
    rawStatus: typeof record.rawStatus === "string" ? record.rawStatus : null,
    outputs,
    errorMessage:
      typeof record.errorMessage === "string" ? record.errorMessage : null,
    providerTaskId:
      typeof record.providerTaskId === "string" ? record.providerTaskId : null,
    providerRequestId:
      typeof record.providerRequestId === "string"
        ? record.providerRequestId
        : null,
    ...(parentTaskId ? { parentTaskId } : {}),
  }
}

function getProviderRefForAgentEvent(event: AgentEvent) {
  switch (event.type) {
    case "tool_call":
    case "tool_update":
    case "tool_result":
    case "tool_output":
    case "tool_input":
      return event.id
    case "subagent_start":
    case "subagent_update":
    case "subagent_end":
      return event.taskId
    case "permission_request":
      return event.requestId
    case "user_input_request":
      return event.requestId
    case "media_generation":
      return event.generationId
    case "file_change":
      return event.path
    case "file_changes_snapshot":
      return null
    case "available-commands":
      return null
    case "run_meta":
      return event.sessionRef ?? null
    case "assistant_retry":
      return event.messageId
    case "content_block":
      return event.messageId ?? null
    case "plan_remove":
      return event.planId
    case "plan_update":
      return event.planId ?? null
    case "text_delta":
    case "reasoning_delta":
    case "error":
      return null
  }
}

function recordStructuredAgentEvent({
  assistantMessageId,
  event,
  runId,
  runtimeId,
  sessionId,
}: {
  assistantMessageId: string
  event: AgentEvent
  runId: string
  runtimeId: string
  sessionId: string
}) {
  // Deltas and incremental tool output snapshots fire too frequently to be
  // worth persisting in the provider event log.
  if (
    event.type === "text_delta" ||
    event.type === "reasoning_delta" ||
    event.type === "tool_output" ||
    event.type === "tool_input"
  ) {
    return
  }

  try {
    const metadata = getAgentRuntimeProviderMetadata(runtimeId)
    const trace = event.trace

    recordStudioAgentProviderEvent({
      sessionId,
      runId,
      assistantMessageId,
      runtimeId,
      provider: trace?.provider ?? metadata?.provider ?? runtimeId,
      direction: "output",
      eventType: event.type,
      providerRef: getProviderRefForAgentEvent(event),
      providerSessionId:
        trace?.providerSessionId ??
        (event.type === "run_meta" ? (event.sessionRef ?? null) : null),
      threadId: trace?.threadId ?? null,
      turnId: trace?.turnId ?? null,
      itemId: trace?.itemId ?? null,
      parentThreadId: trace?.parentThreadId ?? null,
      schemaVersion: metadata?.schemaVersion ?? null,
      packageVersion: metadata?.packageVersion ?? null,
      payload: event,
    })
  } catch (error) {
    debugIgnoredAgentEvent("provider_event_log_failed", {
      eventType: event.type,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function createInitialSnapshot(): ChatStreamSnapshot {
  return {
    content: "",
    activities: [],
    parts: [],
    reasoningContent: "",
    reasoningDurationMs: null,
  }
}

function isActivityComplete(activity: StudioMessageActivity) {
  return activity.status !== "running"
}

function isMediaGenerationOutput(
  output: StudioMediaGenerationOutput | null
): output is StudioMediaGenerationOutput {
  return output !== null
}

function stopSubagentPart(part: StudioSubagentPart): StudioSubagentPart {
  if (part.status !== "running") {
    return {
      ...part,
      activities: part.activities.filter(isActivityComplete),
    }
  }

  return {
    ...part,
    status: "cancelled",
    activities: part.activities.filter(isActivityComplete),
  }
}

function failSubagentPart(
  part: StudioSubagentPart,
  message: string
): StudioSubagentPart {
  return {
    ...part,
    status: part.status === "running" ? "error" : part.status,
    error: part.status === "running" ? (part.error ?? message) : part.error,
    activities: part.activities.map((activity) =>
      activity.status === "running"
        ? {
            ...activity,
            status: "error" as const,
            error: activity.error ?? message,
          }
        : activity
    ),
  }
}

function toStoppedSnapshot(snapshot: ChatStreamSnapshot): ChatStreamSnapshot {
  const stoppedActivities = snapshot.activities.map((activity) =>
    activity.status === "running"
      ? {
          ...activity,
          status: "error" as const,
          acpStatus: "failed" as const,
          error: activity.error ?? "Cancelled before the tool call completed.",
        }
      : activity
  )
  const stoppedActivityById = new Map(
    stoppedActivities.map((activity) => [activity.id, activity])
  )

  const parts = snapshot.parts
    .map((part) => {
      if (part.type === "permission" && part.status === "pending") {
        return { ...part, status: "cancelled" as const }
      }

      if (part.type === "user_input" && part.status === "pending") {
        return { ...part, status: "cancelled" as const }
      }

      if (part.type === "subagent") {
        return stopSubagentPart(part)
      }

      if (part.type === "tool") {
        return {
          ...part,
          activity: stoppedActivityById.get(part.activity.id) ?? part.activity,
        }
      }

      return part
    })
    .filter((part) => {
      if (
        part.type === "text" ||
        part.type === "content" ||
        part.type === "reasoning" ||
        part.type === "plan" ||
        part.type === "permission" ||
        part.type === "user_input" ||
        part.type === "subagent" ||
        part.type === "file" ||
        part.type === "media_generation"
      ) {
        return true
      }

      if (part.type === "tool") {
        return true
      }

      return false
    })

  return {
    ...snapshot,
    activities: stoppedActivities,
    parts,
  }
}

function finalizeStoppedSnapshot(record: StudioChatRunRecord) {
  const snapshot =
    record.finalizeStoppedSnapshot?.() ??
    toStoppedSnapshot(record.latestSnapshot)

  record.latestSnapshot = snapshot

  return snapshot
}

function persistRunSnapshot(
  record: StudioChatRunRecord,
  status: StudioMessageStatus,
  force = false
) {
  if (record.persistSnapshot) {
    record.persistSnapshot(status, force)
    return
  }

  persistAssistantSnapshot({
    assistantMessageId: record.assistantMessageId,
    sessionId: record.sessionId,
    snapshot: record.latestSnapshot,
    status,
  })
  scheduleRunLiveSnapshot(record, force)
}

async function forceFinalizeAbortedRun(record: StudioChatRunRecord) {
  record.abortWatchdogTimer = null

  if (
    record.forceFinalized ||
    record.promise === null ||
    !record.abortController.signal.aborted
  ) {
    return
  }

  await record.finalizeWorktreeSnapshot?.()

  if (
    record.forceFinalized ||
    record.promise === null ||
    !record.abortController.signal.aborted
  ) {
    return
  }

  finalizeStoppedSnapshot(record)
  setRunStatus(record, "cancelled")
  persistRunSnapshot(record, "complete", true)
  record.forceFinalized = true
  record.promise = null
  record.persistSnapshot = null
  record.finalizeStoppedSnapshot = null
  record.finalizeWorktreeSnapshot = null

  if (record.cleanupTimer) {
    clearTimeout(record.cleanupTimer)
    record.cleanupTimer = null
  }

  removeRunRecord(record)
}

function scheduleAbortWatchdog(record: StudioChatRunRecord) {
  if (record.abortWatchdogTimer || record.promise === null) {
    return
  }

  record.abortWatchdogTimer = setTimeout(
    () => void forceFinalizeAbortedRun(record),
    ABORT_WATCHDOG_TIMEOUT_MS
  )
}

export function createSnapshotAccumulator() {
  let snapshot = createInitialSnapshot()
  let activeReasoningPartId: string | null = null
  let activeReasoningStartedAt: number | null = null
  let hasAuthoritativeFileSnapshot = false
  let totalReasoningDurationMs = 0
  const partMessageIds = new Map<string, string>()

  function markReasoningDone() {
    if (!activeReasoningPartId || activeReasoningStartedAt === null) {
      return false
    }

    const durationMs = Math.max(
      1000,
      Math.round(Date.now() - activeReasoningStartedAt)
    )
    totalReasoningDurationMs += durationMs
    snapshot = {
      ...snapshot,
      reasoningDurationMs: totalReasoningDurationMs,
      parts: snapshot.parts.map((part) =>
        part.type === "reasoning" && part.id === activeReasoningPartId
          ? { ...part, durationMs }
          : part
      ),
    }
    activeReasoningPartId = null
    activeReasoningStartedAt = null

    return true
  }

  function appendReasoningPart(delta: string, messageId?: string) {
    if (!delta) {
      return false
    }

    const lastPart = snapshot.parts.at(-1)

    if (
      lastPart?.type === "reasoning" &&
      lastPart.durationMs === null &&
      (lastPart.messageId ?? partMessageIds.get(lastPart.id)) === messageId
    ) {
      if (!activeReasoningPartId) {
        activeReasoningPartId = lastPart.id
      }

      if (activeReasoningStartedAt === null) {
        activeReasoningStartedAt = Date.now()
      }

      snapshot = {
        ...snapshot,
        reasoningContent: snapshot.reasoningContent + delta,
        parts: [
          ...snapshot.parts.slice(0, -1),
          { ...lastPart, content: lastPart.content + delta },
        ],
      }
      return true
    }

    const partId = randomUUID()
    if (messageId) {
      partMessageIds.set(partId, messageId)
    }
    activeReasoningPartId = partId
    activeReasoningStartedAt = Date.now()
    snapshot = {
      ...snapshot,
      reasoningContent: snapshot.reasoningContent + delta,
      parts: [
        ...snapshot.parts,
        {
          id: partId,
          type: "reasoning",
          content: delta,
          durationMs: null,
          messageId: messageId ?? null,
        },
      ],
    }

    return true
  }

  function appendTextPart(
    delta: string,
    messageId?: string,
    phase?: Extract<AgentEvent, { type: "text_delta" }>["phase"]
  ) {
    if (!delta) {
      return false
    }

    const lastPart = snapshot.parts.at(-1)

    if (
      lastPart?.type === "text" &&
      (lastPart.messageId ?? partMessageIds.get(lastPart.id)) === messageId &&
      (lastPart.phase ?? undefined) === phase
    ) {
      snapshot = {
        ...snapshot,
        content: snapshot.content + delta,
        parts: [
          ...snapshot.parts.slice(0, -1),
          { ...lastPart, content: lastPart.content + delta },
        ],
      }
      return true
    }

    const partId = randomUUID()
    if (messageId) {
      partMessageIds.set(partId, messageId)
    }
    snapshot = {
      ...snapshot,
      content: snapshot.content + delta,
      parts: [
        ...snapshot.parts,
        {
          id: partId,
          type: "text",
          content: delta,
          messageId: messageId ?? null,
          phase: phase ?? null,
        },
      ],
    }

    return true
  }

  function appendContentBlock(
    event: Extract<AgentEvent, { type: "content_block" }>
  ) {
    const text = agentContentBlockText(event.content)
    const channel = event.channel ?? "message"

    if (channel === "message") {
      markReasoningDone()
    }

    const lastPart = snapshot.parts.at(-1)

    if (
      text &&
      event.content.type === "text" &&
      lastPart?.type === "content" &&
      lastPart.content.type === "text" &&
      (lastPart.messageId ?? undefined) === event.messageId &&
      (lastPart.channel ?? "message") === channel &&
      (lastPart.phase ?? undefined) === event.phase &&
      JSON.stringify(lastPart.content.annotations ?? null) ===
        JSON.stringify(event.content.annotations ?? null) &&
      JSON.stringify(lastPart.content._meta ?? null) ===
        JSON.stringify(event.content._meta ?? null)
    ) {
      const content = {
        ...lastPart.content,
        text: lastPart.content.text + text,
      }

      snapshot = {
        ...snapshot,
        ...(channel === "thought"
          ? { reasoningContent: snapshot.reasoningContent + text }
          : { content: snapshot.content + text }),
        parts: [...snapshot.parts.slice(0, -1), { ...lastPart, content }],
      }
      return true
    }

    const part: StudioMessagePart = {
      id: randomUUID(),
      type: "content",
      content: event.content,
      messageId: event.messageId ?? null,
      channel,
      phase: event.phase ?? null,
    }

    snapshot = {
      ...snapshot,
      ...(text
        ? channel === "thought"
          ? { reasoningContent: snapshot.reasoningContent + text }
          : { content: snapshot.content + text }
        : {}),
      parts: [...snapshot.parts, part],
    }

    return true
  }

  function handleAssistantRetry(
    event: Extract<AgentEvent, { type: "assistant_retry" }>
  ) {
    if (event.phase !== "start") {
      return false
    }

    const removedIds = new Set(
      snapshot.parts
        .filter(
          (part) =>
            (part.type === "text" ||
              part.type === "reasoning" ||
              part.type === "content") &&
            (part.messageId ?? partMessageIds.get(part.id)) === event.messageId
        )
        .map((part) => part.id)
    )

    if (removedIds.size === 0) {
      return false
    }

    for (const partId of removedIds) {
      partMessageIds.delete(partId)
    }

    if (activeReasoningPartId && removedIds.has(activeReasoningPartId)) {
      activeReasoningPartId = null
      activeReasoningStartedAt = null
    }

    const parts = snapshot.parts.filter((part) => !removedIds.has(part.id))
    totalReasoningDurationMs = parts
      .filter((part) => part.type === "reasoning")
      .reduce((total, part) => total + (part.durationMs ?? 0), 0)
    snapshot = {
      ...snapshot,
      content: parts
        .flatMap((part) => {
          if (part.type === "text") {
            return [part.content]
          }

          return part.type === "content" &&
            (part.channel ?? "message") === "message"
            ? [agentContentBlockText(part.content)]
            : []
        })
        .join(""),
      reasoningContent: parts
        .flatMap((part) => {
          if (part.type === "reasoning") {
            return [part.content]
          }

          return part.type === "content" && part.channel === "thought"
            ? [agentContentBlockText(part.content)]
            : []
        })
        .join(""),
      reasoningDurationMs: totalReasoningDurationMs,
      parts,
    }

    return true
  }

  function upsertToolPart(activity: StudioMessageActivity) {
    const existingIndex = snapshot.parts.findIndex(
      (part) => part.type === "tool" && part.activity.id === activity.id
    )

    if (existingIndex < 0) {
      snapshot = {
        ...snapshot,
        parts: [
          ...snapshot.parts,
          {
            id: activity.id,
            type: "tool",
            activity,
          },
        ],
      }
      return
    }

    snapshot = {
      ...snapshot,
      parts: snapshot.parts.map((part, index) =>
        index === existingIndex && part.type === "tool"
          ? { ...part, activity }
          : part
      ),
    }
  }

  function applyToolEventDetails(
    activity: StudioMessageActivity,
    event: Extract<
      AgentEvent,
      {
        type:
          | "tool_call"
          | "tool_update"
          | "tool_result"
          | "tool_output"
          | "tool_input"
      }
    >
  ): StudioMessageActivity {
    return {
      ...activity,
      ...(Object.hasOwn(event, "title") ? { title: event.title } : {}),
      ...(Object.hasOwn(event, "kind") ? { kind: event.kind } : {}),
      ...(Object.hasOwn(event, "acpStatus")
        ? { acpStatus: event.acpStatus }
        : {}),
      ...(Object.hasOwn(event, "locations")
        ? { locations: event.locations }
        : {}),
      ...(Object.hasOwn(event, "content") ? { content: event.content } : {}),
      ...(Object.hasOwn(event, "rawInput") ? { rawInput: event.rawInput } : {}),
      ...(Object.hasOwn(event, "rawOutput")
        ? { rawOutput: event.rawOutput }
        : {}),
      ...(Object.hasOwn(event, "meta") ? { meta: event.meta } : {}),
    }
  }

  function activityStatusFromAcpStatus(
    status: Extract<AgentEvent, { type: "tool_update" }>["acpStatus"],
    fallback: StudioMessageActivity["status"]
  ): StudioMessageActivity["status"] {
    if (status === "completed") {
      return "complete"
    }

    if (status === "failed") {
      return "error"
    }

    if (status === "pending" || status === "in_progress") {
      return "running"
    }

    return fallback
  }

  function upsertSubagentPart(update: {
    taskId: string
    name?: string
    status?: StudioSubagentPart["status"]
    taskInput?: string
    content?: string
    contentDelta?: string
    summary?: string
    error?: string
    todos?: StudioSubagentPart["todos"]
    parentTaskId?: string | null
    providerThreadId?: string | null
    providerParentThreadId?: string | null
    agentId?: string | null
    nickname?: string | null
    role?: string | null
    model?: string | null
    effort?: string | null
    background?: boolean | null
  }) {
    markReasoningDone()

    const existingIndex = snapshot.parts.findIndex(
      (part) => part.type === "subagent" && part.taskId === update.taskId
    )
    const existingPart =
      existingIndex >= 0 ? snapshot.parts[existingIndex] : null
    const current: StudioSubagentPart =
      existingPart?.type === "subagent"
        ? existingPart
        : {
            id: `subagent:${update.taskId}`,
            type: "subagent",
            taskId: update.taskId,
            name: update.name ?? update.taskId,
            status: "running",
            taskInput: "",
            content: "",
            summary: null,
            error: null,
            todos: [],
            activities: [],
            parentTaskId: null,
            providerThreadId: null,
            providerParentThreadId: null,
            agentId: null,
            nickname: null,
            role: null,
            model: null,
            effort: null,
            background: null,
          }

    const part: StudioSubagentPart = {
      ...current,
      name: update.name ?? current.name,
      status: update.status ?? current.status,
      taskInput: update.taskInput ?? current.taskInput,
      content: update.content ?? current.content + (update.contentDelta ?? ""),
      summary: update.summary ?? current.summary,
      error: update.error ?? current.error,
      todos: update.todos ?? current.todos,
      parentTaskId: update.parentTaskId ?? current.parentTaskId ?? null,
      providerThreadId:
        update.providerThreadId ?? current.providerThreadId ?? null,
      providerParentThreadId:
        update.providerParentThreadId ?? current.providerParentThreadId ?? null,
      agentId: update.agentId ?? current.agentId ?? null,
      nickname: update.nickname ?? current.nickname ?? null,
      role: update.role ?? current.role ?? null,
      model: update.model ?? current.model ?? null,
      effort: update.effort ?? current.effort ?? null,
      background: update.background ?? current.background ?? null,
    }

    snapshot = {
      ...snapshot,
      parts:
        existingIndex >= 0
          ? snapshot.parts.map((candidate, index) =>
              index === existingIndex ? part : candidate
            )
          : [...snapshot.parts, part],
    }

    return true
  }

  function upsertSubagentActivity(
    taskId: string,
    activity: StudioMessageActivity
  ) {
    const childActivity: StudioMessageActivity = {
      ...activity,
      parentTaskId: activity.parentTaskId ?? taskId,
    }

    upsertSubagentPart({ taskId })

    snapshot = {
      ...snapshot,
      parts: snapshot.parts.map((part) => {
        if (part.type !== "subagent" || part.taskId !== taskId) {
          return part
        }

        const existingIndex = part.activities.findIndex(
          (candidate) => candidate.id === childActivity.id
        )

        return {
          ...part,
          activities:
            existingIndex >= 0
              ? part.activities.map((candidate, index) =>
                  index === existingIndex ? childActivity : candidate
                )
              : [...part.activities, childActivity],
        }
      }),
    }
  }

  function closeSubagentActivities(
    taskId: string,
    status: "complete" | "error" | "cancelled",
    message?: string
  ) {
    if (status === "cancelled") {
      snapshot = {
        ...snapshot,
        activities: snapshot.activities.filter(
          (activity) =>
            activity.parentTaskId !== taskId || activity.status !== "running"
        ),
        parts: snapshot.parts.map((part) =>
          part.type === "subagent" && part.taskId === taskId
            ? {
                ...part,
                activities: part.activities.filter(isActivityComplete),
              }
            : part
        ),
      }
      return
    }

    const closeActivity = (activity: StudioMessageActivity) => {
      if (activity.status !== "running") {
        return activity
      }

      if (status === "error") {
        return {
          ...activity,
          status,
          error: activity.error ?? message ?? "Subagent failed.",
        }
      }

      return {
        ...activity,
        status,
        error: null,
      }
    }

    snapshot = {
      ...snapshot,
      activities: snapshot.activities.map((activity) =>
        activity.parentTaskId === taskId ? closeActivity(activity) : activity
      ),
      parts: snapshot.parts.map((part) =>
        part.type === "subagent" && part.taskId === taskId
          ? {
              ...part,
              activities: part.activities.map(closeActivity),
            }
          : part
      ),
    }
  }

  function toFilePart(
    event: Extract<AgentEvent, { type: "file_change" }>,
    existing: StudioFilePart | null = null
  ): StudioFilePart {
    const status = event.status ?? (event.error ? "error" : "complete")
    const action =
      event.kind === "create"
        ? "Created"
        : event.kind === "edit"
          ? "Edited"
          : "Deleted"
    const content =
      status === "error"
        ? `Failed to ${event.kind} ${event.path}`
        : `${action} ${event.path}`
    const diff = event.diff?.trim() || existing?.diff?.trim() || null

    return {
      id: existing?.id ?? randomUUID(),
      type: "file",
      path: event.path,
      kind: event.kind,
      status,
      error: event.error ?? null,
      content,
      diff,
      stats: getDiffStats(diff),
      parentTaskId: event.parentTaskId ?? null,
    }
  }

  function appendFilePart(event: Extract<AgentEvent, { type: "file_change" }>) {
    if (hasAuthoritativeFileSnapshot) {
      return false
    }

    markReasoningDone()

    const existingIndex = snapshot.parts.findIndex(
      (part) =>
        part.type === "file" &&
        part.path === event.path &&
        (part.parentTaskId ?? null) === (event.parentTaskId ?? null)
    )
    const existing =
      existingIndex >= 0 && snapshot.parts[existingIndex].type === "file"
        ? (snapshot.parts[existingIndex] as StudioFilePart)
        : null
    const nextPart = toFilePart(event, existing)

    snapshot = {
      ...snapshot,
      parts:
        existingIndex >= 0
          ? snapshot.parts.map((part, index) =>
              index === existingIndex ? nextPart : part
            )
          : [...snapshot.parts, nextPart],
    }

    return true
  }

  function replaceFileParts(
    event: Extract<AgentEvent, { type: "file_changes_snapshot" }>
  ) {
    markReasoningDone()
    hasAuthoritativeFileSnapshot = true

    const existingByPath = new Map(
      snapshot.parts.flatMap((part) =>
        part.type === "file" ? ([[part.path, part]] as const) : []
      )
    )
    const changesByPath = new Map(
      event.changes.map((change) => [change.path, change] as const)
    )
    const fileParts = Array.from(changesByPath.values()).map((change) =>
      toFilePart(change, existingByPath.get(change.path) ?? null)
    )

    snapshot = {
      ...snapshot,
      parts: [
        ...snapshot.parts.filter((part) => part.type !== "file"),
        ...fileParts,
      ],
    }

    return true
  }

  function upsertMediaGenerationPart(
    event: Extract<AgentEvent, { type: "media_generation" }>
  ) {
    markReasoningDone()

    const existingIndex = snapshot.parts.findIndex(
      (part) =>
        part.type === "media_generation" &&
        part.generationId === event.generationId
    )
    const existingPart =
      existingIndex >= 0 ? snapshot.parts[existingIndex] : null
    const current: StudioMediaGenerationPart =
      existingPart?.type === "media_generation"
        ? existingPart
        : {
            id: `media:${event.generationId}`,
            type: "media_generation",
            kind: event.kind,
            generationId: event.generationId,
            status: event.status,
            modelName: event.modelName,
            prompt: event.prompt,
            phase: event.phase ?? null,
            progress: event.progress ?? null,
            rawStatus: event.rawStatus ?? null,
            outputs: [],
            errorMessage: null,
            providerTaskId: null,
            providerRequestId: null,
            parentTaskId: null,
          }
    const part: StudioMediaGenerationPart = {
      ...current,
      kind: event.kind,
      status: event.status,
      modelName: event.modelName || current.modelName,
      prompt: event.prompt || current.prompt,
      phase: event.phase ?? current.phase ?? null,
      progress:
        typeof event.progress === "number" &&
        typeof current.progress === "number"
          ? Math.max(event.progress, current.progress)
          : (event.progress ?? current.progress ?? null),
      rawStatus: event.rawStatus ?? current.rawStatus ?? null,
      outputs: event.outputs,
      errorMessage: event.errorMessage ?? current.errorMessage,
      providerTaskId: event.providerTaskId ?? current.providerTaskId ?? null,
      providerRequestId:
        event.providerRequestId ?? current.providerRequestId ?? null,
      parentTaskId: event.parentTaskId ?? current.parentTaskId ?? null,
    }

    snapshot = {
      ...snapshot,
      parts:
        existingIndex >= 0
          ? snapshot.parts.map((candidate, index) =>
              index === existingIndex ? part : candidate
            )
          : [...snapshot.parts, part],
    }

    return true
  }

  function upsertPlanPart(event: Extract<AgentEvent, { type: "plan_update" }>) {
    markReasoningDone()

    const planId = event.planId?.trim() || null
    const existingIndex = snapshot.parts.findIndex(
      (part) => part.type === "plan" && (part.planId ?? null) === planId
    )
    const existingPart =
      existingIndex >= 0 ? snapshot.parts[existingIndex] : null
    const existingVariant =
      existingPart?.type === "plan" ? (existingPart.variant ?? "items") : null
    const variant = event.variant ?? existingVariant ?? "items"
    const part: StudioMessagePart = {
      id: existingIndex >= 0 ? snapshot.parts[existingIndex].id : randomUUID(),
      type: "plan",
      content:
        event.content ??
        (existingPart?.type === "plan" && existingVariant === variant
          ? existingPart.content
          : ""),
      todos: event.todos,
      planId,
      variant,
      uri:
        event.uri ??
        (existingPart?.type === "plan" && existingVariant === variant
          ? existingPart.uri
          : null) ??
        null,
      meta:
        event.meta !== undefined
          ? event.meta
          : existingPart?.type === "plan" && existingVariant === variant
            ? (existingPart.meta ?? null)
            : null,
    }

    snapshot = {
      ...snapshot,
      parts:
        existingIndex >= 0
          ? snapshot.parts.map((candidate, index) =>
              index === existingIndex ? part : candidate
            )
          : [...snapshot.parts, part],
    }

    return true
  }

  function removePlanPart(planId: string) {
    const normalizedPlanId = planId.trim() || planId
    const nextParts = snapshot.parts.filter(
      (part) =>
        part.type !== "plan" || (part.planId ?? null) !== normalizedPlanId
    )

    if (nextParts.length === snapshot.parts.length) {
      return false
    }

    snapshot = { ...snapshot, parts: nextParts }
    return true
  }

  function getPermissionPartStatus(
    event: Extract<AgentEvent, { type: "permission_request" }>
  ): Extract<StudioMessagePart, { type: "permission" }>["status"] {
    if (event.status !== "resolved") {
      return "pending"
    }

    if (!event.selectedOptionId) {
      return "cancelled"
    }

    const selectedOption = event.options?.find(
      (option) => option.optionId === event.selectedOptionId
    )

    return selectedOption?.kind.startsWith("allow") ? "approved" : "denied"
  }

  function upsertPermissionPart(
    event: Extract<AgentEvent, { type: "permission_request" }>
  ) {
    markReasoningDone()

    const existingIndex = snapshot.parts.findIndex(
      (part) => part.type === "permission" && part.id === event.requestId
    )
    const existingPart =
      existingIndex >= 0 ? snapshot.parts[existingIndex] : null
    const options =
      event.options ??
      (existingPart?.type === "permission" ? existingPart.options : [])
    const part: StudioMessagePart = {
      id: event.requestId,
      type: "permission",
      toolName:
        event.toolName ||
        (existingPart?.type === "permission" ? existingPart.toolName : ""),
      input:
        event.input ||
        (existingPart?.type === "permission" ? existingPart.input : ""),
      status: getPermissionPartStatus(event),
      options,
      selectedOptionId:
        event.selectedOptionId ??
        (existingPart?.type === "permission"
          ? existingPart.selectedOptionId
          : null),
    }

    snapshot = {
      ...snapshot,
      parts:
        existingIndex >= 0
          ? snapshot.parts.map((candidate, index) =>
              index === existingIndex ? part : candidate
            )
          : [...snapshot.parts, part],
    }

    return true
  }

  function upsertUserInputPart(
    event: Extract<AgentEvent, { type: "user_input_request" }>
  ) {
    markReasoningDone()

    const existingIndex = snapshot.parts.findIndex(
      (part) => part.type === "user_input" && part.id === event.requestId
    )
    const existingPart =
      existingIndex >= 0 ? snapshot.parts[existingIndex] : null
    const questions =
      event.questions ??
      (existingPart?.type === "user_input" ? existingPart.questions : [])
    const answers =
      event.answers ??
      (existingPart?.type === "user_input" ? existingPart.answers : [])
    const status =
      event.status === "resolved"
        ? answers.length > 0
          ? ("answered" as const)
          : ("cancelled" as const)
        : ("pending" as const)
    const part: StudioMessagePart = {
      id: event.requestId,
      type: "user_input",
      status,
      questions,
      answers,
      autoResolutionMs:
        event.autoResolutionMs ??
        (existingPart?.type === "user_input"
          ? existingPart.autoResolutionMs
          : null),
    }

    snapshot = {
      ...snapshot,
      parts:
        existingIndex >= 0
          ? snapshot.parts.map((candidate, index) =>
              index === existingIndex ? part : candidate
            )
          : [...snapshot.parts, part],
    }

    return true
  }

  function handleEvent(event: AgentEvent) {
    switch (event.type) {
      case "reasoning_delta":
        return appendReasoningPart(event.delta, event.messageId)
      case "text_delta": {
        const marked = markReasoningDone()
        const appended = appendTextPart(
          event.delta,
          event.messageId,
          event.phase
        )

        return marked || appended
      }
      case "content_block":
        return appendContentBlock(event)
      case "assistant_retry":
        return handleAssistantRetry(event)
      case "tool_call": {
        markReasoningDone()
        const existingById = snapshot.activities.find(
          (activity) => activity.id === event.id
        )
        const parentTaskId =
          existingById?.parentTaskId ?? event.parentTaskId ?? null
        const activity = applyToolEventDetails(
          existingById
            ? {
                ...existingById,
                toolName: event.name || existingById.toolName,
                // Prefer the event's input: a later tool_call carries the
                // canonical arguments and must replace the streamed partial
                // input text accumulated via tool_input events.
                input: event.input || existingById.input,
                parentTaskId,
              }
            : {
                id: event.id,
                toolName: event.name,
                status: "running",
                input: event.input,
                output: "",
                error: null,
                parentTaskId,
              },
          event
        )

        snapshot = {
          ...snapshot,
          activities: existingById
            ? snapshot.activities.map((candidate) =>
                candidate.id === event.id ? activity : candidate
              )
            : [
                ...snapshot.activities.filter(
                  (candidate) => candidate.id !== event.id
                ),
                activity,
              ],
        }
        if (parentTaskId) {
          upsertSubagentActivity(parentTaskId, activity)
        } else {
          upsertToolPart(activity)
        }
        return true
      }
      case "tool_update": {
        markReasoningDone()
        const existingIndex = snapshot.activities.findIndex(
          (activity) => activity.id === event.id
        )
        const existing =
          existingIndex >= 0 ? snapshot.activities[existingIndex] : null
        const parentTaskId =
          event.parentTaskId ?? existing?.parentTaskId ?? null
        const activity = applyToolEventDetails(
          {
            ...(existing ?? {
              id: event.id,
              toolName: event.name || event.title || event.id,
              status: "running" as const,
              input: "",
              output: "",
              error: null,
            }),
            id: event.id,
            toolName:
              event.name || existing?.toolName || event.title || event.id,
            status: activityStatusFromAcpStatus(
              event.acpStatus,
              existing?.status ?? "running"
            ),
            parentTaskId,
          },
          event
        )

        snapshot = {
          ...snapshot,
          activities:
            existingIndex >= 0
              ? snapshot.activities.map((candidate, index) =>
                  index === existingIndex ? activity : candidate
                )
              : [...snapshot.activities, activity],
        }

        if (parentTaskId) {
          upsertSubagentActivity(parentTaskId, activity)
        } else {
          upsertToolPart(activity)
        }

        return true
      }
      case "tool_result": {
        markReasoningDone()
        let activityIndex = snapshot.activities.findIndex(
          (activity) => activity.id === event.id
        )

        if (activityIndex < 0) {
          const matchingRunningIndexes = snapshot.activities
            .map((activity, index) => ({ activity, index }))
            .filter(
              ({ activity }) =>
                activity.toolName === event.name &&
                activity.status === "running" &&
                (!event.parentTaskId ||
                  activity.parentTaskId === event.parentTaskId)
            )

          if (matchingRunningIndexes.length === 1) {
            activityIndex = matchingRunningIndexes[0].index
          } else if (!event.parentTaskId) {
            console.warn("[studio-chat] tool_result_unmatched", {
              eventId: event.id,
              toolName: event.name,
              runningMatches: matchingRunningIndexes.length,
            })
            return false
          }
        }

        const parentTaskId =
          event.parentTaskId ??
          (activityIndex >= 0
            ? snapshot.activities[activityIndex].parentTaskId
            : null) ??
          null
        const baseActivity: StudioMessageActivity =
          activityIndex >= 0
            ? {
                ...snapshot.activities[activityIndex],
                status: event.status,
                output: event.output ?? "",
                error: event.error ?? null,
                parentTaskId,
              }
            : {
                id: event.id,
                toolName: event.name,
                status: event.status,
                input: "",
                output: event.output ?? "",
                error: event.error ?? null,
                parentTaskId,
              }
        const nextActivity = applyToolEventDetails(baseActivity, event)

        snapshot = {
          ...snapshot,
          activities:
            activityIndex >= 0
              ? snapshot.activities.map((activity, index) =>
                  index === activityIndex ? nextActivity : activity
                )
              : [...snapshot.activities, nextActivity],
        }
        if (parentTaskId) {
          upsertSubagentActivity(parentTaskId, nextActivity)
        } else {
          upsertToolPart(nextActivity)
        }

        if (
          event.status === "complete" &&
          isMediaGenerationToolName(event.name) &&
          event.output
        ) {
          const mediaEvent = parseMediaGenerationToolOutput(
            event.output,
            parentTaskId
          )

          if (mediaEvent) {
            upsertMediaGenerationPart(mediaEvent)
          }
        }

        return true
      }
      case "tool_output": {
        const activityIndex = snapshot.activities.findIndex(
          (activity) => activity.id === event.id
        )

        if (activityIndex < 0) {
          return false
        }

        const current = snapshot.activities[activityIndex]

        // Only running tools stream partial output; the final tool_result
        // owns the output once the call settles.
        if (current.status !== "running" || current.output === event.output) {
          return false
        }

        const nextActivity = applyToolEventDetails(
          {
            ...current,
            output: event.output,
          },
          event
        )

        snapshot = {
          ...snapshot,
          activities: snapshot.activities.map((activity, index) =>
            index === activityIndex ? nextActivity : activity
          ),
        }

        if (nextActivity.parentTaskId) {
          upsertSubagentActivity(nextActivity.parentTaskId, nextActivity)
        } else {
          upsertToolPart(nextActivity)
        }

        return true
      }
      case "tool_input": {
        const activityIndex = snapshot.activities.findIndex(
          (activity) => activity.id === event.id
        )

        if (activityIndex < 0) {
          return false
        }

        const current = snapshot.activities[activityIndex]

        // Only running tools stream partial input; the settled tool_call
        // owns the canonical arguments once generation completes.
        if (current.status !== "running" || current.input === event.input) {
          return false
        }

        const nextActivity = applyToolEventDetails(
          {
            ...current,
            input: event.input,
          },
          event
        )

        snapshot = {
          ...snapshot,
          activities: snapshot.activities.map((activity, index) =>
            index === activityIndex ? nextActivity : activity
          ),
        }

        if (nextActivity.parentTaskId) {
          upsertSubagentActivity(nextActivity.parentTaskId, nextActivity)
        } else {
          upsertToolPart(nextActivity)
        }

        return true
      }
      case "plan_update":
        return upsertPlanPart(event)
      case "plan_remove":
        return removePlanPart(event.planId)
      case "subagent_start":
        return upsertSubagentPart({
          taskId: event.taskId,
          name: event.name,
          taskInput: event.taskInput,
          parentTaskId: event.parentTaskId ?? null,
          providerThreadId: event.providerThreadId ?? null,
          providerParentThreadId: event.providerParentThreadId ?? null,
          agentId: event.agentId ?? null,
          nickname: event.nickname ?? null,
          role: event.role ?? null,
          model: event.model ?? null,
          effort: event.effort ?? null,
          background: event.background ?? null,
        })
      case "subagent_update":
        return upsertSubagentPart({
          taskId: event.taskId,
          name: event.name,
          status: event.status,
          taskInput: event.taskInput,
          content: event.content,
          contentDelta: event.contentDelta,
          summary: event.summary,
          error: event.error,
          todos: event.todos,
          parentTaskId: event.parentTaskId ?? null,
          providerThreadId: event.providerThreadId ?? null,
          providerParentThreadId: event.providerParentThreadId ?? null,
          agentId: event.agentId ?? null,
          nickname: event.nickname ?? null,
          role: event.role ?? null,
          model: event.model ?? null,
          effort: event.effort ?? null,
          background: event.background ?? null,
        })
      case "subagent_end": {
        const status = event.status ?? (event.error ? "error" : "complete")
        const updated = upsertSubagentPart({
          taskId: event.taskId,
          name: event.name,
          status,
          summary: event.summary,
          error: event.error,
          parentTaskId: event.parentTaskId ?? null,
          providerThreadId: event.providerThreadId ?? null,
          providerParentThreadId: event.providerParentThreadId ?? null,
          agentId: event.agentId ?? null,
          nickname: event.nickname ?? null,
          role: event.role ?? null,
          model: event.model ?? null,
          effort: event.effort ?? null,
          background: event.background ?? null,
        })
        closeSubagentActivities(
          event.taskId,
          status,
          event.error ?? event.summary
        )

        return updated
      }
      case "file_change":
        return appendFilePart(event)
      case "file_changes_snapshot":
        return replaceFileParts(event)
      case "media_generation":
        return upsertMediaGenerationPart(event)
      case "available-commands":
        debugIgnoredAgentEvent("available_commands_ignored", {
          commandCount: event.commands.length,
        })
        return false
      case "permission_request":
        return upsertPermissionPart(event)
      case "user_input_request":
        return upsertUserInputPart(event)
      case "run_meta":
        debugIgnoredAgentEvent("run_meta_message_ignored", {
          sessionRef: event.sessionRef,
          hasUsage: Boolean(event.usage),
        })
        return false
      case "error":
        debugIgnoredAgentEvent("error_event_ignored", {
          message: event.message,
        })
        return false
    }
  }

  function getSnapshot() {
    return snapshot
  }

  function completeReasoning() {
    markReasoningDone()
    return snapshot
  }

  function finalizeStopped() {
    markReasoningDone()
    snapshot = toStoppedSnapshot(snapshot)
    return snapshot
  }

  function finalizeFailed(message: string) {
    markReasoningDone()

    const activities = snapshot.activities.map((activity) =>
      activity.status === "running"
        ? {
            ...activity,
            status: "error" as const,
            error: message,
          }
        : activity
    )

    const parts = snapshot.parts.map((part) => {
      if (part.type === "tool") {
        return {
          ...part,
          activity:
            activities.find((activity) => activity.id === part.activity.id) ??
            part.activity,
        }
      }

      if (part.type === "permission" && part.status === "pending") {
        return { ...part, status: "cancelled" as const }
      }

      if (part.type === "user_input" && part.status === "pending") {
        return { ...part, status: "cancelled" as const }
      }

      if (part.type === "subagent") {
        return failSubagentPart(part, message)
      }

      return part
    })

    if (
      !snapshot.content.trim() &&
      !snapshot.reasoningContent.trim() &&
      activities.length === 0
    ) {
      snapshot = {
        ...snapshot,
        content: message,
        activities,
        parts: [
          ...parts,
          {
            id: randomUUID(),
            type: "text",
            content: message,
          },
        ],
      }
      return snapshot
    }

    snapshot = {
      ...snapshot,
      activities,
      parts,
    }

    return snapshot
  }

  return {
    completeReasoning,
    finalizeFailed,
    finalizeStopped,
    getSnapshot,
    handleEvent,
  }
}

function persistAssistantSnapshot({
  assistantMessageId,
  sessionId,
  snapshot,
  status,
}: {
  assistantMessageId: string
  sessionId: string
  snapshot: ChatStreamSnapshot
  status: StudioMessageStatus
}) {
  updateStudioMessageSnapshot({
    messageId: assistantMessageId,
    sessionId,
    content: snapshot.content,
    activities: snapshot.activities,
    parts: snapshot.parts,
    reasoningContent: snapshot.reasoningContent,
    reasoningDurationMs: snapshot.reasoningDurationMs,
    status,
  })
}

async function executeAgentRun({
  agentWorkspaceRoot,
  environment,
  messages,
  model,
  permissionMode,
  projectPath,
  workspaceId,
  workspaceRoot,
  reasoningEffort,
  record,
  runtime,
  sessionId,
}: {
  agentWorkspaceRoot?: AgentRunInput["agentWorkspaceRoot"]
  environment?: AgentRunInput["environment"]
  messages: AgentRunInput["messages"]
  model: SupportedChatModel
  permissionMode: AgentRunInput["permissionMode"]
  projectPath?: string | null
  workspaceId?: string | null
  workspaceRoot?: string | null
  reasoningEffort?: ChatReasoningEffort
  record: StudioChatRunRecord
  runtime: AgentRuntime
  sessionId: string
}) {
  const accumulator = createSnapshotAccumulator()
  const worktreeSnapshotPromise =
    environment !== "remote" && projectPath
      ? beginGitWorktreeSnapshot(projectPath)
      : Promise.resolve(null)
  const workspaceHistorySnapshotPromise =
    runtime.info.id === "astraflow" && environment !== "remote" && projectPath
      ? beginPiWorkspaceHistorySnapshot({
          projectPath,
          sessionId,
          turnId: record.assistantMessageId,
        }).catch((error) => {
          console.warn("[studio-chat] workspace_history_begin_failed", error)
          return null
        })
      : Promise.resolve(null)
  let worktreeFinalization: Promise<void> | null = null
  let currentRunUsage: StudioChatRunRecord["usage"] = null
  let lastPersistAt = 0

  const persistSnapshot = (
    status: StudioMessageStatus = getLiveMessageStatus(record),
    force = false
  ) => {
    if (record.forceFinalized) {
      return
    }

    record.latestSnapshot = accumulator.getSnapshot()

    const timestamp = Date.now()

    if (!force && timestamp - lastPersistAt < SNAPSHOT_PERSIST_INTERVAL_MS) {
      scheduleRunLiveSnapshot(record, force)
      return
    }

    lastPersistAt = timestamp
    persistAssistantSnapshot({
      assistantMessageId: record.assistantMessageId,
      sessionId,
      snapshot: record.latestSnapshot,
      status,
    })
    scheduleRunLiveSnapshot(record, force)
  }

  record.persistSnapshot = persistSnapshot
  record.finalizeStoppedSnapshot = () => accumulator.finalizeStopped()
  record.finalizeWorktreeSnapshot = () => {
    worktreeFinalization ??= (async () => {
      const [worktreeSnapshot, workspaceHistorySnapshot] = await Promise.all([
        worktreeSnapshotPromise,
        workspaceHistorySnapshotPromise,
      ])

      if (workspaceHistorySnapshot) {
        try {
          const history = await finishPiWorkspaceHistorySnapshot({
            snapshot: workspaceHistorySnapshot,
            turnId: record.assistantMessageId,
          })

          recordStudioWorkspaceHistoryTurn({
            ...history,
            assistantMessageId: record.assistantMessageId,
            sessionId,
            userMessageId: record.userMessageId,
          })
        } catch (error) {
          console.warn("[studio-chat] workspace_history_finish_failed", error)
        }
      }

      if (worktreeSnapshot) {
        const changes = await finishGitWorktreeSnapshot(worktreeSnapshot)

        if (changes === null) {
          return
        }

        const event = {
          type: "file_changes_snapshot",
          changes,
          source: "worktree",
        } satisfies AgentEvent

        recordStructuredAgentEvent({
          assistantMessageId: record.assistantMessageId,
          event,
          runId: record.runId,
          runtimeId: runtime.info.id,
          sessionId,
        })
        accumulator.handleEvent(event)
        record.latestSnapshot = accumulator.getSnapshot()
      }
    })()

    return worktreeFinalization
  }

  try {
    setRunStatus(record, "running")
    persistSnapshot("streaming", true)

    // Capture the baseline before starting a local runtime so shell and tool
    // edits are attributed to this run instead of the pre-existing worktree.
    await Promise.all([
      worktreeSnapshotPromise,
      workspaceHistorySnapshotPromise,
    ])

    if (record.abortController.signal.aborted) {
      await record.finalizeWorktreeSnapshot()
      clearAbortWatchdog(record)
      accumulator.finalizeStopped()
      setRunStatus(record, "cancelled")
      persistSnapshot("complete", true)
      return
    }

    const runtimeSessionRef = getLatestStudioAgentProviderSessionId(
      sessionId,
      runtime.info.id
    )
    const selectedAgentSession = getLatestStudioAcpSessionSelection(
      sessionId,
      runtime.info.id
    )

    for await (const event of runtime.startRun({
      sessionId,
      messages,
      model,
      permissionMode,
      agentWorkspaceRoot,
      projectPath,
      workspaceId,
      workspaceRoot,
      environment,
      reasoningEffort,
      runtimeSessionRef,
      strictRuntimeSessionRef:
        selectedAgentSession?.providerSessionId === runtimeSessionRef,
      signal: record.abortController.signal,
    })) {
      if (record.forceFinalized) {
        return
      }

      if (record.abortController.signal.aborted) {
        continue
      }

      recordStructuredAgentEvent({
        assistantMessageId: record.assistantMessageId,
        event,
        runId: record.runId,
        runtimeId: runtime.info.id,
        sessionId,
      })

      if (event.type === "available-commands") {
        try {
          setStudioSessionAvailableCommands(sessionId, event.commands)
        } catch (error) {
          debugIgnoredAgentEvent("available_commands_cache_failed", {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (event.type === "run_meta" && event.usage) {
        const usage = normalizeAgentUsage(event.usage)

        if (usage) {
          currentRunUsage = mergeAgentUsageSnapshots(currentRunUsage, usage)
          record.usage = currentRunUsage
          updateStudioSessionLatestRunUsage(sessionId, currentRunUsage)
          recordStudioModelUsageRun({
            runId: record.runId,
            sessionId,
            assistantMessageId: record.assistantMessageId,
            model,
            runtimeId: runtime.info.id,
            usage: currentRunUsage,
            startedAt: record.startedAt,
          })
          scheduleRunLiveSnapshot(record, true)
        }
      }

      if (event.type === "run_meta" && event.sessionTitle) {
        try {
          const session = getStudioSession(sessionId)

          if (
            session &&
            shouldAdoptRuntimeSessionTitle(session.title, event.sessionTitle)
          ) {
            updateStudioSessionTitle(sessionId, event.sessionTitle)
          }
        } catch (error) {
          debugIgnoredAgentEvent("session_title_update_failed", {
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }

      if (event.type === "error") {
        clearAbortWatchdog(record)
        await record.finalizeWorktreeSnapshot()
        accumulator.finalizeFailed(event.message)
        setRunStatus(record, "error", event.message)
        persistSnapshot("error", true)
        return
      }

      if (accumulator.handleEvent(event)) {
        persistSnapshot()
      }
    }

    if (record.forceFinalized) {
      return
    }

    await record.finalizeWorktreeSnapshot()

    if (record.abortController.signal.aborted) {
      clearAbortWatchdog(record)
      accumulator.finalizeStopped()
      setRunStatus(record, "cancelled")
      persistSnapshot("complete", true)
      return
    }

    clearAbortWatchdog(record)
    accumulator.completeReasoning()
    setRunStatus(record, "complete")
    persistSnapshot("complete", true)
  } catch (error) {
    if (record.forceFinalized) {
      return
    }

    await record.finalizeWorktreeSnapshot?.()

    const message =
      error instanceof Error ? error.message : "Chat request failed."

    if (isAbortLikeError(error, record.abortController.signal)) {
      clearAbortWatchdog(record)
      accumulator.finalizeStopped()
      setRunStatus(record, "cancelled")
      persistSnapshot("complete", true)
      return
    }

    clearAbortWatchdog(record)
    console.error("[studio-chat] run_failed", error)
    accumulator.finalizeFailed(message)
    setRunStatus(record, "error", message)
    persistSnapshot("error", true)
  }
}

export function getAgentRun(sessionId: string) {
  const record = getStudioChatRuns().get(sessionId)

  return record ? toRunSnapshot(record) : null
}

export function cancelAgentRun(sessionId: string) {
  const record = getStudioChatRuns().get(sessionId)

  if (
    !record ||
    (record.promise === null &&
      (record.status === "complete" || record.status === "error"))
  ) {
    return null
  }

  record.abortController.abort()
  scheduleAbortWatchdog(record)
  finalizeStoppedSnapshot(record)
  setRunStatus(record, "cancelled")
  persistRunSnapshot(record, "complete", true)

  return toRunSnapshot(record)
}

export function getAgentRunLiveSnapshot(sessionId: string) {
  const record = getStudioChatRuns().get(sessionId)

  return record ? toRunLiveSnapshot(record) : null
}

export function subscribeAgentRun(
  sessionId: string,
  listener: StudioChatRunListener
) {
  const listenersBySession = getStudioChatRunListeners()
  const listeners =
    listenersBySession.get(sessionId) ?? new Set<StudioChatRunListener>()

  listeners.add(listener)
  listenersBySession.set(sessionId, listeners)

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) {
      listenersBySession.delete(sessionId)
    }
  }
}

export function startAgentRun({
  agentWorkspaceRoot,
  createMessages,
  environment,
  model,
  projectPath,
  workspaceId,
  workspaceRoot,
  permissionMode,
  reasoningEffort,
  retryMessageId,
  runtime,
  sessionId,
}: {
  agentWorkspaceRoot?: AgentRunInput["agentWorkspaceRoot"]
  createMessages: () => AgentRunInput["messages"]
  environment?: AgentRunInput["environment"]
  model: SupportedChatModel
  permissionMode: AgentRunInput["permissionMode"]
  projectPath?: string | null
  workspaceId?: string | null
  workspaceRoot?: string | null
  reasoningEffort?: ChatReasoningEffort
  retryMessageId?: string
  runtime: AgentRuntime
  sessionId: string
}) {
  const existing = getStudioChatRuns().get(sessionId)

  if (existing && existing.promise !== null) {
    return toRunSnapshot(existing)
  }

  if (
    existing &&
    (existing.status === "queued" || existing.status === "running")
  ) {
    return toRunSnapshot(existing)
  }

  if (existing?.cleanupTimer) {
    clearTimeout(existing.cleanupTimer)
    existing.cleanupTimer = null
  }

  if (!getStudioSession(sessionId)) {
    throw new Error("Session not found")
  }

  const messages = createMessages()
  const visibleHistory = listStudioMessages(sessionId)
  const retryMessageIndex = retryMessageId
    ? visibleHistory.findIndex((message) => message.id === retryMessageId)
    : -1
  const userMessageId = (
    retryMessageIndex >= 0
      ? visibleHistory.slice(0, retryMessageIndex)
      : visibleHistory
  ).findLast((message) => message.role === "user")?.id
  abandonUndoneStudioWorkspaceHistoryTurns(sessionId)
  const assistantMessage = createStudioMessage({
    sessionId,
    role: "assistant",
    content: "",
    model,
    environment: environment ?? "local",
    workspace: createStudioRunFileWorkspaceTarget({
      agentWorkspaceRoot,
      environment: environment ?? "local",
      projectPath,
      sessionId,
      workspaceId,
      workspaceRoot,
    }),
    replacesMessageId: retryMessageId ?? null,
    status: "streaming",
  })
  const timestamp = nowIso()
  const record: StudioChatRunRecord = {
    runId: randomUUID(),
    sessionId,
    assistantMessageId: assistantMessage.id,
    status: "queued",
    error: null,
    startedAt: timestamp,
    updatedAt: timestamp,
    abortWatchdogTimer: null,
    abortController: new AbortController(),
    cleanupTimer: null,
    finalizeStoppedSnapshot: null,
    finalizeWorktreeSnapshot: null,
    forceFinalized: false,
    latestSnapshot: createInitialSnapshot(),
    usage: getStudioSession(sessionId)?.latestRunUsage ?? null,
    liveMessageBase: assistantMessage,
    userMessageId: userMessageId ?? null,
    livePublishTimer: null,
    lastLivePublishedAt: 0,
    persistSnapshot: null,
    promise: null,
  }

  getStudioChatRuns().set(sessionId, record)

  record.promise = executeAgentRun({
    agentWorkspaceRoot,
    environment,
    messages,
    model,
    permissionMode,
    projectPath,
    workspaceId,
    workspaceRoot,
    reasoningEffort,
    record,
    runtime,
    sessionId,
  }).finally(() => {
    clearAbortWatchdog(record)
    record.promise = null
    record.persistSnapshot = null
    record.finalizeStoppedSnapshot = null
    record.finalizeWorktreeSnapshot = null

    if (!record.forceFinalized) {
      scheduleRunCleanup(record)
    }
  })

  return toRunSnapshot(record)
}
