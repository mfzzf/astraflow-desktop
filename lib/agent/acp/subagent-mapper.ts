import type { SessionUpdate } from "@agentclientprotocol/sdk"

import type { AgentEvent } from "@/lib/agent/events"

type AcpToolSessionUpdate = Extract<
  SessionUpdate,
  { sessionUpdate: "tool_call" | "tool_call_update" }
>

export type AcpMappedSubagent = {
  taskId: string
  started: boolean
  ended: boolean
  name: string
  taskInput?: string
  parentTaskId?: string
  providerThreadId?: string
  providerParentThreadId?: string
  agentId?: string
  nickname?: string
  role?: string
  model?: string
  effort?: string
  background?: boolean
  status?: string
  message?: string
  modelIsRequestedHint?: boolean
}

export type AcpSubagentMapperState = {
  subagentTasksByAgentId: Map<string, AcpMappedSubagent>
  subagentTasksByToolCall: Map<string, AcpMappedSubagent[]>
  subagentTasksByProviderThreadId: Map<string, AcpMappedSubagent>
}

type SubagentHint = Omit<
  AcpMappedSubagent,
  "taskId" | "started" | "ended" | "name"
> & {
  name?: string
}

const WORKER_TIER_ROLE_PATTERN = /^worker-(?:low|medium|high|xhigh)$/i

function sanitizeRole(role: string | undefined) {
  return role && !WORKER_TIER_ROLE_PATTERN.test(role.trim()) ? role : undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : null
}

function asString(value: unknown, limit = 8192) {
  if (typeof value !== "string") {
    return undefined
  }

  const text = value.trim()
  return text ? text.slice(0, limit) : undefined
}

function firstString(
  record: Record<string, unknown> | null,
  keys: readonly string[],
  limit?: number
) {
  for (const key of keys) {
    const value = asString(record?.[key], limit)

    if (value) {
      return value
    }
  }

  return undefined
}

function readReceiverThreadIds(record: Record<string, unknown> | null) {
  const ids: string[] = []
  const seen = new Set<string>()

  const push = (value: unknown) => {
    const id = asString(value, 512)

    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }

  for (const key of [
    "receiverThreadIds",
    "receiver_thread_ids",
    "threadIds",
    "thread_ids",
  ]) {
    for (const value of asArray(record?.[key]) ?? []) {
      push(value)
    }
  }

  for (const key of [
    "receiverThreadId",
    "receiver_thread_id",
    "newThreadId",
    "new_thread_id",
    "threadId",
    "thread_id",
  ]) {
    push(record?.[key])
  }

  return ids
}

function statusRecordMap(record: Record<string, unknown> | null) {
  return (
    asRecord(record?.agentsStates) ??
    asRecord(record?.agents_states) ??
    asRecord(record?.agentStates) ??
    asRecord(record?.agent_states) ??
    asRecord(record?.statuses)
  )
}

function hintFromRecord(
  record: Record<string, unknown> | null,
  fallback: SubagentHint = {}
): SubagentHint {
  const directModel = firstString(
    record,
    ["model", "modelName", "model_name"],
    512
  )
  const requestedModel = firstString(
    record,
    ["requestedModel", "requested_model"],
    512
  )
  const model = directModel ?? requestedModel

  return {
    providerThreadId:
      firstString(record, [
        "threadId",
        "thread_id",
        "receiverThreadId",
        "receiver_thread_id",
        "newThreadId",
        "new_thread_id",
      ], 512) ?? fallback.providerThreadId,
    providerParentThreadId:
      firstString(record, [
        "senderThreadId",
        "sender_thread_id",
        "parentThreadId",
        "parent_thread_id",
      ], 512) ?? fallback.providerParentThreadId,
    parentTaskId:
      firstString(record, ["parentTaskId", "parent_task_id"], 512) ??
      fallback.parentTaskId,
    agentId:
      firstString(record, [
        "agentId",
        "agent_id",
        "receiverAgentId",
        "receiver_agent_id",
        "newAgentId",
        "new_agent_id",
      ], 512) ?? fallback.agentId,
    nickname:
      firstString(record, [
        "agentNickname",
        "agent_nickname",
        "receiverAgentNickname",
        "receiver_agent_nickname",
        "newAgentNickname",
        "new_agent_nickname",
        "nickname",
      ], 512) ?? fallback.nickname,
    role:
      sanitizeRole(
        firstString(
          record,
          [
            "agentRole",
            "agent_role",
            "receiverAgentRole",
            "receiver_agent_role",
            "newAgentRole",
            "new_agent_role",
            "agentType",
            "agent_type",
            "subagent_type",
          ],
          512
        )
      ) ?? fallback.role,
    model: model ?? fallback.model,
    modelIsRequestedHint: model
      ? directModel === undefined
      : fallback.modelIsRequestedHint,
    effort:
      firstString(record, [
        "effort",
        "reasoningEffort",
        "reasoning_effort",
      ], 512) ?? fallback.effort,
    background:
      typeof record?.background === "boolean"
        ? record.background
        : fallback.background,
    taskInput:
      firstString(record, ["prompt", "task", "message"]) ??
      fallback.taskInput,
    name:
      firstString(record, ["description", "name"], 512) ?? fallback.name,
    status: firstString(record, ["status", "state"], 128) ?? fallback.status,
    message:
      firstString(record, [
        "summary",
        "message",
        "latestUpdate",
        "latest_update",
        "result",
        "task_result",
        "output",
      ]) ?? fallback.message,
  }
}

