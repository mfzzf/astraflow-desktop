import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"

export type AgentTodo = {
  text: string
  status: "pending" | "in_progress" | "completed"
  priority?: string | null
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
  | WithTrace<{
      type: "tool_call"
      id: string
      name: string
      input: string
      parentTaskId?: string
    }>
  | WithTrace<{
      type: "tool_result"
      id: string
      name: string
      status: "complete" | "error"
      output?: string
      error?: string
      parentTaskId?: string
    }>
  // Incremental output snapshot for a still-running tool call (e.g. live
  // terminal stdout). `output` is the full accumulated output so far, not a
  // delta, so repeated events are idempotent.
  | WithTrace<{
      type: "tool_output"
      id: string
      name?: string
      output: string
      parentTaskId?: string
    }>
  // Incremental input snapshot for a still-generating tool call: the model
  // streams argument JSON while writing the call (e.g. long file writes).
  // `input` is the full accumulated argument text so far, not a delta, so
  // repeated events are idempotent.
  | WithTrace<{
      type: "tool_input"
      id: string
      name?: string
      input: string
      parentTaskId?: string
    }>
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
