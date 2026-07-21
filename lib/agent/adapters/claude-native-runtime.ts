import { randomUUID } from "node:crypto"
import type {
  CanUseTool,
  Options as ClaudeAgentOptions,
  PermissionMode,
  PermissionResult,
  SDKMessage,
  SDKUserMessage,
  SlashCommand,
} from "@anthropic-ai/claude-agent-sdk"

import { formatAgentConductRules } from "@/lib/agent/agent-conduct-rules"
import type {
  PromptMention,
  SlashCommandDescriptor,
} from "@/lib/agent/composer-types"
import { AgentEventQueue } from "@/lib/agent/event-queue"
import type { AgentEvent, AgentTodo } from "@/lib/agent/events"
import { formatClaudeHookTitle } from "@/lib/agent/claude-hook"
import type {
  AgentMessage,
  AgentMessageContent,
} from "@/lib/agent/messages"
import { normalizeAgentToolName } from "@/lib/agent/tool-names"
import { getConfiguredPythonProcessEnvironment } from "@/lib/agent/python-process-environment"
import { stringifyToolPayload } from "@/lib/agent/tool-payload"
import {
  cancelSessionPermissions,
  requestPermission,
  type PermissionOption,
} from "@/lib/agent/permission-broker"
import { registerAgentRuntime } from "@/lib/agent/runtime"
import type {
  AgentRunInput,
  AgentRuntime,
  AgentRuntimeInfo,
} from "@/lib/agent/runtime"
import {
  MODELVERSE_ANTHROPIC_BASE_URL,
  getAgentModelById,
  getRuntimeModelSetting,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import type { ChatReasoningEffort } from "@/lib/chat-models"
import { getStudioModelverseApiKey } from "@/lib/studio-db"

type ClaudeAgentQuery =
  (typeof import("@anthropic-ai/claude-agent-sdk"))["query"]

type StreamedBlock = {
  index: number
  text: string
  type: "text" | "thinking"
}

export type ClaudeSdkMapperState = {
  activeCompactionToolCallId: string | null
  claudeTaskCreateToolIds: Set<string>
  claudeTaskPlanSignature: string
  claudeTaskToolKinds: Map<string, string>
  claudeTasksById: Map<string, AgentTodo>
  completedToolCallIds: Set<string>
  emittedToolCallIds: Set<string>
  emittedPlanToolCallIds: Set<string>
  streamedBlocks: StreamedBlock[]
  taskIdByToolUseId: Map<string, string>
  taskNames: Map<string, string>
  toolInputs: Map<string, unknown>
  toolNames: Map<string, string>
  toolUseIdByTaskId: Map<string, string>
  workspace?: string
}

export type ClaudeSdkMappableMessage = SDKMessage | Record<string, unknown>

export type ClaudeNativeRuntimeOptions = {
  info?: AgentRuntimeInfo
  query?: ClaudeAgentQuery
}

type ClaudeNativeRunConfig = {
  env?: Record<string, string | undefined>
  model?: string
  settings?: NonNullable<ClaudeAgentOptions["settings"]>
}

const CLAUDE_NATIVE_RUNTIME_CAPABILITIES = {
  hitl: true,
  resume: true,
  subagents: true,
  plan: true,
  sandbox: false,
  mcp: true,
  skills: true,
  compact: true,
}
const CLAUDE_SUPPORTED_COMMANDS_TIMEOUT_MS = 2_500

export const CLAUDE_NATIVE_RUNTIME_ID = "claude-native"

export const CLAUDE_NATIVE_RUNTIME_INFO = {
  id: CLAUDE_NATIVE_RUNTIME_ID,
  label: "Claude Native",
  description: "Experimental local-only Claude Agent SDK adapter",
  capabilities: CLAUDE_NATIVE_RUNTIME_CAPABILITIES,
  composer: {
    slashCommands: "dynamic",
    fileMentions: "text",
    sessionMentions: true,
  },
} satisfies AgentRuntimeInfo

export function createClaudeSdkMapperState(
  workspace?: string
): ClaudeSdkMapperState {
  return {
    activeCompactionToolCallId: null,
    claudeTaskCreateToolIds: new Set(),
    claudeTaskPlanSignature: "",
    claudeTaskToolKinds: new Map(),
    claudeTasksById: new Map(),
    completedToolCallIds: new Set(),
    emittedToolCallIds: new Set(),
    emittedPlanToolCallIds: new Set(),
    streamedBlocks: [],
    taskIdByToolUseId: new Map(),
    taskNames: new Map(),
    toolInputs: new Map(),
    toolNames: new Map(),
    toolUseIdByTaskId: new Map(),
    workspace,
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function getString(value: unknown) {
  return typeof value === "string" ? value : null
}

function stringifyPayload(value: unknown) {
  return stringifyToolPayload(value)
}

function compactObject(entries: Array<[string, unknown]>) {
  const result: Record<string, unknown> = {}

  for (const [key, value] of entries) {
    if (value === undefined || value === null) {
      continue
    }

    if (Array.isArray(value) && value.length === 0) {
      continue
    }

    result[key] = value
  }

  return Object.keys(result).length ? result : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: NodeJS.Timeout | null = null

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("Timed out"))
      }, timeoutMs)
      timer.unref()
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

function mapClaudeSlashCommands(
  commands: SlashCommand[]
): SlashCommandDescriptor[] {
  return commands.flatMap((command) => {
    const name = command.name.trim().replace(/^\/+/, "")

    if (!name) {
      return []
    }

    const descriptor: SlashCommandDescriptor = {
      name,
      description: command.description,
      source: "runtime",
    }
    const inputHint = command.argumentHint?.trim()

    if (inputHint) {
      descriptor.inputHint = inputHint
    }

    return [descriptor]
  })
}

async function emitClaudeSupportedCommands({
  query,
  queue,
  signal,
}: {
  query: ReturnType<ClaudeAgentQuery>
  queue: AgentEventQueue
  signal: AbortSignal
}) {
  try {
    const commands = await withTimeout(
      query.supportedCommands(),
      CLAUDE_SUPPORTED_COMMANDS_TIMEOUT_MS
    )

    if (signal.aborted) {
      return
    }

    queue.push({
      type: "available-commands",
      commands: mapClaudeSlashCommands(commands),
    })
  } catch {
    // Command discovery is opportunistic and must not block a run.
  }
}

function isAbortLikeError(error: unknown, signal?: AbortSignal) {
  const record = getRecord(error)
  const name = typeof record?.name === "string" ? record.name : ""
  const message = errorMessage(error).toLowerCase()

  return (
    Boolean(signal?.aborted) ||
    name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("cancelled") ||
    message.includes("canceled")
  )
}

function contentPartToText(part: unknown) {
  if (typeof part === "string") {
    return part
  }

  const record = getRecord(part)

  if (!record) {
    return ""
  }

  if (record.type === "text" && typeof record.text === "string") {
    return record.text
  }

  if (record.type === "image_url") {
    return "[image]"
  }

  return stringifyPayload(record)
}

function messageContentToText(content: AgentMessageContent) {
  if (typeof content === "string") {
    return content
  }

  if (Array.isArray(content)) {
    return content.map(contentPartToText).filter(Boolean).join("\n")
  }

  return stringifyPayload(content)
}

function roleLabelForMessage(message: AgentMessage) {
  if (message.role === "user") {
    return "User"
  }

  if (message.role === "assistant") {
    return "Assistant"
  }

  if (message.role === "system") {
    return "System"
  }

  return "Message"
}

function truncateForPrompt(text: string, maxLength = 600) {
  const cleaned = text.replace(/\s+/g, " ").trim()

  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}...`
    : cleaned
}

function createConversationRecap(
  messages: AgentMessage[],
  latestUserIndex: number
) {
  const priorMessages = messages
    .slice(Math.max(0, latestUserIndex - 8), latestUserIndex)
    .map((message) => {
      const text = truncateForPrompt(messageContentToText(message.content))

      return text ? `- ${roleLabelForMessage(message)}: ${text}` : null
    })
    .filter(Boolean)

  if (!priorMessages.length) {
    return null
  }

  return [
    "Conversation recap before this Claude Code turn:",
    ...priorMessages,
  ].join("\n")
}

function getLatestUserMessage(messages: AgentMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      return { index, message: messages[index] }
    }
  }

  const index = messages.length - 1

  return index >= 0 ? { index, message: messages[index] } : null
}

function getFilePromptMentions(message: AgentMessage) {
  const mentions = message.mentions

  if (!Array.isArray(mentions)) {
    return []
  }

  return mentions.filter(
    (mention): mention is Extract<PromptMention, { kind: "file" | "folder" }> =>
      typeof mention === "object" &&
      mention !== null &&
      (mention.kind === "file" || mention.kind === "folder") &&
      typeof mention.path === "string" &&
      mention.path.length > 0 &&
      typeof mention.name === "string" &&
      mention.name.length > 0
  )
}

function appendReferencedFiles(text: string, message: AgentMessage) {
  const paths = getFilePromptMentions(message)
    .map((mention) => mention.path)
    .filter((path) => !text.includes(path))

  if (!paths.length) {
    return text
  }

  return [text, ["Referenced files:", ...paths].join("\n")]
    .filter((part) => part.trim().length > 0)
    .join("\n\n")
}

function getClaudeImageBlocks(message: AgentMessage) {
  if (!Array.isArray(message.content)) {
    return []
  }

  return message.content.flatMap((part) => {
    const record = getRecord(part)
    if (record?.type !== "image_url") {
      return []
    }

    const imageUrl = getRecord(record.image_url)
    const url =
      typeof record.image_url === "string"
        ? record.image_url
        : typeof imageUrl?.url === "string"
          ? imageUrl.url
          : ""
    const match = url.match(
      /^data:(image\/(?:gif|jpeg|png|webp));base64,([\s\S]+)$/i
    )

    return match
      ? [
          {
            source: {
              data: match[2],
              media_type: match[1].toLowerCase() as
                "image/gif" | "image/jpeg" | "image/png" | "image/webp",
              type: "base64" as const,
            },
            type: "image" as const,
          },
        ]
      : []
  })
}

function createClaudePrompt(
  messages: AgentMessage[],
  { includeRecap = true }: { includeRecap?: boolean } = {}
): string | AsyncIterable<SDKUserMessage> {
  const latestUserMessage = getLatestUserMessage(messages)

  if (!latestUserMessage) {
    return ""
  }

  const latestText = appendReferencedFiles(
    messageContentToText(latestUserMessage.message.content),
    latestUserMessage.message
  )
  const recap = includeRecap
    ? createConversationRecap(messages, latestUserMessage.index)
    : ""
  const prompt = recap
    ? `${recap}\n\nLatest user message:\n${latestText}`
    : latestText
  const imageBlocks = getClaudeImageBlocks(latestUserMessage.message)

  if (!imageBlocks.length) {
    return prompt
  }

  return (async function* () {
    yield {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text: prompt }, ...imageBlocks],
      },
      parent_tool_use_id: null,
    }
  })()
}

function getBlockText(block: Record<string, unknown>) {
  if (block.type === "text" && typeof block.text === "string") {
    return { text: block.text, type: "text" as const }
  }

  if (block.type === "thinking" && typeof block.thinking === "string") {
    return { text: block.thinking, type: "thinking" as const }
  }

  return null
}

function getToolUseBlock(block: Record<string, unknown>) {
  if (
    block.type !== "tool_use" &&
    block.type !== "server_tool_use" &&
    block.type !== "mcp_tool_use"
  ) {
    return null
  }

  const id = getString(block.id)
  const name = getString(block.name)

  if (!id || !name) {
    return null
  }

  return {
    id,
    input: block.input,
    name,
  }
}

function getToolResultBlock(block: Record<string, unknown>) {
  if (block.type !== "tool_result") {
    return null
  }

  const id = getString(block.tool_use_id)

  if (!id) {
    return null
  }

  return {
    content: block.content,
    id,
    isError: block.is_error === true,
  }
}

function resolveTaskIdForParentToolUse(
  parentToolUseId: unknown,
  state: ClaudeSdkMapperState
) {
  const toolUseId = getString(parentToolUseId)

  if (!toolUseId) {
    return undefined
  }

  return state.taskIdByToolUseId.get(toolUseId) ?? toolUseId
}

function rememberToolCall(
  state: ClaudeSdkMapperState,
  id: string,
  name: string,
  input?: unknown
) {
  state.toolNames.set(id, name)
  state.toolInputs.set(id, input)
  state.emittedToolCallIds.add(id)
}

function normalizeClaudeToolInput(
  name: string,
  input: unknown,
  state: ClaudeSdkMapperState
) {
  const record = getRecord(input)

  if (name !== "execute" || !record || !state.workspace) {
    return input
  }

  if (typeof record.cwd === "string" || typeof record.workdir === "string") {
    return input
  }

  return { ...record, cwd: state.workspace }
}

function getPlanUpdateEvent(
  input: unknown
): Extract<AgentEvent, { type: "plan_update" }> | null {
  const todos = getRecord(input)?.todos

  if (!Array.isArray(todos)) {
    return null
  }

  const normalizedTodos = todos.flatMap(
    (todo): Extract<AgentEvent, { type: "plan_update" }>["todos"] => {
      const record = getRecord(todo)
      const text = getString(record?.content)?.trim()
      const status = record?.status

      if (
        !text ||
        (status !== "pending" &&
          status !== "in_progress" &&
          status !== "completed")
      ) {
        return []
      }

      return [{ text, status }]
    }
  )

  return normalizedTodos.length
    ? { type: "plan_update", todos: normalizedTodos }
    : null
}

function createClaudeNativeTaskPlanEvent(state: ClaudeSdkMapperState) {
  const todos = [...state.claudeTasksById.values()]
  const signature = JSON.stringify(todos)

  if (signature === state.claudeTaskPlanSignature) {
    return null
  }

  state.claudeTaskPlanSignature = signature

  return {
    type: "plan_update",
    planId: "claude:tasks",
    variant: "items",
    todos,
    meta: { claudeCode: { source: "task-tools" } },
  } satisfies Extract<AgentEvent, { type: "plan_update" }>
}

function mapClaudeNativeTaskToolUse({
  id,
  input,
  name,
  state,
}: {
  id: string
  input: unknown
  name: string
  state: ClaudeSdkMapperState
}): AgentEvent[] {
  const kind = name.trim().toLowerCase().replace(/[^a-z]/g, "")
  const record = getRecord(input)

  if (
    !record ||
    !["taskcreate", "taskupdate", "tasklist", "taskget"].includes(kind)
  ) {
    return []
  }

  state.claudeTaskToolKinds.set(id, kind)

  if (kind === "taskcreate") {
    const text =
      getString(record.subject)?.trim() ||
      getString(record.description)?.trim() ||
      getString(record.activeForm)?.trim()

    if (text) {
      state.claudeTaskCreateToolIds.add(id)
      state.claudeTasksById.set(`pending:${id}`, {
        text,
        status: "pending",
      })
    }
  } else if (kind === "taskupdate") {
    const taskId =
      getString(record.taskId)?.trim() || getString(record.task_id)?.trim()

    if (taskId) {
      if (record.status === "deleted") {
        state.claudeTasksById.delete(taskId)
      } else {
        const previous = state.claudeTasksById.get(taskId)
        const text =
          getString(record.subject)?.trim() ||
          getString(record.description)?.trim() ||
          previous?.text ||
          taskId
        const status =
          record.status === "completed"
            ? "completed"
            : record.status === "in_progress" || record.status === "running"
              ? "in_progress"
              : (previous?.status ?? "pending")

        state.claudeTasksById.set(taskId, { text, status })
      }
    }
  }

  const event = createClaudeNativeTaskPlanEvent(state)

  return event ? [event] : []
}

function mapClaudeNativeTaskToolResult({
  id,
  result,
  state,
}: {
  id: string
  result: unknown
  state: ClaudeSdkMapperState
}): AgentEvent[] {
  const kind = state.claudeTaskToolKinds.get(id)

  if (!kind) {
    return []
  }

  const resultRecord = getRecord(result)
  const taskRecords = Array.isArray(resultRecord?.tasks)
    ? resultRecord.tasks
        .map((task) => getRecord(task))
        .filter((task): task is Record<string, unknown> => Boolean(task))
    : []
  const task = getRecord(resultRecord?.task) ?? resultRecord

  if (kind === "tasklist" || kind === "taskget") {
    const tasks = kind === "tasklist" ? taskRecords : task ? [task] : []

    if (kind === "tasklist" && tasks.length > 0) {
      state.claudeTasksById.clear()
    }

    for (const candidate of tasks) {
      const candidateId =
        getString(candidate.id)?.trim() ||
        getString(candidate.taskId)?.trim() ||
        getString(candidate.task_id)?.trim()
      const text =
        getString(candidate.subject)?.trim() ||
        getString(candidate.description)?.trim()

      if (!candidateId || !text || candidate.status === "deleted") {
        continue
      }

      state.claudeTasksById.set(candidateId, {
        text,
        status:
          candidate.status === "completed"
            ? "completed"
            : candidate.status === "in_progress" ||
                candidate.status === "running"
              ? "in_progress"
              : "pending",
      })
    }

    const event = createClaudeNativeTaskPlanEvent(state)

    return event ? [event] : []
  }

  if (kind !== "taskcreate" || !state.claudeTaskCreateToolIds.has(id)) {
    return []
  }

  const taskId =
    getString(task?.id)?.trim() ||
    getString(task?.taskId)?.trim() ||
    getString(task?.task_id)?.trim()

  if (!taskId) {
    return []
  }

  const temporaryId = `pending:${id}`
  const pending = state.claudeTasksById.get(temporaryId)
  const text =
    getString(task?.subject)?.trim() ||
    getString(task?.description)?.trim() ||
    pending?.text ||
    taskId

  state.claudeTaskCreateToolIds.delete(id)
  state.claudeTasksById.delete(temporaryId)
  state.claudeTasksById.set(taskId, {
    text,
    status:
      task?.status === "completed"
        ? "completed"
        : task?.status === "in_progress" || task?.status === "running"
          ? "in_progress"
          : "pending",
  })

  const event = createClaudeNativeTaskPlanEvent(state)

  return event ? [event] : []
}

function getFileChangeEvent({
  id,
  isError,
  name,
  result,
  state,
}: {
  id: string
  isError: boolean
  name: string
  result: unknown
  state: ClaudeSdkMapperState
}): Extract<AgentEvent, { type: "file_change" }> | null {
  if (name !== "edit_file" && name !== "write_file") {
    return null
  }

  const resultRecord = getRecord(result)
  const inputRecord = getRecord(state.toolInputs.get(id))
  const path =
    getString(resultRecord?.filePath) ??
    getString(inputRecord?.file_path) ??
    getString(inputRecord?.notebook_path)

  if (!path) {
    return null
  }

  const gitDiff = getRecord(resultRecord?.gitDiff)
  const diff = getString(gitDiff?.patch)
  const created = name === "write_file" && resultRecord?.type === "create"

  return {
    type: "file_change",
    path,
    kind: created ? "create" : "edit",
    status: isError ? "error" : "complete",
    ...(diff ? { diff } : {}),
    ...(isError ? { error: stringifyPayload(result) } : {}),
  }
}

function createToolCallEvent({
  id,
  input,
  name,
  parentTaskId,
  state,
}: {
  id: string
  input: unknown
  name: string
  parentTaskId?: string
  state: ClaudeSdkMapperState
}): AgentEvent | null {
  if (state.emittedToolCallIds.has(id)) {
    return null
  }

  const normalizedName = normalizeAgentToolName(name)
  const normalizedInput = normalizeClaudeToolInput(normalizedName, input, state)

  rememberToolCall(state, id, normalizedName, normalizedInput)

  return {
    type: "tool_call",
    id,
    name: normalizedName,
    input: stringifyPayload(normalizedInput),
    ...(parentTaskId ? { parentTaskId } : {}),
  }
}

function mapStreamEvent(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const event = getRecord(message.event)
  const parentTaskId = resolveTaskIdForParentToolUse(
    message.parent_tool_use_id,
    state
  )

  if (!event) {
    return []
  }

  if (event.type === "message_start" && !parentTaskId) {
    state.streamedBlocks = []
  }

  if (event.type !== "content_block_delta") {
    return []
  }

  const delta = getRecord(event.delta)
  const index = typeof event.index === "number" ? event.index : -1

  if (!delta) {
    return []
  }

  const chunk =
    delta.type === "text_delta" && typeof delta.text === "string"
      ? { text: delta.text, type: "text" as const }
      : delta.type === "thinking_delta" && typeof delta.thinking === "string"
        ? { text: delta.thinking, type: "thinking" as const }
        : null

  if (!chunk?.text) {
    return []
  }

  if (parentTaskId) {
    return [
      {
        type: "subagent_update",
        taskId: parentTaskId,
        status: "running",
        contentDelta: chunk.text,
      },
    ]
  }

  const last = state.streamedBlocks[state.streamedBlocks.length - 1]

  if (last && last.index === index && last.type === chunk.type) {
    last.text += chunk.text
  } else {
    state.streamedBlocks.push({ index, text: chunk.text, type: chunk.type })
  }

  return [
    chunk.type === "thinking"
      ? { type: "reasoning_delta", delta: chunk.text }
      : { type: "text_delta", delta: chunk.text },
  ]
}

function mapAssistantMessage(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const sdkMessage = getRecord(message.message)
  const content = Array.isArray(sdkMessage?.content) ? sdkMessage.content : []
  const parentTaskId = resolveTaskIdForParentToolUse(
    message.parent_tool_use_id,
    state
  )
  const events: AgentEvent[] = []
  let streamPos = 0

  for (const item of content) {
    const block = getRecord(item)

    if (!block) {
      continue
    }

    const blockText = getBlockText(block)

    if (blockText) {
      if (parentTaskId) {
        if (blockText.text) {
          events.push({
            type: "subagent_update",
            taskId: parentTaskId,
            name:
              getString(message.subagent_type) ??
              state.taskNames.get(parentTaskId),
            status: "running",
            contentDelta: blockText.text,
          })
        }
        continue
      }

      const streamed = state.streamedBlocks[streamPos]
      let text = blockText.text

      if (
        streamed &&
        streamed.type === blockText.type &&
        streamed.text.length > 0 &&
        blockText.text.startsWith(streamed.text)
      ) {
        streamPos += 1
        text = blockText.text.slice(streamed.text.length)
      }

      if (text) {
        events.push(
          blockText.type === "thinking"
            ? { type: "reasoning_delta", delta: text }
            : { type: "text_delta", delta: text }
        )
      }

      continue
    }

    const toolUse = getToolUseBlock(block)

    if (toolUse) {
      const event = createToolCallEvent({
        id: toolUse.id,
        input: toolUse.input,
        name: toolUse.name,
        parentTaskId,
        state,
      })

      if (event) {
        events.push(event)
      }

      events.push(
        ...mapClaudeNativeTaskToolUse({
          id: toolUse.id,
          input: toolUse.input,
          name: toolUse.name,
          state,
        })
      )

      if (
        state.toolNames.get(toolUse.id) === "update_plan" &&
        !state.emittedPlanToolCallIds.has(toolUse.id)
      ) {
        const planUpdate = getPlanUpdateEvent(toolUse.input)

        if (planUpdate) {
          state.emittedPlanToolCallIds.add(toolUse.id)
          events.push(planUpdate)
        }
      }
    }
  }

  if (!parentTaskId) {
    state.streamedBlocks = []
  }

  return events
}

function mapUserMessage(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const sdkMessage = getRecord(message.message)
  const content = Array.isArray(sdkMessage?.content) ? sdkMessage.content : []
  const parentTaskId = resolveTaskIdForParentToolUse(
    message.parent_tool_use_id,
    state
  )
  const checkpointId = getString(message.uuid)
  const events: AgentEvent[] = []
  const toolResults = content.flatMap((item) => {
    const block = getRecord(item)
    const toolResult = block ? getToolResultBlock(block) : null

    return toolResult ? [toolResult] : []
  })
  const structuredResult = message.tool_use_result

  if (checkpointId && toolResults.length === 0 && !parentTaskId) {
    events.push({
      type: "run_meta",
      metadata: {
        claudeCode: {
          checkpointId,
          checkpointing: true,
        },
      },
    })
  }

  for (const toolResult of toolResults) {
    if (state.completedToolCallIds.has(toolResult.id)) {
      continue
    }

    const name = state.toolNames.get(toolResult.id) ?? "tool"
    const result =
      toolResults.length === 1 && structuredResult !== undefined
        ? structuredResult
        : toolResult.content

    state.completedToolCallIds.add(toolResult.id)

    events.push({
      type: "tool_result",
      id: toolResult.id,
      name,
      status: toolResult.isError ? "error" : "complete",
      ...(toolResult.isError
        ? { error: stringifyPayload(result) }
        : { output: stringifyPayload(result) }),
      ...(parentTaskId ? { parentTaskId } : {}),
    })

    const fileChange = getFileChangeEvent({
      id: toolResult.id,
      isError: toolResult.isError,
      name,
      result,
      state,
    })

    if (fileChange) {
      events.push(fileChange)
    }

    events.push(
      ...mapClaudeNativeTaskToolResult({
        id: toolResult.id,
        result,
        state,
      })
    )
  }

  return events
}

function mapClaudeHookMessage(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const hookId = getString(message.hook_id)

  if (!hookId) {
    return []
  }

  const name = getString(message.hook_name) ?? "Hook"
  const hookEvent = getString(message.hook_event) ?? "hook"

  if (message.subtype === "hook_started") {
    if (state.emittedToolCallIds.has(hookId)) {
      return []
    }

    rememberToolCall(state, hookId, "hook", {
      event: hookEvent,
      name,
    })

    return [
      {
        type: "tool_call",
        id: hookId,
        name: "hook",
        title: formatClaudeHookTitle(hookEvent, name),
        kind: "think",
        input: stringifyPayload({ event: hookEvent, name }),
      },
    ]
  }

  if (message.subtype === "hook_progress") {
    return [
      {
        type: "tool_output",
        id: hookId,
        name: "hook",
        output:
          getString(message.output) ??
          getString(message.stdout) ??
          getString(message.stderr) ??
          "",
      },
    ]
  }

  const outcome = getString(message.outcome)
  const failed = outcome === "error" || outcome === "cancelled"

  state.completedToolCallIds.add(hookId)

  return [
    {
      type: "tool_result",
      id: hookId,
      name: "hook",
      status: failed ? "error" : "complete",
      ...(failed
        ? {
            error:
              getString(message.stderr) ??
              getString(message.output) ??
              `${name} ${outcome ?? "failed"}.`,
          }
        : {
            output:
              getString(message.output) ?? getString(message.stdout) ?? "",
          }),
    },
  ]
}

function mapClaudeStatusMessage(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  if (message.status === "compacting") {
    const id = `claude-compaction:${getString(message.uuid) ?? randomUUID()}`

    state.activeCompactionToolCallId = id
    return [
      {
        type: "tool_call",
        id,
        name: "context_compaction",
        title: "Context compaction",
        kind: "think",
        input: "",
      },
    ]
  }

  if (
    (message.compact_result === "success" ||
      message.compact_result === "failed") &&
    state.activeCompactionToolCallId
  ) {
    const id = state.activeCompactionToolCallId
    const failed = message.compact_result === "failed"

    state.activeCompactionToolCallId = null
    return [
      {
        type: "tool_result",
        id,
        name: "context_compaction",
        status: failed ? "error" : "complete",
        ...(failed
          ? {
              error:
                getString(message.compact_error) ??
                "Context compaction failed.",
            }
          : { output: "" }),
      },
    ]
  }

  return []
}

function getTaskName(message: Record<string, unknown>) {
  return (
    getString(message.subagent_type) ??
    getString(message.workflow_name) ??
    getString(message.task_type) ??
    "Task"
  )
}

function getTaskInput(message: Record<string, unknown>) {
  return (
    getString(message.prompt) ?? getString(message.description) ?? undefined
  )
}

function mapTaskStarted(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  if (message.skip_transcript === true) {
    return []
  }

  const taskId = getString(message.task_id)

  if (!taskId) {
    return []
  }

  const name = getTaskName(message)
  const toolUseId = getString(message.tool_use_id)

  if (toolUseId) {
    state.taskIdByToolUseId.set(toolUseId, taskId)
    state.toolUseIdByTaskId.set(taskId, toolUseId)
  }

  state.taskNames.set(taskId, name)

  return [
    {
      type: "subagent_start",
      taskId,
      name,
      ...(getTaskInput(message) ? { taskInput: getTaskInput(message) } : {}),
    },
  ]
}

function mapTaskProgress(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const taskId = getString(message.task_id)

  if (!taskId) {
    return []
  }

  const name = getTaskName(message)
  const summary = getString(message.summary)
  const description = getString(message.description)

  state.taskNames.set(taskId, name)

  return [
    {
      type: "subagent_update",
      taskId,
      name,
      status: "running",
      ...(description ? { taskInput: description } : {}),
      ...(summary
        ? { summary, contentDelta: summary }
        : description
          ? { content: description }
          : {}),
    },
  ]
}

function normalizeTaskUpdateStatus(status: unknown) {
  if (status === "completed") {
    return "complete" as const
  }

  if (status === "failed" || status === "killed") {
    return "error" as const
  }

  if (status === "pending" || status === "running" || status === "paused") {
    return "running" as const
  }

  return undefined
}

function mapTaskUpdated(message: Record<string, unknown>): AgentEvent[] {
  const taskId = getString(message.task_id)
  const patch = getRecord(message.patch)
  const status = normalizeTaskUpdateStatus(patch?.status)

  if (!taskId || (!status && !patch?.description && !patch?.error)) {
    return []
  }

  return [
    {
      type: "subagent_update",
      taskId,
      ...(status ? { status } : {}),
      ...(typeof patch?.description === "string"
        ? { content: patch.description }
        : {}),
      ...(typeof patch?.error === "string" ? { error: patch.error } : {}),
    },
  ]
}

function mapTaskNotification(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  if (message.skip_transcript === true) {
    return []
  }

  const taskId = getString(message.task_id)

  if (!taskId) {
    return []
  }

  const status = message.status === "completed" ? "complete" : "error"
  const name = state.taskNames.get(taskId) ?? getTaskName(message)
  const toolUseId =
    getString(message.tool_use_id) ?? state.toolUseIdByTaskId.get(taskId)
  const events: AgentEvent[] = [
    {
      type: "subagent_end",
      taskId,
      name,
      status,
      ...(typeof message.summary === "string"
        ? { summary: message.summary }
        : {}),
    },
  ]

  if (toolUseId && !state.completedToolCallIds.has(toolUseId)) {
    const toolName = state.toolNames.get(toolUseId) ?? "spawn_agent"
    const summary = getString(message.summary) ?? `${name} ${status}.`

    state.completedToolCallIds.add(toolUseId)
    events.push({
      type: "tool_result",
      id: toolUseId,
      name: toolName,
      status,
      ...(status === "complete" ? { output: summary } : { error: summary }),
    })
  }

  return events
}

function mapPermissionDenied(
  message: Record<string, unknown>,
  state: ClaudeSdkMapperState
): AgentEvent[] {
  const id = getString(message.tool_use_id)
  const name = normalizeAgentToolName(getString(message.tool_name) ?? "tool")

  if (!id) {
    return []
  }

  if (!state.emittedToolCallIds.has(id)) {
    rememberToolCall(state, id, name)
  }

  state.completedToolCallIds.add(id)

  return [
    {
      type: "tool_result",
      id,
      name,
      status: "error",
      error:
        getString(message.message) ??
        getString(message.decision_reason) ??
        "Tool use denied.",
    },
  ]
}

function mapResultMessage(message: Record<string, unknown>): AgentEvent[] {
  const usage = compactObject([
    ["duration_ms", message.duration_ms],
    ["duration_api_ms", message.duration_api_ms],
    ["num_turns", message.num_turns],
    ["stop_reason", message.stop_reason],
    ["total_cost_usd", message.total_cost_usd],
    ["usage", message.usage],
    ["modelUsage", message.modelUsage],
  ])
  const events: AgentEvent[] = []

  events.push({
    type: "run_meta",
    sessionRef: getString(message.session_id) ?? undefined,
    ...(usage ? { usage } : {}),
  })

  if (message.is_error === true) {
    const errors = Array.isArray(message.errors)
      ? message.errors.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : []

    events.push({
      type: "error",
      message:
        errors.join("\n") || getString(message.subtype) || "Claude run failed.",
    })
  }

  return events
}

function mapSystemInitMessage(message: Record<string, unknown>): AgentEvent[] {
  if (message.subtype !== "init") {
    return []
  }

  return [
    {
      type: "run_meta",
      sessionRef: getString(message.session_id) ?? undefined,
      usage: compactObject([
        ["claude_code_version", message.claude_code_version],
        ["model", message.model],
        ["permissionMode", message.permissionMode],
        ["tools", message.tools],
        ["mcp_servers", message.mcp_servers],
        ["skills", message.skills],
      ]),
    },
  ]
}

export function mapClaudeSdkMessageToAgentEvents(
  message: ClaudeSdkMappableMessage,
  state: ClaudeSdkMapperState = createClaudeSdkMapperState()
): AgentEvent[] {
  const record = getRecord(message)

  if (!record) {
    return []
  }

  if (record.type === "stream_event") {
    return mapStreamEvent(record, state)
  }

  if (record.type === "assistant") {
    return mapAssistantMessage(record, state)
  }

  if (record.type === "user") {
    return mapUserMessage(record, state)
  }

  if (record.type === "result") {
    return mapResultMessage(record)
  }

  if (record.type === "rate_limit_event") {
    return [
      {
        type: "run_meta",
        metadata: {
          claudeCode: { rateLimit: record.rate_limit_info ?? null },
        },
      },
    ]
  }

  if (
    record.type === "auth_status" ||
    record.type === "tool_use_summary" ||
    record.type === "prompt_suggestion" ||
    record.type === "conversation_reset"
  ) {
    return [
      {
        type: "run_meta",
        metadata: { claudeCode: record },
      },
    ]
  }

  if (record.type === "system") {
    if (record.subtype === "status") {
      return mapClaudeStatusMessage(record, state)
    }

    if (
      record.subtype === "hook_started" ||
      record.subtype === "hook_progress" ||
      record.subtype === "hook_response"
    ) {
      return mapClaudeHookMessage(record, state)
    }

    if (record.subtype === "notification") {
      return [
        {
          type: "run_meta",
          metadata: { claudeCode: { notification: record } },
        },
      ]
    }

    if (
      record.subtype === "informational" ||
      record.subtype === "local_command_output"
    ) {
      const text = getString(record.content) ?? getString(record.text)

      return text ? [{ type: "text_delta", delta: text }] : []
    }

    if (record.subtype === "task_started") {
      return mapTaskStarted(record, state)
    }

    if (record.subtype === "task_progress") {
      return mapTaskProgress(record, state)
    }

    if (record.subtype === "task_updated") {
      return mapTaskUpdated(record)
    }

    if (record.subtype === "task_notification") {
      return mapTaskNotification(record, state)
    }

    if (record.subtype === "permission_denied") {
      return mapPermissionDenied(record, state)
    }

    return mapSystemInitMessage(record)
  }

  return []
}

export function mapClaudeSdkMessagesToAgentEvents(
  messages: ClaudeSdkMappableMessage[],
  state: ClaudeSdkMapperState = createClaudeSdkMapperState()
) {
  return messages.flatMap((message) =>
    mapClaudeSdkMessageToAgentEvents(message, state)
  )
}

function getModelBaseUrl(model: AgentModelDefinition) {
  return (model.baseUrl ?? MODELVERSE_ANTHROPIC_BASE_URL).replace(
    /\/v1\/?$/i,
    ""
  )
}

function resolveClaudeNativeRunConfig(
  input: AgentRunInput
): ClaudeNativeRunConfig {
  const runtimeSetting = getRuntimeModelSetting(CLAUDE_NATIVE_RUNTIME_ID)

  if (!runtimeSetting || runtimeSetting.useLocalSettings) {
    return {}
  }

  const apiKey = getStudioModelverseApiKey()?.key

  if (!apiKey) {
    throw new Error("Modelverse API key is not configured locally.")
  }

  const model =
    resolveAgentModelForRuntime({
      modelId: input.model,
      runtimeId: CLAUDE_NATIVE_RUNTIME_ID,
    }) ?? getAgentModelById(input.model)

  if (!model) {
    throw new Error("No Modelverse model is configured for Claude Code.")
  }

  if (model.protocol !== "anthropic-messages") {
    throw new Error(`${model.label} does not support the Claude Agent SDK.`)
  }

  return {
    env: {
      ...process.env,
      ANTHROPIC_AUTH_TOKEN: " ",
      ANTHROPIC_BASE_URL: getModelBaseUrl(model),
      ANTHROPIC_CUSTOM_HEADERS: `Authorization: Bearer ${apiKey}`,
      ASTRAFLOW_MODELVERSE_API_KEY: apiKey,
      CLAUDE_AGENT_SDK_CLIENT_APP: "astraflow-desktop/0.0.11",
    },
    model: model.providerModel,
    settings: {
      availableModels: [model.providerModel],
      enforceAvailableModels: true,
      model: model.providerModel,
    },
  }
}

function mapReasoningEffort(
  effort: ChatReasoningEffort | undefined
): Pick<ClaudeAgentOptions, "effort" | "thinking"> {
  if (effort === "none") {
    return {
      thinking: { type: "disabled" },
    }
  }

  if (
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh" ||
    effort === "max"
  ) {
    return {
      effort,
      thinking: { type: "adaptive" },
    }
  }

  return {}
}

function createPermissionOptions(): PermissionOption[] {
  return [
    { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
    { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
    { optionId: "reject_once", name: "Deny", kind: "reject_once" },
  ]
}

function resolveClaudePermissionMode(
  mode: AgentRunInput["permissionMode"]
): PermissionMode {
  if (mode === "full_access") {
    return "bypassPermissions"
  }

  if (mode === "auto") {
    return "auto"
  }

  if (mode === "readonly") {
    return "plan"
  }

  return "default"
}

function resolveClaudeSandboxSettings(
  mode: AgentRunInput["permissionMode"]
): ClaudeAgentOptions["sandbox"] {
  if (mode === "full_access" || mode === "readonly") {
    return undefined
  }

  return {
    enabled: true,
    autoAllowBashIfSandboxed: mode === "auto",
    failIfUnavailable: false,
  }
}

function createClaudeCanUseTool({
  queue,
  sessionId,
  signal,
  state,
}: {
  queue: AgentEventQueue
  sessionId: string
  signal: AbortSignal
  state: ClaudeSdkMapperState
}): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    const requestId = randomUUID()
    const permissionOptions = createPermissionOptions()
    const displayToolName =
      options.displayName?.trim() || normalizeAgentToolName(toolName)
    const inputPreview = stringifyPayload(
      compactObject([
        ["title", options.title],
        ["description", options.description],
        ["input", input],
      ]) ?? input
    )
    const parentTaskId = getString(options.agentID) ?? undefined

    const toolCallEvent = createToolCallEvent({
      id: options.toolUseID,
      input,
      name: toolName,
      parentTaskId,
      state,
    })

    if (toolCallEvent) {
      queue.push(toolCallEvent)
    }

    queue.push({
      type: "permission_request",
      requestId,
      toolName: displayToolName,
      input: inputPreview,
      options: permissionOptions,
      status: "pending",
      selectedOptionId: null,
      decisions: [],
    })

    const decision = await requestPermission({
      sessionId,
      requestId,
      toolName,
      inputPreview,
      options: permissionOptions,
      useStudioPermissionRules: false,
      signal,
    })

    if ("cancelled" in decision) {
      queue.push({
        type: "permission_request",
        requestId,
        toolName: displayToolName,
        input: inputPreview,
        options: permissionOptions,
        status: "resolved",
        selectedOptionId: null,
        decisions: ["cancelled"],
      })

      return {
        behavior: "deny",
        message: "Tool use cancelled.",
        toolUseID: options.toolUseID,
      }
    }

    const selectedOption = permissionOptions.find(
      (candidate) => candidate.optionId === decision.optionId
    )
    const isAllow = selectedOption?.kind.startsWith("allow") ?? false

    queue.push({
      type: "permission_request",
      requestId,
      toolName: displayToolName,
      input: inputPreview,
      options: permissionOptions,
      status: "resolved",
      selectedOptionId: decision.optionId,
      decisions: [
        decision.feedback || selectedOption?.name || decision.optionId,
      ],
    })

    if (!isAllow) {
      return {
        behavior: "deny",
        message: decision.feedback || "Tool use denied.",
        toolUseID: options.toolUseID,
      }
    }

    return {
      behavior: "allow",
      ...(decision.optionId === "allow_always" && options.suggestions
        ? { updatedPermissions: options.suggestions }
        : {}),
      toolUseID: options.toolUseID,
    }
  }
}

function createClaudeQueryOptions({
  abortController,
  input,
  queue,
  runConfig,
  state,
}: {
  abortController: AbortController
  input: AgentRunInput
  queue: AgentEventQueue
  runConfig: ClaudeNativeRunConfig
  state: ClaudeSdkMapperState
}): ClaudeAgentOptions {
  return {
    abortController,
    agentProgressSummaries: true,
    canUseTool: createClaudeCanUseTool({
      queue,
      sessionId: input.sessionId,
      signal: input.signal,
      state,
    }),
    cwd: input.projectPath ?? process.cwd(),
    enableFileCheckpointing: true,
    env: getConfiguredPythonProcessEnvironment(runConfig.env),
    extraArgs: { "replay-user-messages": null },
    forwardSubagentText: true,
    includeHookEvents: true,
    includePartialMessages: true,
    permissionMode: resolveClaudePermissionMode(input.permissionMode),
    promptSuggestions: true,
    settingSources: ["user", "project", "local"],
    ...(input.permissionMode === "full_access"
      ? { allowDangerouslySkipPermissions: true }
      : {}),
    ...(resolveClaudeSandboxSettings(input.permissionMode)
      ? { sandbox: resolveClaudeSandboxSettings(input.permissionMode) }
      : {}),
    settings: runConfig.settings,
    systemPrompt: {
      append: formatAgentConductRules(),
      preset: "claude_code",
      type: "preset",
    },
    tools: { type: "preset", preset: "claude_code" },
    ...(runConfig.model ? { model: runConfig.model } : {}),
    ...(input.runtimeSessionRef?.trim()
      ? { resume: input.runtimeSessionRef.trim() }
      : {}),
    ...(process.env.CLAUDE_CODE_EXECUTABLE
      ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE }
      : {}),
    ...mapReasoningEffort(input.reasoningEffort),
  }
}

async function runClaudeNativeSdk({
  input,
  query,
  queue,
}: {
  input: AgentRunInput
  query?: ClaudeAgentQuery
  queue: AgentEventQueue
}) {
  const abortController = new AbortController()
  const abort = () => abortController.abort()
  const state = createClaudeSdkMapperState(input.projectPath ?? process.cwd())
  const runConfig = resolveClaudeNativeRunConfig(input)
  const sdkQuery =
    query ?? (await import("@anthropic-ai/claude-agent-sdk")).query
  const sdkRun = sdkQuery({
    prompt: createClaudePrompt(input.messages, {
      includeRecap: !input.runtimeSessionRef?.trim(),
    }),
    options: createClaudeQueryOptions({
      abortController,
      input,
      queue,
      runConfig,
      state,
    }),
  })

  void emitClaudeSupportedCommands({
    query: sdkRun,
    queue,
    signal: input.signal,
  })

  input.signal.addEventListener("abort", abort, { once: true })

  try {
    for await (const message of sdkRun) {
      for (const event of mapClaudeSdkMessageToAgentEvents(message, state)) {
        queue.push(event)
      }

      if (input.signal.aborted) {
        break
      }
    }
  } finally {
    input.signal.removeEventListener("abort", abort)
    cancelSessionPermissions(input.sessionId)
    sdkRun.close()
  }
}

export class ClaudeNativeRuntime implements AgentRuntime {
  readonly info: AgentRuntimeInfo
  private readonly query?: ClaudeAgentQuery

  constructor(options: ClaudeNativeRuntimeOptions = {}) {
    this.info = options.info ?? CLAUDE_NATIVE_RUNTIME_INFO
    this.query = options.query
  }

  startRun(input: AgentRunInput): AsyncIterable<AgentEvent> {
    const queue = new AgentEventQueue()

    if (input.environment === "remote") {
      queue.push({
        type: "error",
        message:
          "Claude Native is local-only. Use the Claude Code ACP runtime for Sandbox workspaces.",
      })
      queue.close()
      return queue
    }

    runClaudeNativeSdk({
      input,
      query: this.query,
      queue,
    })
      .catch((error) => {
        if (!isAbortLikeError(error, input.signal)) {
          queue.push({ type: "error", message: errorMessage(error) })
        }
      })
      .finally(() => queue.close())

    return queue
  }
}

export function createClaudeNativeRuntime(
  options?: ClaudeNativeRuntimeOptions
) {
  return new ClaudeNativeRuntime(options)
}

export function registerClaudeNativeRuntime() {
  registerAgentRuntime(createClaudeNativeRuntime())
}

registerClaudeNativeRuntime()