function sourceIdentityHint(
  record: Record<string, unknown> | null
): SubagentHint | null {
  if (!record) return null

  const source = asRecord(record.source)
  const subagent =
    asRecord(source?.subAgent) ??
    asRecord(source?.sub_agent) ??
    asRecord(record.subAgent) ??
    asRecord(record.sub_agent)
  const spawn =
    asRecord(subagent?.thread_spawn) ?? asRecord(subagent?.threadSpawn)
  if (!subagent && !spawn) return null

  const providerThreadId =
    firstString(record, [
      "threadId",
      "thread_id",
      "conversationId",
      "conversation_id",
      "receiverThreadId",
      "receiver_thread_id",
    ], 512) ?? firstString(spawn, ["threadId", "thread_id"], 512)
  const agentId =
    firstString(record, ["agentId", "agent_id", "id"], 512) ??
    firstString(spawn, ["agentId", "agent_id", "id"], 512) ??
    firstString(subagent, ["agentId", "agent_id", "id"], 512)
  const nickname =
    firstString(record, ["agentNickname", "agent_nickname", "nickname"], 512) ??
    firstString(
      spawn,
      ["agentNickname", "agent_nickname", "nickname", "name"],
      512
    ) ??
    firstString(
      subagent,
      ["agentNickname", "agent_nickname", "nickname", "name"],
      512
    )
  const role = sanitizeRole(
    firstString(record, ["agentRole", "agent_role", "agentType", "agent_type"], 512) ??
      firstString(spawn, ["agentRole", "agent_role", "agentType", "agent_type"], 512) ??
      firstString(subagent, ["agentRole", "agent_role", "agentType", "agent_type"], 512)
  )

  if (!providerThreadId && !agentId && !nickname && !role) return null

  return {
    providerThreadId,
    agentId,
    nickname,
    role,
    name: nickname ?? role,
  }
}

function agentEntryArrays(record: Record<string, unknown> | null) {
  return [
    ...(asArray(record?.receiverAgents) ?? []),
    ...(asArray(record?.receiver_agents) ?? []),
    ...(asArray(record?.agents) ?? []),
  ]
}

function stateHints(record: Record<string, unknown> | null) {
  const hints: SubagentHint[] = []
  const map = statusRecordMap(record)

  for (const [threadId, value] of Object.entries(map ?? {})) {
    hints.push(
      hintFromRecord(asRecord(value), {
        providerThreadId: asString(threadId, 512),
      })
    )
  }

  const arrays = [
    ...(asArray(record?.agentStatuses) ?? []),
    ...(asArray(record?.agent_statuses) ?? []),
    ...(Array.isArray(record?.statuses) ? record.statuses : []),
  ]
  for (const value of arrays) {
    const entry = asRecord(value)
    const providerThreadId = firstString(entry, ["threadId", "thread_id"], 512)
    if (providerThreadId) {
      hints.push(hintFromRecord(entry, { providerThreadId }))
    }
  }

  return hints
}

