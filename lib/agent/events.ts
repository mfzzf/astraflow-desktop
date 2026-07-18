import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import type {
  AgentContentBlock,
  AgentPlanVariant,
  AgentToolCallContent,
  AgentToolCallLocation,
  AgentToolCallStatus,
} from "@/lib/agent/structured-content"

export type AgentTodo = {
  text: string
  status: "pending" | "in_progress" | "completed"
  priority?: string | null
  meta?: Record<string, unknown> | null
}

export type AgentUserInputOption = {
  optionId: string
  label: string
  description: string
}

export type AgentUserInputQuestion = {
  id: string
  header: string
  question: string
  options: AgentUserInputOption[]
  allowOther: boolean
  isSecret: boolean
}

export type AgentUserInputAnswer = {
  questionId: string
  optionId: string | null
  label: string | null
  text: string
}

export type AgentTraceRef = {
  runtimeId?: string
  provider?: string
  providerSessionId?: string
  threadId?: string
  turnId?: string
  itemId?: string
  parentTaskId?: string
  parentThreadId?: string
}

type WithTrace<T> = T & {
  trace?: AgentTraceRef
}

type AgentToolCallDetails = {
  title?: string | null
  kind?: string | null
  acpStatus?: AgentToolCallStatus | null
  locations?: AgentToolCallLocation[] | null
  content?: AgentToolCallContent[] | null
  rawInput?: unknown
  rawOutput?: unknown
  meta?: Record<string, unknown> | null
}

type AgentToolCallPatch = AgentToolCallDetails & {
  type: "tool_update"
  id: string
  name?: string
  parentTaskId?: string
}

export type AgentFileChangeEvent = WithTrace<{
  type: "file_change"
  path: string
  kind: "create" | "edit" | "delete"
  status?: "complete" | "error"
  error?: string
  diff?: string | null
  parentTaskId?: string
}>

export type AgentEvent =
  | WithTrace<{ type: "text_delta"; delta: string; messageId?: string }>
  | WithTrace<{ type: "reasoning_delta"; delta: string; messageId?: string }>
  | WithTrace<{
      type: "content_block"
      content: AgentContentBlock
      messageId?: string
      channel?: "message" | "thought"
    }>
  | WithTrace<{
      type: "assistant_retry"
      phase: "start" | "end"
      messageId: string
      channel: "text" | "reasoning"
      attempt: number
      maxAttempts?: number
      delayMs?: number
      success?: boolean
      errorMessage?: string
    }>
  | WithTrace<
      {
        type: "tool_call"
        id: string
        name: string
        input: string
        parentTaskId?: string
      } & AgentToolCallDetails
    >
  | WithTrace<AgentToolCallPatch>
  | WithTrace<
      {
        type: "tool_result"
        id: string
        name: string
        status: "complete" | "error"
        output?: string
        error?: string
        parentTaskId?: string
      } & AgentToolCallDetails
    >
  // Incremental output snapshot for a still-running tool call (e.g. live
  // terminal stdout). `output` is the full accumulated output so far, not a
  // delta, so repeated events are idempotent.
  | WithTrace<
      {
        type: "tool_output"
        id: string
        name?: string
        output: string
        parentTaskId?: string
      } & AgentToolCallDetails
    >
  // Incremental input snapshot for a still-generating tool call: the model
  // streams argument JSON while writing the call (e.g. long file writes).
  // `input` is the full accumulated argument text so far, not a delta, so
  // repeated events are idempotent.
  | WithTrace<
      {
        type: "tool_input"
        id: string
        name?: string
        input: string
        parentTaskId?: string
      } & AgentToolCallDetails
    >
  | WithTrace<{
      type: "media_generation"
      kind: "image" | "video"
      generationId: string
      status:
        | "queued"
        | "running"
        | "polling"
        | "complete"
        | "partial"
        | "error"
        | "cancelled"
      modelName: string
      prompt: string
      phase?: string | null
      progress?: number | null
      rawStatus?: string | null
      outputs: Array<{
        id: string
        index: number
        sessionFileId?: string | null
        contentUrl: string
        url: string | null
        storagePath: string | null
        mimeType: string | null
        width: number | null
        height: number | null
        durationSeconds?: number | null
      }>
      errorMessage?: string | null
      providerTaskId?: string | null
      providerRequestId?: string | null
      parentTaskId?: string
    }>
  | WithTrace<{
      type: "plan_update"
      todos: AgentTodo[]
      planId?: string
      variant?: AgentPlanVariant
      content?: string
      uri?: string
      meta?: Record<string, unknown> | null
    }>
  | WithTrace<{
      type: "plan_remove"
      planId: string
    }>
  | WithTrace<{
      type: "available-commands"
      commands: SlashCommandDescriptor[]
    }>
  | WithTrace<{
      type: "subagent_start"
      taskId: string
      name: string
      taskInput?: string
      parentTaskId?: string
    }>
  | WithTrace<{
      type: "subagent_update"
      taskId: string
      name?: string
      status?: "running" | "complete" | "error"
      taskInput?: string
      content?: string
      contentDelta?: string
      summary?: string
      error?: string
      todos?: AgentTodo[]
      parentTaskId?: string
    }>
  | WithTrace<{
      type: "subagent_end"
      taskId: string
      name: string
      summary?: string
      status?: "complete" | "error"
      error?: string
    }>
  | AgentFileChangeEvent
  | WithTrace<{
      type: "file_changes_snapshot"
      changes: AgentFileChangeEvent[]
      source: "provider" | "worktree"
    }>
  | WithTrace<{
      type: "permission_request"
      requestId: string
      toolName: string
      input: string
      decisions?: string[]
      options?: {
        optionId: string
        name: string
        kind: string
        _meta?: Record<string, unknown> | null
      }[]
      selectedOptionId?: string | null
      status?: "pending" | "resolved"
    }>
  | WithTrace<{
      type: "user_input_request"
      requestId: string
      questions: AgentUserInputQuestion[]
      answers?: AgentUserInputAnswer[]
      autoResolutionMs?: number | null
      status?: "pending" | "resolved"
    }>
  | WithTrace<{
      type: "run_meta"
      sessionRef?: string
      usage?: unknown
      metadata?: unknown
      sessionTitle?: string | null
    }>
  | WithTrace<{ type: "error"; message: string }>
