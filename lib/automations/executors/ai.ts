import "server-only"
import { resolveCompShareEntitledModel } from "@/lib/compshare/entitlements"

import {
  createStudioMessage,
  createStudioSession,
  getStudioWorkspace,
} from "@/lib/studio-db"
import {
  cancelStudioChatRun,
  getStudioChatRunLiveSnapshot,
  startStudioChatRun,
  subscribeStudioChatRun,
} from "@/lib/studio-chat-runner"
import type { StudioChatRunLiveSnapshot } from "@/lib/studio-types"

import { attachAutomationRunSession, removeAutomationSession } from "../store"
import type {
  AutomationExecutorOutcome,
  AutomationRun,
  AutomationTask,
} from "../types"

const AI_CANCEL_FALLBACK_MS = 10_000

function sessionTitle(
  task: Extract<AutomationTask, { kind: "ai" }>,
  run: AutomationRun
) {
  const scheduledFor = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: task.timeZone,
  }).format(new Date(run.scheduledFor))

  return `${task.name} · ${scheduledFor} (${task.timeZone})`
}

function terminalStatus(snapshot: StudioChatRunLiveSnapshot) {
  return ["complete", "error", "cancelled"].includes(snapshot.status)
}

function waitForAgentRun({
  sessionId,
  timeoutSeconds,
  registerCancel,
}: {
  sessionId: string
  timeoutSeconds: number
  registerCancel: (cancel: () => void) => void
}) {
  return new Promise<{
    snapshot: StudioChatRunLiveSnapshot | null
    timedOut: boolean
  }>((resolve) => {
    let settled = false
    let timedOut = false
    let cancelFallback: ReturnType<typeof setTimeout> | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    let unsubscribe = () => {}

    const finish = (snapshot: StudioChatRunLiveSnapshot | null) => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      if (cancelFallback) {
        clearTimeout(cancelFallback)
      }
      unsubscribe()
      resolve({ snapshot, timedOut })
    }

    const cancel = () => {
      cancelStudioChatRun(sessionId)
      cancelFallback = setTimeout(
        () => finish(getStudioChatRunLiveSnapshot(sessionId)),
        AI_CANCEL_FALLBACK_MS
      )
      cancelFallback.unref?.()
    }

    registerCancel(cancel)
    unsubscribe = subscribeStudioChatRun(sessionId, (snapshot) => {
      if (terminalStatus(snapshot)) {
        finish(snapshot)
      }
    })

    timeout = setTimeout(() => {
      timedOut = true
      cancel()
    }, timeoutSeconds * 1000)
    timeout.unref?.()

    const current = getStudioChatRunLiveSnapshot(sessionId)
    if (current && terminalStatus(current)) {
      finish(current)
    }
  })
}

export async function executeAiAutomation({
  task,
  run,
  registerCancel,
}: {
  task: Extract<AutomationTask, { kind: "ai" }>
  run: AutomationRun
  registerCancel: (cancel: () => void) => void
}): Promise<AutomationExecutorOutcome> {
  let session: ReturnType<typeof createStudioSession> | null = null
  let attached = false

  try {
    await resolveCompShareEntitledModel(task.payload.model)
    if (task.payload.permissionMode === "full_access") {
      if (!task.workspaceId) {
        throw new Error(
          "Full Access automation paused because its Sandbox workspace is unavailable."
        )
      }

      const workspace = getStudioWorkspace(task.workspaceId)

      if (!workspace || workspace.type !== "sandbox") {
        throw new Error(
          "Full Access automation paused because it requires an explicit Sandbox workspace."
        )
      }
    }

    session = createStudioSession({
      mode: "chat",
      title: sessionTitle(task, run),
      workspaceId: task.workspaceId,
      permissionMode: task.payload.permissionMode,
      chatModel: task.payload.model,
      chatRuntimeId: task.payload.runtimeId,
      chatReasoningEffort: task.payload.reasoningEffort,
    })
    attached = attachAutomationRunSession(run.id, session.id)
    if (!attached) {
      removeAutomationSession(session.id)
      session = null
      return {
        ok: false,
        error: "AI task was cancelled before execution started.",
        result: {},
      }
    }
    createStudioMessage({
      sessionId: session.id,
      role: "user",
      content: task.payload.prompt,
    })
    await startStudioChatRun({
      sessionId: session.id,
      model: task.payload.model,
      runtimeId: task.payload.runtimeId,
      reasoningEffort: task.payload.reasoningEffort ?? undefined,
    })
  } catch (error) {
    if (session && !attached) {
      removeAutomationSession(session.id)
      session = null
    }
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to start the AI task.",
      result: { sessionId: session?.id ?? null },
    }
  }

  if (!session) {
    return {
      ok: false,
      error: "Failed to create a Studio session for the AI task.",
      result: {},
    }
  }

  const { snapshot, timedOut } = await waitForAgentRun({
    sessionId: session.id,
    timeoutSeconds: task.timeoutSeconds,
    registerCancel,
  })
  const outputPreview = snapshot?.message?.content ?? ""
  const result = { sessionId: session.id, outputPreview }

  if (timedOut) {
    return {
      ok: false,
      error: `AI task timed out after ${task.timeoutSeconds} seconds.`,
      result,
    }
  }
  if (!snapshot) {
    return { ok: false, error: "AI task ended without a result.", result }
  }
  if (snapshot.status === "error") {
    return {
      ok: false,
      error: snapshot.error || "AI task failed.",
      result,
    }
  }
  if (snapshot.status === "cancelled") {
    return { ok: false, error: "AI task was cancelled.", result }
  }

  return { ok: true, result }
}