function decodeHints(update: AcpToolSessionUpdate) {
  const input = asRecord(update.rawInput)
  const output = asRecord(update.rawOutput)
  const base = hintFromRecord(output, hintFromRecord(input))
  const receiverIds = [
    ...readReceiverThreadIds(input),
    ...readReceiverThreadIds(output),
  ].filter((id, index, ids) => ids.indexOf(id) === index)
  const agentEntries = [...agentEntryArrays(input), ...agentEntryArrays(output)]
  const hints: SubagentHint[] = []

  for (const [index, value] of agentEntries.entries()) {
    const hint = hintFromRecord(asRecord(value), {
      ...base,
      providerThreadId: receiverIds[index] ?? base.providerThreadId,
      modelIsRequestedHint: base.model ? true : base.modelIsRequestedHint,
    })
    hints.push(hint)
  }

  for (const hint of [
    sourceIdentityHint(input),
    sourceIdentityHint(output),
    ...stateHints(input),
    ...stateHints(output),
  ]) {
    if (!hint) continue
    const receiverId = hint.providerThreadId
    const existingIndex = hints.findIndex(
      (candidate) =>
        (receiverId && candidate.providerThreadId === receiverId) ||
        (hint.agentId && candidate.agentId === hint.agentId)
    )

    if (existingIndex >= 0) {
      const existing = hints[existingIndex]
      hints[existingIndex] = hintFromRecord(null, {
        ...existing,
        ...Object.fromEntries(
          Object.entries(hint).filter(([, value]) => value !== undefined)
        ),
      })
    } else {
      hints.push(hint)
    }
  }

  for (const receiverId of receiverIds) {
    if (!hints.some((hint) => hint.providerThreadId === receiverId)) {
      hints.push({ ...base, providerThreadId: receiverId })
    }
  }

  if (hints.length === 0 && (base.providerThreadId || base.agentId)) {
    hints.push(base)
  }

  return { base, hints }
}

function isSubagentTool(
  toolName: string,
  decoded: ReturnType<typeof decodeHints>,
  update: AcpToolSessionUpdate
) {
  const astraflow = asRecord(update._meta?.astraflow)

  return (
    toolName === "spawn_agent" ||
    decoded.hints.length > 0 ||
    statusRecordMap(asRecord(update.rawInput)) !== null ||
    statusRecordMap(asRecord(update.rawOutput)) !== null ||
    stateHints(asRecord(update.rawInput)).length > 0 ||
    stateHints(asRecord(update.rawOutput)).length > 0 ||
    sourceIdentityHint(asRecord(update.rawInput)) !== null ||
    sourceIdentityHint(asRecord(update.rawOutput)) !== null ||
    astraflow?.subagent === "task"
  )
}

function mergeTask(task: AcpMappedSubagent, hint: SubagentHint) {
  const nickname = hint.nickname ?? task.nickname
  const role = hint.role ?? task.role
  const name = nickname ?? hint.name ?? role ?? task.name
  const definedHint = Object.fromEntries(
    Object.entries(hint).filter(([, value]) => value !== undefined)
  )

  if (
    hint.modelIsRequestedHint === true &&
    task.model !== undefined &&
    task.modelIsRequestedHint !== true
  ) {
    delete definedHint.model
    delete definedHint.modelIsRequestedHint
  }

  Object.assign(task, {
    ...definedHint,
    name,
    nickname,
    role,
    taskInput: hint.taskInput ?? task.taskInput,
    parentTaskId: hint.parentTaskId ?? task.parentTaskId,
  })

  return task
}

function eventDetails(task: AcpMappedSubagent) {
  return {
    ...(task.taskInput ? { taskInput: task.taskInput } : {}),
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    ...(task.providerThreadId
      ? { providerThreadId: task.providerThreadId }
      : {}),
    ...(task.providerParentThreadId
      ? { providerParentThreadId: task.providerParentThreadId }
      : {}),
    ...(task.agentId ? { agentId: task.agentId } : {}),
    ...(task.nickname ? { nickname: task.nickname } : {}),
    ...(task.role ? { role: task.role } : {}),
    ...(task.model ? { model: task.model } : {}),
    ...(task.effort ? { effort: task.effort } : {}),
    ...(typeof task.background === "boolean"
      ? { background: task.background }
      : {}),
  }
}

function terminalStatus(
  providerStatus: string | undefined,
  acpStatus: AcpToolSessionUpdate["status"]
) {
  const normalized = providerStatus?.toLowerCase()

  if (
    normalized === "errored" ||
    normalized === "error" ||
    normalized === "failed" ||
    normalized === "notfound" ||
    acpStatus === "failed"
  ) {
    return "error" as const
  }

  if (
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "done" ||
    normalized === "finished" ||
    normalized === "success" ||
    normalized === "succeeded" ||
    normalized === "shutdown" ||
    acpStatus === "completed"
  ) {
    return "complete" as const
  }

  if (
    normalized === "stopped" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "interrupted" ||
    normalized === "aborted"
  ) {
    return "cancelled" as const
  }

  return null
}

function resolveTasks(
  update: AcpToolSessionUpdate,
  decoded: ReturnType<typeof decodeHints>,
  state: AcpSubagentMapperState
) {
  const existing = state.subagentTasksByToolCall.get(update.toolCallId) ?? []
  const hints = decoded.hints.length > 0 ? decoded.hints : [decoded.base]

  for (const [index, hint] of hints.entries()) {
    let task = hint.providerThreadId
      ? state.subagentTasksByProviderThreadId.get(hint.providerThreadId)
      : undefined
    if (!task && hint.agentId) {
      const agentTask = state.subagentTasksByAgentId.get(hint.agentId)

      if (
        agentTask &&
        (!hint.providerThreadId ||
          !agentTask.providerThreadId ||
          agentTask.providerThreadId === hint.providerThreadId)
      ) {
        task = agentTask
      }
    }

    task ??= existing.find(
      (candidate) =>
        (hint.providerThreadId &&
          candidate.providerThreadId === hint.providerThreadId) ||
        (hint.agentId && candidate.agentId === hint.agentId)
    )
    task ??= existing.find((candidate) => !candidate.providerThreadId)

    if (!task) {
      const suffix = hint.providerThreadId ?? hint.agentId ?? String(index + 1)
      task = {
        taskId:
          existing.length === 0 && index === 0
            ? update.toolCallId
            : `${update.toolCallId}:${suffix}`,
        started: false,
        ended: false,
        name: hint.nickname ?? hint.name ?? hint.role ?? "Subagent",
      }
    }

    if (!existing.includes(task)) {
      existing.push(task)
    }

    mergeTask(task, hint)

    if (!task.parentTaskId && task.providerParentThreadId) {
      const parent = state.subagentTasksByProviderThreadId.get(
        task.providerParentThreadId
      )
      if (parent && parent.taskId !== task.taskId) {
        task.parentTaskId = parent.taskId
      }
    }

    if (task.providerThreadId) {
      state.subagentTasksByProviderThreadId.set(task.providerThreadId, task)
    }
    if (task.agentId) {
      state.subagentTasksByAgentId.set(task.agentId, task)
    }
  }

  state.subagentTasksByToolCall.set(update.toolCallId, existing)
  return existing
}

export function mapAcpSubagentToolUpdate(
  update: AcpToolSessionUpdate,
  toolName: string,
  state: AcpSubagentMapperState
): AgentEvent[] {
  const decoded = decodeHints(update)

  if (!isSubagentTool(toolName, decoded, update)) {
    return []
  }

  const tasks = resolveTasks(update, decoded, state)
  const events: AgentEvent[] = []

  for (const task of tasks) {
    const details = eventDetails(task)

    if (!task.started) {
      task.started = true
      events.push({
        type: "subagent_start",
        taskId: task.taskId,
        name: task.name,
        ...details,
      })
    }

    const status = terminalStatus(task.status, update.status)

    if (status && !task.ended) {
      task.ended = true
      events.push({
        type: "subagent_end",
        taskId: task.taskId,
        name: task.name,
        status,
        ...(status === "error"
          ? { error: task.message ?? "Subagent failed." }
          : status === "complete" && task.message
            ? { summary: task.message }
            : {}),
        ...details,
      })
      continue
    }

    if (update.sessionUpdate === "tool_call_update" || task.message) {
      events.push({
        type: "subagent_update",
        taskId: task.taskId,
        name: task.name,
        status: "running",
        ...(task.message ? { content: task.message } : {}),
        ...details,
      })
    }
  }

  return events
}
