import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"
import { accessSync, constants, realpathSync } from "node:fs"
import { createConnection, createServer } from "node:net"
import { delimiter, isAbsolute, join, relative, resolve } from "node:path"

import { AgentEventQueue } from "@/lib/agent/event-queue"
import type { AgentEvent } from "@/lib/agent/events"
import type { PromptMention } from "@/lib/agent/composer-types"
import { normalizeAgentToolName } from "@/lib/agent/tool-names"
import { stringifyToolPayload } from "@/lib/agent/tool-payload"
import type {
  AgentRunInput,
  AgentRuntime,
  AgentRuntimeInfo,
} from "@/lib/agent/runtime"
import { registerAgentRuntime } from "@/lib/agent/runtime"

type JsonRecord = Record<string, unknown>
type AgentTodo = Extract<AgentEvent, { type: "plan_update" }>["todos"][number]

export type OpenCodeNativeTodo = {
  content: string
  status: string
  priority?: string
}

export type OpenCodeNativeModelRef = {
  providerID: string
  modelID: string
  variant?: string
}

export type OpenCodeNativeEvent = {
  id?: string
  type: string
  properties?: JsonRecord
  data?: JsonRecord
  durable?: {
    aggregateID: string
    seq: number
    version: number
  }
}

export type OpenCodeNativeMapperOptions = {
  emitUserText?: boolean
  parentSessionId?: string
  sessionId?: string
  workspace?: string | null
}

export type OpenCodeNativeMapperState = {
  emittedSubagents: Set<string>
  emittedSubagentEnds: Set<string>
  emittedToolCalls: Set<string>
  emittedToolResults: Set<string>
  messageRoles: Map<string, "assistant" | "user">
  partText: Map<string, string>
  partTypes: Map<string, string>
  reasoningText: Map<string, string>
  subagentNames: Map<string, string>
  textText: Map<string, string>
  toolInputs: Map<string, unknown>
  toolNames: Map<string, string>
  toolOutputs: Map<string, string>
  toolPlanSignatures: Map<string, string>
  toolSubagents: Map<string, string>
}

type OpenCodeNativeServerHandle = {
  baseUrl: string
  dispose: () => Promise<void>
}

export type OpenCodeNativeRuntimeOptions = {
  agent?: string | ((input: AgentRunInput) => string | null | undefined)
  baseUrl?: string
  commandEnv?: NodeJS.ProcessEnv
  executablePath?: string
  hostname?: string
  model?:
    | OpenCodeNativeModelRef
    | ((input: AgentRunInput) => OpenCodeNativeModelRef | null | undefined)
  port?: number
  pure?: boolean
  startupTimeoutMs?: number
}

export const OPENCODE_NATIVE_RUNTIME_ID = "opencode-native"

const OPENCODE_NATIVE_RUNTIME_INFO: AgentRuntimeInfo = {
  id: OPENCODE_NATIVE_RUNTIME_ID,
  label: "OpenCode Native",
  description: "OpenCode native HTTP/SSE server adapter",
  capabilities: {
    hitl: false,
    resume: true,
    subagents: true,
    plan: true,
    sandbox: false,
    mcp: true,
    skills: false,
    compact: true,
  },
  composer: {
    slashCommands: "none",
    fileMentions: "text",
    sessionMentions: true,
  },
}

const DEFAULT_HOSTNAME = "127.0.0.1"
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000
const PERMISSION_OPTIONS = [
  { optionId: "once", name: "Allow once", kind: "allow" },
  { optionId: "always", name: "Always allow", kind: "allow" },
  { optionId: "reject", name: "Reject", kind: "reject" },
]

function getRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null
    ? (value as JsonRecord)
    : null
}

function getString(value: unknown) {
  return typeof value === "string" ? value : null
}

function getNumber(value: unknown) {
  return typeof value === "number" ? value : null
}

function getOpenCodeEventPayload(event: OpenCodeNativeEvent) {
  return getRecord(event.properties) ?? getRecord(event.data) ?? {}
}

function normalizeOpenCodeEvent(event: unknown): OpenCodeNativeEvent | null {
  const record = getRecord(event)

  if (!record) {
    return null
  }

  const type = getString(record?.type)

  if (!type) {
    return null
  }

  return {
    ...(getString(record.id) ? { id: getString(record.id) ?? undefined } : {}),
    type,
    ...(getRecord(record.properties)
      ? { properties: getRecord(record.properties) ?? undefined }
      : {}),
    ...(getRecord(record.data)
      ? { data: getRecord(record.data) ?? undefined }
      : {}),
  }
}

function stringifyOpenCodePayload(value: unknown) {
  return stringifyToolPayload(value)
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return getRecord(parsed) ?? value
  } catch {
    return value
  }
}

function extractErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error
  }

  const record = getRecord(error)
  const data = getRecord(record?.data)
  const message =
    getString(record?.message) ??
    getString(record?.error) ??
    getString(data?.message) ??
    getString(data?.error) ??
    getString(record?.name)

  return message ?? stringifyOpenCodePayload(error)
}

function normalizeTodo(todo: unknown): AgentTodo | null {
  const record = getRecord(todo)
  const text = getString(record?.content)?.trim() ?? ""
  const status = getString(record?.status)

  if (!text) {
    return null
  }

  if (
    status !== "pending" &&
    status !== "in_progress" &&
    status !== "completed"
  ) {
    return null
  }

  return { text, status }
}

function isAgentTodo(todo: AgentTodo | null): todo is AgentTodo {
  return todo !== null
}

function mapDiffStatus(status: unknown): "create" | "delete" | "edit" {
  if (status === "added") {
    return "create"
  }

  if (status === "deleted") {
    return "delete"
  }

  return "edit"
}

function inferFileChangeKind(toolName: string): "create" | "delete" | "edit" {
  const normalized = toolName.toLowerCase()

  if (normalized.includes("delete") || normalized.includes("remove")) {
    return "delete"
  }

  if (normalized.includes("write") || normalized.includes("create")) {
    return "create"
  }

  return "edit"
}

function isFileMutationTool(toolName: string) {
  const normalized = toolName.toLowerCase()

  return (
    normalized.includes("create") ||
    normalized.includes("delete") ||
    normalized.includes("edit") ||
    normalized.includes("patch") ||
    normalized.includes("remove") ||
    normalized.includes("write")
  )
}

function getToolInputPath(input: unknown) {
  const record = getRecord(input)

  if (!record) {
    return typeof input === "string" ? input.trim() : ""
  }

  const candidate =
    record.file ??
    record.filePath ??
    record.file_path ??
    record.path ??
    record.absolute_path

  return typeof candidate === "string" ? candidate.trim() : ""
}

function getWorkspacePath(path: string, workspace?: string | null) {
  const normalizedPath = path.trim()

  if (!normalizedPath) {
    return ""
  }

  if (workspace && isAbsolute(normalizedPath)) {
    const relativePath = relative(workspace, normalizedPath)

    if (
      relativePath &&
      !relativePath.startsWith("..") &&
      !isAbsolute(relativePath)
    ) {
      return relativePath.replaceAll("\\", "/")
    }
  }

  return normalizedPath.replaceAll("\\", "/")
}

function normalizeOpenCodeToolInput(
  toolName: string,
  input: unknown,
  workspace?: string | null
) {
  const record = getRecord(input)

  if ((toolName !== "shell" && toolName !== "execute") || !record) {
    return input
  }

  const configuredCwd =
    getString(record.cwd)?.trim() ?? getString(record.workdir)?.trim() ?? ""
  const cwd = configuredCwd
    ? workspace && !isAbsolute(configuredCwd)
      ? resolve(workspace, configuredCwd)
      : configuredCwd
    : workspace?.trim() || ""

  return cwd ? { ...record, cwd } : record
}

function createOpenCodeFileChange({
  diff,
  kind,
  path,
  workspace,
}: {
  diff?: string | null
  kind: "create" | "delete" | "edit"
  path: string
  workspace?: string | null
}): Extract<AgentEvent, { type: "file_change" }> | null {
  const displayPath = getWorkspacePath(path, workspace)

  if (!displayPath) {
    return null
  }

  return {
    type: "file_change",
    path: displayPath,
    kind,
    status: "complete",
    ...(diff?.trim() ? { diff: diff.trim() } : {}),
  }
}

function getFileChangeFromTool(
  toolName: string,
  input: unknown,
  outputPaths: unknown,
  metadata?: unknown,
  workspace?: string | null
) {
  if (!isFileMutationTool(toolName)) {
    return []
  }

  const metadataRecord = getRecord(metadata)
  const metadataFiles = Array.isArray(metadataRecord?.files)
    ? metadataRecord.files
    : []
  const structuredChanges = metadataFiles.flatMap((item) => {
    const record = getRecord(item)
    const path =
      getString(record?.relativePath) ??
      getString(record?.movePath) ??
      getString(record?.filePath)

    if (!path) {
      return []
    }

    const type = getString(record?.type)
    const event = createOpenCodeFileChange({
      path,
      workspace,
      kind:
        type === "add" || type === "create"
          ? "create"
          : type === "delete" || type === "remove"
            ? "delete"
            : "edit",
      diff: getString(record?.patch) ?? getString(record?.diff),
    })

    return event ? [event] : []
  })

  if (structuredChanges.length) {
    return structuredChanges
  }

  const fileDiff = getRecord(metadataRecord?.filediff)
  const fileDiffPath =
    getString(fileDiff?.file) ?? getString(fileDiff?.path) ?? ""

  if (fileDiffPath) {
    const event = createOpenCodeFileChange({
      path: fileDiffPath,
      workspace,
      kind: inferFileChangeKind(toolName),
      diff: getString(fileDiff?.patch),
    })

    return event ? [event] : []
  }

  const metadataPath = getString(metadataRecord?.filepath)?.trim() ?? ""

  if (metadataPath) {
    const event = createOpenCodeFileChange({
      path: metadataPath,
      workspace,
      kind:
        toolName === "write_file"
          ? metadataRecord?.exists === false
            ? "create"
            : "edit"
          : inferFileChangeKind(toolName),
      diff: getString(metadataRecord?.diff),
    })

    return event ? [event] : []
  }

  const paths = Array.isArray(outputPaths)
    ? outputPaths.filter((path): path is string => typeof path === "string")
    : []
  const inputPath = getToolInputPath(input)
  const candidates = paths.length ? paths : inputPath ? [inputPath] : []

  return candidates.flatMap((path) => {
    const event = createOpenCodeFileChange({
      path,
      workspace,
      kind: inferFileChangeKind(toolName),
    })

    return event ? [event] : []
  })
}

function getContentText(content: unknown) {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return stringifyOpenCodePayload(content)
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part
      }

      const record = getRecord(part)
      const text = getString(record?.text)

      if (text) {
        return text
      }

      if (record?.type === "image_url") {
        return "[image]"
      }

      return stringifyOpenCodePayload(part)
    })
    .filter(Boolean)
    .join("\n")
}

function getLatestImageParts(messages: AgentRunInput["messages"]) {
  const latestHuman =
    [...messages].reverse().find((message) => message._getType() === "human") ??
    messages.at(-1)

  if (!latestHuman || !Array.isArray(latestHuman.content)) {
    return []
  }

  return latestHuman.content.flatMap((part, index) => {
    const record = getRecord(part)
    if (record?.type !== "image_url") {
      return []
    }

    const imageUrl = getRecord(record.image_url)
    const url =
      typeof record.image_url === "string"
        ? record.image_url
        : getString(imageUrl?.url)
    const match = url?.match(
      /^data:(image\/(?:gif|jpeg|png|webp));base64,[\s\S]+$/i
    )

    return match
      ? [
          {
            type: "file",
            mime: match[1].toLowerCase(),
            filename: `image-${index + 1}.${match[1].split("/")[1]}`,
            url,
          },
        ]
      : []
  })
}

function getFilePromptMentions(message: AgentRunInput["messages"][number]) {
  const mentions = (message as { additional_kwargs?: { mentions?: unknown } })
    .additional_kwargs?.mentions

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

function appendReferencedFiles(
  text: string,
  message: AgentRunInput["messages"][number]
) {
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

function getLatestPromptText(messages: AgentRunInput["messages"]) {
  const latestHuman =
    [...messages].reverse().find((message) => message._getType() === "human") ??
    messages.at(-1)

  return latestHuman
    ? appendReferencedFiles(
        getContentText(latestHuman.content),
        latestHuman
      ).trim()
    : ""
}

function getEventSessionId(event: OpenCodeNativeEvent) {
  const payload = getOpenCodeEventPayload(event)
  const info = getRecord(payload.info)
  const part = getRecord(payload.part)

  return (
    getString(payload.sessionID) ??
    getString(info?.sessionID) ??
    getString(part?.sessionID)
  )
}

function getEventParentSessionId(event: OpenCodeNativeEvent) {
  const info = getRecord(getOpenCodeEventPayload(event).info)

  return getString(info?.parentID)
}

function getEventSubagentId(
  event: OpenCodeNativeEvent,
  state: OpenCodeNativeMapperState,
  options: OpenCodeNativeMapperOptions
) {
  const sessionId = getEventSessionId(event)

  return sessionId &&
    sessionId !== options.sessionId &&
    state.emittedSubagents.has(sessionId)
    ? sessionId
    : null
}

function eventMatchesSession(
  event: OpenCodeNativeEvent,
  state: OpenCodeNativeMapperState,
  options: OpenCodeNativeMapperOptions
) {
  if (!options.sessionId) {
    return true
  }

  const eventSessionId = getEventSessionId(event)
  const parentID = getEventParentSessionId(event)

  return (
    eventSessionId === options.sessionId ||
    parentID === options.sessionId ||
    Boolean(eventSessionId && state.emittedSubagents.has(eventSessionId))
  )
}

function getPermissionInput(payload: JsonRecord) {
  const input: JsonRecord = {}

  for (const key of [
    "permission",
    "action",
    "resources",
    "patterns",
    "metadata",
    "always",
    "source",
    "tool",
  ]) {
    if (payload[key] !== undefined) {
      input[key] = payload[key]
    }
  }

  return stringifyOpenCodePayload(input)
}

function createPermissionRequestEvent(
  requestId: string,
  toolName: string,
  input: string
): Extract<AgentEvent, { type: "permission_request" }> {
  return {
    type: "permission_request",
    requestId,
    toolName,
    input,
    decisions: ["once", "always", "reject"],
    options: PERMISSION_OPTIONS,
    selectedOptionId: null,
    status: "pending",
  }
}

function mapQuestionAsked(
  payload: JsonRecord
): Extract<AgentEvent, { type: "permission_request" }> | null {
  const requestId = getString(payload.id)
  const questions = Array.isArray(payload.questions) ? payload.questions : []

  if (!requestId || !questions.length) {
    return null
  }

  const firstQuestion = getRecord(questions[0])
  const options = Array.isArray(firstQuestion?.options)
    ? firstQuestion.options
        .map((option) => {
          const record = getRecord(option)
          const label = getString(record?.label)

          return label
            ? {
                optionId: label,
                name: label,
                kind: "choice",
              }
            : null
        })
        .filter((option): option is NonNullable<typeof option> =>
          Boolean(option)
        )
    : []

  return {
    type: "permission_request",
    requestId,
    toolName: "question",
    input: stringifyOpenCodePayload({
      questions,
      tool: payload.tool,
    }),
    decisions: options.map((option) => option.optionId),
    options,
    selectedOptionId: null,
    status: "pending",
  }
}

function getToolResultOutput(payload: JsonRecord) {
  if (Array.isArray(payload.content)) {
    const content = payload.content
      .map((part) => {
        const record = getRecord(part)

        return getString(record?.text) ?? stringifyOpenCodePayload(part)
      })
      .join("\n")

    if (content) {
      return content
    }
  }

  if (payload.result !== undefined) {
    return stringifyOpenCodePayload(payload.result)
  }

  if (payload.structured !== undefined) {
    return stringifyOpenCodePayload(payload.structured)
  }

  return ""
}

function emitToolCall(
  state: OpenCodeNativeMapperState,
  callID: string,
  toolName: string,
  input: unknown,
  parentTaskId?: string | null
): AgentEvent[] {
  state.toolNames.set(callID, toolName)
  state.toolInputs.set(callID, input)

  if (state.emittedToolCalls.has(callID)) {
    return []
  }

  state.emittedToolCalls.add(callID)

  return [
    {
      type: "tool_call",
      id: callID,
      name: toolName,
      input: stringifyOpenCodePayload(input),
      ...(parentTaskId ? { parentTaskId } : {}),
    },
  ]
}

function emitToolResult({
  callID,
  output,
  state,
  status,
  toolName,
  error,
  parentTaskId,
}: {
  callID: string
  output?: string
  state: OpenCodeNativeMapperState
  status: "complete" | "error"
  toolName: string
  error?: string
  parentTaskId?: string | null
}): AgentEvent[] {
  if (state.emittedToolResults.has(callID)) {
    return []
  }

  state.emittedToolResults.add(callID)

  if (status === "error") {
    return [
      {
        type: "tool_result",
        id: callID,
        name: toolName,
        status: "error",
        ...(output ? { output } : {}),
        error: error || output || "Tool call failed.",
        ...(parentTaskId ? { parentTaskId } : {}),
      },
    ]
  }

  return [
    {
      type: "tool_result",
      id: callID,
      name: toolName,
      status: "complete",
      output,
      ...(parentTaskId ? { parentTaskId } : {}),
    },
  ]
}

function emitToolOutput(
  state: OpenCodeNativeMapperState,
  callID: string,
  toolName: string,
  output: string,
  parentTaskId?: string | null
): AgentEvent[] {
  if (!output || state.toolOutputs.get(callID) === output) {
    return []
  }

  state.toolOutputs.set(callID, output)

  return [
    {
      type: "tool_output",
      id: callID,
      name: toolName,
      output,
      ...(parentTaskId ? { parentTaskId } : {}),
    },
  ]
}

function getOpenCodeToolExitCode(metadata: unknown) {
  const record = getRecord(metadata)
  const value = record?.exit ?? record?.exitCode ?? record?.exit_code

  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value)
  }

  return null
}

function formatOpenCodeCommandResult(output: string, metadata: unknown) {
  return stringifyOpenCodePayload({
    formatted_output: output,
    exit_code: getOpenCodeToolExitCode(metadata),
  })
}

function getTaskEnvelope(output: string) {
  const state = output.match(
    /<task\b[^>]*\bstate="(running|completed|error)"/i
  )?.[1]
  const result = output.match(
    /<task_result>\s*([\s\S]*?)\s*<\/task_result>/i
  )?.[1]
  const error = output.match(/<task_error>\s*([\s\S]*?)\s*<\/task_error>/i)?.[1]

  return {
    state: state?.toLowerCase() as
      "running" | "completed" | "error" | undefined,
    text: (result ?? error ?? output).trim(),
  }
}

function emitSubagentStart({
  name,
  state,
  taskId,
  taskInput,
}: {
  name: string
  state: OpenCodeNativeMapperState
  taskId: string
  taskInput?: string
}): AgentEvent[] {
  state.subagentNames.set(taskId, name)

  if (state.emittedSubagents.has(taskId)) {
    return []
  }

  state.emittedSubagents.add(taskId)

  return [
    {
      type: "subagent_start",
      taskId,
      name,
      ...(taskInput ? { taskInput } : {}),
    },
  ]
}

function emitSubagentEnd({
  error,
  name,
  state,
  summary,
  taskId,
}: {
  error?: string
  name?: string
  state: OpenCodeNativeMapperState
  summary?: string
  taskId: string
}): AgentEvent[] {
  if (state.emittedSubagentEnds.has(taskId)) {
    return []
  }

  state.emittedSubagentEnds.add(taskId)

  return [
    {
      type: "subagent_end",
      taskId,
      name: name ?? state.subagentNames.get(taskId) ?? "subagent",
      status: error ? "error" : "complete",
      ...(summary ? { summary } : {}),
      ...(error ? { error } : {}),
    },
  ]
}

function getTaskToolEvents(
  part: JsonRecord,
  toolState: JsonRecord,
  state: OpenCodeNativeMapperState
) {
  const callID = getString(part.callID)
  const status = getString(toolState.status)
  const input = getRecord(toolState.input) ?? {}
  const metadata = getRecord(toolState.metadata)
  const metadataTaskId =
    getString(metadata?.sessionId) ?? getString(metadata?.sessionID)
  const existingTaskId = callID ? state.toolSubagents.get(callID) : null
  const taskId = metadataTaskId ?? existingTaskId

  if (
    !callID ||
    !status ||
    (!taskId && status !== "completed" && status !== "error")
  ) {
    return []
  }

  const resolvedTaskId = taskId ?? callID
  const name =
    getString(input.subagent_type) ??
    getString(input.agent) ??
    getString(metadata?.agent) ??
    "subagent"
  const taskInput =
    getString(input.prompt) ??
    getString(input.description) ??
    stringifyOpenCodePayload(input)
  const events = emitSubagentStart({
    state,
    taskId: resolvedTaskId,
    name,
    taskInput,
  })

  state.toolSubagents.set(callID, resolvedTaskId)

  if (status === "error") {
    const error = extractErrorMessage(toolState.error)

    return [
      ...events,
      ...emitSubagentEnd({
        state,
        taskId: resolvedTaskId,
        name,
        error,
      }),
    ]
  }

  if (status !== "completed") {
    return events
  }

  const envelope = getTaskEnvelope(getString(toolState.output) ?? "")
  const isBackgroundRunning =
    metadata?.background === true || envelope.state === "running"

  if (isBackgroundRunning) {
    return [
      ...events,
      ...(envelope.text
        ? [
            {
              type: "subagent_update" as const,
              taskId: resolvedTaskId,
              name,
              status: "running" as const,
              summary: envelope.text,
            },
          ]
        : []),
    ]
  }

  if (state.emittedSubagentEnds.has(resolvedTaskId)) {
    return [
      ...events,
      ...(envelope.text
        ? [
            {
              type: "subagent_update" as const,
              taskId: resolvedTaskId,
              name,
              status:
                envelope.state === "error"
                  ? ("error" as const)
                  : ("complete" as const),
              summary: envelope.text,
              ...(envelope.state === "error" ? { error: envelope.text } : {}),
            },
          ]
        : []),
    ]
  }

  return [
    ...events,
    ...emitSubagentEnd({
      state,
      taskId: resolvedTaskId,
      name,
      summary: envelope.text || undefined,
      ...(envelope.state === "error"
        ? { error: envelope.text || "Subagent failed." }
        : {}),
    }),
  ]
}

function getPlanEventsFromToolState(
  callID: string,
  toolState: JsonRecord,
  state: OpenCodeNativeMapperState
): AgentEvent[] {
  const metadata = getRecord(toolState.metadata)
  const rawTodos = Array.isArray(metadata?.todos)
    ? metadata.todos
    : Array.isArray(getRecord(toolState.input)?.todos)
      ? (getRecord(toolState.input)?.todos as unknown[])
      : null

  if (!rawTodos) {
    return []
  }

  const normalized = rawTodos.map(normalizeTodo).filter(isAgentTodo)
  const signature = stringifyOpenCodePayload(normalized)

  if (state.toolPlanSignatures.get(callID) === signature) {
    return []
  }

  state.toolPlanSignatures.set(callID, signature)

  return [{ type: "plan_update", todos: normalized }]
}

function mapToolPart(
  part: JsonRecord,
  state: OpenCodeNativeMapperState,
  options: OpenCodeNativeMapperOptions,
  parentTaskId?: string | null
): AgentEvent[] {
  const callID = getString(part.callID)
  const rawToolName = getString(part.tool)
  const toolState = getRecord(part.state)
  const status = getString(toolState?.status)

  if (!callID || !rawToolName || !toolState || !status) {
    return []
  }

  const toolName = normalizeAgentToolName(rawToolName)
  const rawInput =
    toolState.input ??
    (typeof toolState.raw === "string" ? parseJsonObject(toolState.raw) : {})
  const input = normalizeOpenCodeToolInput(
    toolName,
    rawInput,
    options.workspace
  )
  const events: AgentEvent[] = []

  if (toolName === "spawn_agent") {
    return getTaskToolEvents(part, toolState, state)
  }

  if (toolName === "update_plan") {
    return getPlanEventsFromToolState(callID, toolState, state)
  }

  // Pending parts contain an incomplete `raw` JSON buffer. Waiting until
  // OpenCode publishes the running state prevents a sticky `{}` input from
  // replacing the real command/file payload in the activity UI.
  if (status === "pending") {
    state.toolNames.set(callID, toolName)
    state.toolInputs.set(callID, input)
    return []
  }

  events.push(...emitToolCall(state, callID, toolName, input, parentTaskId))

  if (status === "running") {
    const liveOutput = getString(getRecord(toolState.metadata)?.output) ?? ""

    events.push(
      ...emitToolOutput(state, callID, toolName, liveOutput, parentTaskId)
    )
  }

  if (status === "completed") {
    const metadata = getRecord(toolState.metadata)
    const output = getString(toolState.output) ?? ""

    events.push(
      ...emitToolResult({
        callID,
        output:
          toolName === "shell"
            ? formatOpenCodeCommandResult(output, metadata)
            : output,
        state,
        status: "complete",
        toolName,
        parentTaskId,
      }),
      ...getFileChangeFromTool(
        toolName,
        rawInput,
        undefined,
        metadata,
        options.workspace
      )
    )
  }

  if (status === "error") {
    const metadata = getRecord(toolState.metadata)
    const error = extractErrorMessage(toolState.error)
    const partialOutput = getString(metadata?.output) ?? ""

    events.push(
      ...emitToolResult({
        callID,
        output:
          toolName === "shell" && partialOutput
            ? formatOpenCodeCommandResult(partialOutput, metadata)
            : partialOutput,
        error,
        state,
        status: "error",
        toolName,
        parentTaskId,
      })
    )
  }

  return events
}

function mapPartUpdated(
  payload: JsonRecord,
  state: OpenCodeNativeMapperState,
  options: OpenCodeNativeMapperOptions,
  parentTaskId?: string | null
): AgentEvent[] {
  const part = getRecord(payload.part)
  const partID = getString(part?.id)
  const partType = getString(part?.type)

  if (!part || !partID || !partType) {
    return []
  }

  state.partTypes.set(partID, partType)

  const messageID = getString(part.messageID)
  const messageRole = messageID ? state.messageRoles.get(messageID) : undefined

  if (messageRole === "user" && !options.emitUserText) {
    return []
  }

  if (partType === "text" || partType === "reasoning") {
    const text = getString(part.text) ?? ""
    const previous = state.partText.get(partID) ?? ""
    const delta = text.startsWith(previous) ? text.slice(previous.length) : text

    state.partText.set(partID, text)

    if (!delta) {
      return []
    }

    if (parentTaskId) {
      return partType === "text"
        ? [
            {
              type: "subagent_update",
              taskId: parentTaskId,
              contentDelta: delta,
              status: "running",
            },
          ]
        : []
    }

    return [
      partType === "reasoning"
        ? { type: "reasoning_delta", delta }
        : { type: "text_delta", delta },
    ]
  }

  if (partType === "tool") {
    return mapToolPart(part, state, options, parentTaskId)
  }

  if (partType === "patch") {
    const files = Array.isArray(part.files) ? part.files : []

    return files.flatMap((path) => {
      if (typeof path !== "string") {
        return []
      }

      const event = createOpenCodeFileChange({
        path,
        workspace: options.workspace,
        kind: "edit",
      })

      return event
        ? [
            {
              ...event,
              ...(parentTaskId ? { parentTaskId } : {}),
            },
          ]
        : []
    })
  }

  if (partType === "subtask") {
    const taskId = partID

    if (state.emittedSubagents.has(taskId)) {
      return []
    }

    return emitSubagentStart({
      state,
      taskId,
      name: getString(part.agent) ?? "subagent",
      taskInput:
        getString(part.prompt) ??
        getString(part.description) ??
        stringifyOpenCodePayload(part),
    })
  }

  return []
}

function mapSessionInfoEvent(
  payload: JsonRecord,
  state: OpenCodeNativeMapperState,
  options: OpenCodeNativeMapperOptions
): AgentEvent[] {
  const info = getRecord(payload.info)
  const sessionID = getString(info?.id) ?? getString(payload.sessionID)
  const parentID = getString(info?.parentID)

  if (
    !sessionID ||
    !parentID ||
    (options.sessionId && parentID !== options.sessionId)
  ) {
    return []
  }

  return emitSubagentStart({
    state,
    taskId: sessionID,
    name: getString(info?.agent) ?? "subagent",
    taskInput: getString(info?.title) ?? undefined,
  }).map((event) =>
    options.parentSessionId && event.type === "subagent_start"
      ? { ...event, parentTaskId: options.parentSessionId }
      : event
  )
}

function mapUsageEvent(payload: JsonRecord): AgentEvent[] {
  const info = getRecord(payload.info) ?? payload
  const role = getString(info.role)
  const cost = getNumber(info.cost)
  const tokens = getRecord(info.tokens)

  if (role && role !== "assistant") {
    return []
  }

  if (cost === null && !tokens) {
    return []
  }

  return [
    {
      type: "run_meta",
      usage: {
        ...(cost !== null ? { cost } : {}),
        ...(tokens ? { tokens } : {}),
      },
    },
  ]
}

export function createOpenCodeNativeMapperState(): OpenCodeNativeMapperState {
  return {
    emittedSubagents: new Set(),
    emittedSubagentEnds: new Set(),
    emittedToolCalls: new Set(),
    emittedToolResults: new Set(),
    messageRoles: new Map(),
    partText: new Map(),
    partTypes: new Map(),
    reasoningText: new Map(),
    subagentNames: new Map(),
    textText: new Map(),
    toolInputs: new Map(),
    toolNames: new Map(),
    toolOutputs: new Map(),
    toolPlanSignatures: new Map(),
    toolSubagents: new Map(),
  }
}

export function mapOpenCodeNativeEventToAgentEvents(
  rawEvent: unknown,
  state: OpenCodeNativeMapperState = createOpenCodeNativeMapperState(),
  options: OpenCodeNativeMapperOptions = {}
): AgentEvent[] {
  const event = normalizeOpenCodeEvent(rawEvent)

  if (!event || !eventMatchesSession(event, state, options)) {
    return []
  }

  const payload = getOpenCodeEventPayload(event)
  const parentTaskId = getEventSubagentId(event, state, options)

  switch (event.type) {
    case "message.updated": {
      const info = getRecord(payload.info)
      const messageID = getString(info?.id)
      const role = getString(info?.role)

      if (messageID && (role === "assistant" || role === "user")) {
        state.messageRoles.set(messageID, role)
      }

      if (info?.error) {
        const message = extractErrorMessage(info.error)

        return parentTaskId
          ? emitSubagentEnd({
              state,
              taskId: parentTaskId,
              error: message,
            })
          : [{ type: "error", message }]
      }

      return parentTaskId ? [] : mapUsageEvent(payload)
    }
    case "message.part.delta": {
      const partID = getString(payload.partID)
      const delta = getString(payload.delta) ?? ""
      const field = getString(payload.field)
      const partType = partID ? state.partTypes.get(partID) : null

      if (!partID || field !== "text" || !delta) {
        return []
      }

      state.partText.set(partID, `${state.partText.get(partID) ?? ""}${delta}`)

      if (parentTaskId) {
        return partType === "text"
          ? [
              {
                type: "subagent_update",
                taskId: parentTaskId,
                contentDelta: delta,
                status: "running",
              },
            ]
          : []
      }

      return [
        partType === "reasoning"
          ? { type: "reasoning_delta", delta }
          : { type: "text_delta", delta },
      ]
    }
    case "message.part.updated":
      return mapPartUpdated(payload, state, options, parentTaskId)
    case "session.next.text.delta": {
      const textID = getString(payload.textID)
      const delta = getString(payload.delta) ?? ""

      if (textID) {
        state.textText.set(
          textID,
          `${state.textText.get(textID) ?? ""}${delta}`
        )
      }

      if (!delta) {
        return []
      }

      return parentTaskId
        ? [
            {
              type: "subagent_update",
              taskId: parentTaskId,
              contentDelta: delta,
              status: "running",
            },
          ]
        : [{ type: "text_delta", delta }]
    }
    case "session.next.text.ended": {
      const textID = getString(payload.textID)
      const text = getString(payload.text) ?? ""

      if (!textID || state.textText.has(textID) || !text) {
        return []
      }

      state.textText.set(textID, text)

      return parentTaskId
        ? [
            {
              type: "subagent_update",
              taskId: parentTaskId,
              contentDelta: text,
              status: "running",
            },
          ]
        : [{ type: "text_delta", delta: text }]
    }
    case "session.next.reasoning.delta": {
      const reasoningID = getString(payload.reasoningID)
      const delta = getString(payload.delta) ?? ""

      if (reasoningID) {
        state.reasoningText.set(
          reasoningID,
          `${state.reasoningText.get(reasoningID) ?? ""}${delta}`
        )
      }

      return delta && !parentTaskId ? [{ type: "reasoning_delta", delta }] : []
    }
    case "session.next.reasoning.ended": {
      const reasoningID = getString(payload.reasoningID)
      const text = getString(payload.text) ?? ""

      if (!reasoningID || state.reasoningText.has(reasoningID) || !text) {
        return []
      }

      state.reasoningText.set(reasoningID, text)

      return parentTaskId ? [] : [{ type: "reasoning_delta", delta: text }]
    }
    case "session.next.tool.input.started": {
      const callID = getString(payload.callID)
      const toolName = getString(payload.name)

      if (callID && toolName) {
        state.toolNames.set(callID, normalizeAgentToolName(toolName))
      }

      return []
    }
    case "session.next.tool.input.ended": {
      const callID = getString(payload.callID)
      const input = getString(payload.text)

      if (callID && input) {
        state.toolInputs.set(callID, parseJsonObject(input))
      }

      return []
    }
    case "session.next.tool.called": {
      const callID = getString(payload.callID)
      const rawToolName = getString(payload.tool)

      if (!callID || !rawToolName) {
        return []
      }

      const toolName = normalizeAgentToolName(rawToolName)
      const input = normalizeOpenCodeToolInput(
        toolName,
        payload.input ?? {},
        options.workspace
      )

      return emitToolCall(state, callID, toolName, input, parentTaskId)
    }
    case "session.next.tool.success": {
      const callID = getString(payload.callID)
      const toolName = callID ? state.toolNames.get(callID) : null

      if (!callID || !toolName) {
        return []
      }

      const input = state.toolInputs.get(callID) ?? {}

      return [
        ...emitToolResult({
          callID,
          output: getToolResultOutput(payload),
          state,
          status: "complete",
          toolName,
          parentTaskId,
        }),
        ...getFileChangeFromTool(
          toolName,
          input,
          payload.outputPaths,
          payload.metadata,
          options.workspace
        ),
      ]
    }
    case "session.next.tool.failed": {
      const callID = getString(payload.callID)
      const toolName = callID ? state.toolNames.get(callID) : null

      if (!callID || !toolName) {
        return []
      }

      return emitToolResult({
        callID,
        output: extractErrorMessage(payload.error),
        state,
        status: "error",
        toolName,
        parentTaskId,
      })
    }
    case "session.next.shell.started": {
      const callID = getString(payload.callID)
      const command = getString(payload.command)

      if (!callID) {
        return []
      }

      return emitToolCall(
        state,
        callID,
        "shell",
        {
          command: command ?? "",
          ...(options.workspace ? { cwd: options.workspace } : {}),
        },
        parentTaskId
      )
    }
    case "session.next.shell.ended": {
      const callID = getString(payload.callID)

      if (!callID) {
        return []
      }

      return emitToolResult({
        callID,
        output: formatOpenCodeCommandResult(
          getString(payload.output) ?? "",
          payload
        ),
        state,
        status: "complete",
        toolName: state.toolNames.get(callID) ?? "shell",
        parentTaskId,
      })
    }
    case "todo.updated": {
      if (!Array.isArray(payload.todos)) {
        return []
      }

      const todos = payload.todos.map(normalizeTodo).filter(isAgentTodo)

      return parentTaskId
        ? [
            {
              type: "subagent_update",
              taskId: parentTaskId,
              todos,
            },
          ]
        : [
            {
              type: "plan_update",
              todos,
            },
          ]
    }
    case "permission.asked":
    case "permission.v2.asked": {
      const requestId = getString(payload.id)

      if (!requestId) {
        return []
      }

      return [
        createPermissionRequestEvent(
          requestId,
          getString(payload.action) ??
            getString(payload.permission) ??
            "permission",
          getPermissionInput(payload)
        ),
      ]
    }
    case "permission.replied":
    case "permission.v2.replied": {
      const requestId = getString(payload.requestID)
      const reply = getString(payload.reply)

      return requestId
        ? [
            {
              type: "permission_request",
              requestId,
              toolName: "",
              input: "",
              selectedOptionId: reply,
              status: "resolved",
            },
          ]
        : []
    }
    case "question.asked":
    case "question.v2.asked": {
      const event = mapQuestionAsked(payload)
      return event ? [event] : []
    }
    case "question.replied":
    case "question.v2.replied": {
      const requestId = getString(payload.requestID)
      const answers = Array.isArray(payload.answers) ? payload.answers : []
      const firstAnswer = Array.isArray(answers[0])
        ? getString(answers[0][0])
        : undefined

      return requestId
        ? [
            {
              type: "permission_request",
              requestId,
              toolName: "",
              input: "",
              selectedOptionId: firstAnswer ?? null,
              status: "resolved",
            },
          ]
        : []
    }
    case "session.diff": {
      const diff = Array.isArray(payload.diff) ? payload.diff : []

      return diff.flatMap((entry) => {
        const record = getRecord(entry)
        const path = getString(record?.file) ?? getString(record?.path)

        if (!path) {
          return []
        }

        return [
          {
            type: "file_change",
            path: getWorkspacePath(path, options.workspace),
            kind: mapDiffStatus(record?.status),
            status: "complete",
            ...(getString(record?.patch)?.trim()
              ? { diff: getString(record?.patch)?.trim() }
              : {}),
            ...(parentTaskId ? { parentTaskId } : {}),
          } satisfies Extract<AgentEvent, { type: "file_change" }>,
        ]
      })
    }
    case "file.edited": {
      const path = getString(payload.file)

      return path
        ? [
            {
              type: "file_change",
              path: getWorkspacePath(path, options.workspace),
              kind: "edit",
              status: "complete",
              ...(parentTaskId ? { parentTaskId } : {}),
            } satisfies Extract<AgentEvent, { type: "file_change" }>,
          ]
        : []
    }
    case "session.created":
    case "session.updated":
      return [
        ...mapSessionInfoEvent(payload, state, options),
        ...mapUsageEvent(payload),
      ]
    case "session.next.step.ended":
      return [
        ...mapUsageEvent(payload),
        ...(Array.isArray(payload.files)
          ? payload.files
              .filter((path): path is string => typeof path === "string")
              .map(
                (path) =>
                  ({
                    type: "file_change",
                    path: getWorkspacePath(path, options.workspace),
                    kind: "edit",
                    status: "complete",
                    ...(parentTaskId ? { parentTaskId } : {}),
                  }) satisfies Extract<AgentEvent, { type: "file_change" }>
              )
          : []),
      ]
    case "session.status": {
      const status = getRecord(payload.status)

      return parentTaskId && status?.type === "idle"
        ? emitSubagentEnd({ state, taskId: parentTaskId })
        : []
    }
    case "session.idle":
      return parentTaskId
        ? emitSubagentEnd({ state, taskId: parentTaskId })
        : []
    case "session.next.step.failed":
    case "session.error": {
      const message = extractErrorMessage(payload.error)

      return parentTaskId
        ? emitSubagentEnd({
            state,
            taskId: parentTaskId,
            error: message,
          })
        : [{ type: "error", message }]
    }
    default:
      return []
  }
}

export function createOpenCodeNativeEventMapper(
  options: OpenCodeNativeMapperOptions = {}
) {
  const state = createOpenCodeNativeMapperState()

  return (event: unknown) =>
    mapOpenCodeNativeEventToAgentEvents(event, state, options)
}

export function mapOpenCodeNativeEvents(
  events: unknown[],
  options: OpenCodeNativeMapperOptions = {}
) {
  const mapper = createOpenCodeNativeEventMapper(options)

  return events.flatMap((event) => mapper(event))
}

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function executableNames(name: string) {
  return process.platform === "win32"
    ? [`${name}.cmd`, `${name}.exe`, name]
    : [name]
}

function findExecutableOnPath(name: string) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue
    }

    for (const executableName of executableNames(name)) {
      const candidate = join(directory, executableName)

      if (isExecutable(candidate)) {
        return realpathSync(candidate)
      }
    }
  }

  return null
}

function resolveNodePackageExecutable(
  packageName: string,
  relativeExecutablePath: string
) {
  const executablePath = join(
    process.cwd(),
    "node_modules",
    ...packageName.split("/"),
    relativeExecutablePath
  )

  return isExecutable(executablePath) ? realpathSync(executablePath) : null
}

export function resolveOpenCodeNativeExecutable() {
  const homeOpenCode = `${process.env.HOME ?? ""}/.opencode/bin/opencode`

  return (
    (isExecutable(homeOpenCode) ? realpathSync(homeOpenCode) : null) ??
    findExecutableOnPath("opencode") ??
    resolveNodePackageExecutable("opencode-ai", "bin/opencode.exe")
  )
}

export function probeOpenCodeNativeRuntime() {
  const executablePath = resolveOpenCodeNativeExecutable()

  return executablePath
    ? {
        available: true as const,
        executablePath,
        detail: `using OpenCode executable at ${executablePath}`,
      }
    : {
        available: false as const,
        detail: "OpenCode executable was not found",
      }
}

function resolveOption<T>(
  option: T | ((input: AgentRunInput) => T | null | undefined) | undefined,
  input: AgentRunInput
) {
  return typeof option === "function"
    ? (option as (input: AgentRunInput) => T | null | undefined)(input)
    : option
}

function reserveOpenCodePort(hostname: string) {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()

    server.unref()
    server.once("error", reject)
    server.listen(0, hostname, () => {
      const address = server.address()

      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Unable to reserve an OpenCode server port."))
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve(address.port)
        }
      })
    })
  })
}

function openCodeConnectHostname(hostname: string) {
  if (hostname === "0.0.0.0") {
    return "127.0.0.1"
  }

  if (hostname === "::" || hostname === "[::]") {
    return "::1"
  }

  return hostname
}

function openCodeBaseUrl(hostname: string, port: number) {
  const connectHostname = openCodeConnectHostname(hostname)
  const formattedHostname = connectHostname.includes(":")
    ? `[${connectHostname}]`
    : connectHostname

  return `http://${formattedHostname}:${port}`
}

function waitForOpenCodeServer(
  child: ChildProcess,
  timeoutMs: number,
  hostname: string,
  port: number
) {
  return new Promise<void>((resolve, reject) => {
    const stdout = child.stdout
    const stderr = child.stderr

    if (!stdout || !stderr) {
      reject(new Error("OpenCode native server stdio was not captured."))
      return
    }

    const stdoutStream = stdout
    const stderrStream = stderr
    let output = ""
    let settled = false
    const timer = setTimeout(() => {
      finish(
        new Error(
          `Timed out waiting for OpenCode native server startup.${output.trim() ? `\n${output.trim()}` : ""}`
        )
      )
    }, timeoutMs)
    const poller = setInterval(probe, 50)

    function cleanup() {
      clearTimeout(timer)
      clearInterval(poller)
      stdoutStream.off("data", onData)
      stderrStream.off("data", onData)
      child.off("error", onError)
      child.off("exit", onExit)
    }

    function finish(error?: unknown) {
      if (settled) {
        return
      }

      settled = true
      cleanup()

      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }

    function onData(chunk: Buffer) {
      output += chunk.toString("utf8")
    }

    function probe() {
      const socket = createConnection({
        host: openCodeConnectHostname(hostname),
        port,
      })

      socket.unref()
      socket.once("connect", () => {
        socket.destroy()
        finish()
      })
      socket.once("error", () => socket.destroy())
    }

    function onError(error: Error) {
      finish(error)
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      finish(
        new Error(
          `OpenCode native server exited before startup: code=${code ?? "null"} signal=${signal ?? "null"}`
        )
      )
    }

    stdoutStream.on("data", onData)
    stderrStream.on("data", onData)
    child.once("error", onError)
    child.once("exit", onExit)
    probe()
  })
}

export async function startOpenCodeNativeServer(
  options: OpenCodeNativeRuntimeOptions
): Promise<OpenCodeNativeServerHandle> {
  if (options.baseUrl) {
    return {
      baseUrl: options.baseUrl,
      dispose: async () => {},
    }
  }

  const executablePath =
    options.executablePath ?? resolveOpenCodeNativeExecutable()

  if (!executablePath) {
    throw new Error("OpenCode executable was not found.")
  }

  const hostname = options.hostname ?? DEFAULT_HOSTNAME
  const port =
    options.port && options.port > 0
      ? options.port
      : await reserveOpenCodePort(hostname)

  const child = spawn(
    /* turbopackIgnore: true */ executablePath,
    [
      "serve",
      "--hostname",
      hostname,
      "--port",
      String(port),
      ...(options.pure ? ["--pure"] : []),
    ],
    {
      env: {
        ...process.env,
        ...(options.commandEnv ?? {}),
      },
      stdio: ["pipe", "pipe", "pipe"],
    }
  )
  await waitForOpenCodeServer(
    child,
    options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
    hostname,
    port
  )
  const baseUrl = openCodeBaseUrl(hostname, port)

  return {
    baseUrl,
    dispose: async () => {
      if (child.exitCode !== null || child.killed) {
        return
      }

      child.kill()
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            child.kill("SIGKILL")
          }

          resolve()
        }, 1_000)

        child.once("exit", () => {
          clearTimeout(timer)
          resolve()
        })
      })
    },
  }
}

function createOpenCodeUrl(
  baseUrl: string,
  path: string,
  directory?: string | null
) {
  const url = new URL(path, baseUrl)

  if (directory) {
    url.searchParams.set("directory", directory)
  }

  return url
}

async function requestOpenCode<T>({
  baseUrl,
  body,
  directory,
  method = "GET",
  path,
  signal,
}: {
  baseUrl: string
  body?: unknown
  directory?: string | null
  method?: string
  path: string
  signal: AbortSignal
}) {
  const response = await fetch(createOpenCodeUrl(baseUrl, path, directory), {
    method,
    signal,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(
      `OpenCode native request failed: ${method} ${path} ${response.status} ${text}`
    )
  }

  if (response.status === 204) {
    return null as T
  }

  return (await response.json()) as T
}

type SseFrame = {
  data: string
  event?: string
  id?: string
}

function parseSseFrame(block: string): SseFrame | null {
  const frame: SseFrame = { data: "" }

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue
    }

    const separatorIndex = line.indexOf(":")
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line
    const rawValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : ""
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue

    if (field === "data") {
      frame.data = frame.data ? `${frame.data}\n${value}` : value
    } else if (field === "event") {
      frame.event = value
    } else if (field === "id") {
      frame.id = value
    }
  }

  return frame.data ? frame : null
}

async function* readSseFrames(response: Response, signal: AbortSignal) {
  const reader = response.body?.getReader()

  if (!reader) {
    return
  }

  const decoder = new TextDecoder()
  let buffer = ""

  const abortReader = () => {
    void reader.cancel().catch(() => {})
  }

  signal.addEventListener("abort", abortReader, { once: true })

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })

      while (true) {
        const match = buffer.match(/\r?\n\r?\n/)

        if (!match?.index && match?.index !== 0) {
          break
        }

        const endIndex = match.index
        const separatorLength = match[0].length
        const block = buffer.slice(0, endIndex)

        buffer = buffer.slice(endIndex + separatorLength)

        const frame = parseSseFrame(block)

        if (frame) {
          yield frame
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", abortReader)
    reader.releaseLock()
  }
}

async function* subscribeOpenCodeEvents({
  baseUrl,
  directory,
  onReady,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  onReady?: () => void
  signal: AbortSignal
}) {
  const response = await fetch(
    createOpenCodeUrl(baseUrl, "/event", directory),
    {
      headers: { accept: "text/event-stream" },
      signal,
    }
  )

  if (!response.ok) {
    throw new Error(
      `OpenCode native event stream failed: ${response.status} ${await response
        .text()
        .catch(() => "")}`
    )
  }

  onReady?.()

  for await (const frame of readSseFrames(response, signal)) {
    try {
      yield JSON.parse(frame.data) as unknown
    } catch {
      yield {
        id: frame.id,
        type: frame.event ?? "unknown",
        properties: { data: frame.data },
      }
    }
  }
}

function isCompletionEvent(event: unknown, sessionId: string) {
  const normalized = normalizeOpenCodeEvent(event)

  if (!normalized) {
    return false
  }

  const payload = getOpenCodeEventPayload(normalized)
  const eventSessionId = getString(payload.sessionID)

  if (eventSessionId !== sessionId) {
    return false
  }

  if (
    normalized.type === "session.idle" ||
    normalized.type === "session.error" ||
    normalized.type === "session.next.step.ended" ||
    normalized.type === "session.next.step.failed"
  ) {
    return true
  }

  const status = getRecord(payload.status)

  return normalized.type === "session.status" && status?.type === "idle"
}

async function consumeOpenCodeRunEvents({
  baseUrl,
  directory,
  onReady,
  queue,
  sessionId,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  onReady?: () => void
  queue: AgentEventQueue
  sessionId: string
  signal: AbortSignal
}) {
  const mapper = createOpenCodeNativeEventMapper({
    sessionId,
    workspace: directory,
  })

  for await (const event of subscribeOpenCodeEvents({
    baseUrl,
    directory,
    onReady,
    signal,
  })) {
    for (const agentEvent of mapper(event)) {
      queue.push(agentEvent)
    }

    if (isCompletionEvent(event, sessionId)) {
      return
    }
  }
}

type OpenCodeSession = {
  id: string
}

async function createOpenCodeSession({
  baseUrl,
  directory,
  input,
  options,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  input: AgentRunInput
  options: OpenCodeNativeRuntimeOptions
  signal: AbortSignal
}) {
  const agent = resolveOption(options.agent, input)
  const model = resolveOption(options.model, input)

  return requestOpenCode<OpenCodeSession>({
    baseUrl,
    directory,
    method: "POST",
    path: "/session",
    signal,
    body: {
      title:
        getLatestPromptText(input.messages).slice(0, 80) || "AstraFlow run",
      ...(agent ? { agent } : {}),
      ...(model
        ? {
            model: {
              id: model.modelID,
              providerID: model.providerID,
              ...(model.variant ? { variant: model.variant } : {}),
            },
          }
        : {}),
    },
  })
}

async function sendOpenCodePrompt({
  baseUrl,
  directory,
  input,
  options,
  sessionId,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  input: AgentRunInput
  options: OpenCodeNativeRuntimeOptions
  sessionId: string
  signal: AbortSignal
}) {
  const prompt = getLatestPromptText(input.messages)
  const imageParts = getLatestImageParts(input.messages)
  const agent = resolveOption(options.agent, input)
  const model = resolveOption(options.model, input)

  if (!prompt) {
    throw new Error("OpenCode native runtime received an empty prompt.")
  }

  await requestOpenCode<null>({
    baseUrl,
    directory,
    method: "POST",
    path: `/session/${sessionId}/prompt_async`,
    signal,
    body: {
      messageID: `msg_${randomUUID().replace(/-/g, "")}`,
      parts: [{ type: "text", text: prompt }, ...imageParts],
      ...(agent ? { agent } : {}),
      ...(model
        ? {
            model: {
              providerID: model.providerID,
              modelID: model.modelID,
            },
            ...(model.variant ? { variant: model.variant } : {}),
          }
        : {}),
    },
  })
}

async function abortOpenCodeSession({
  baseUrl,
  directory,
  sessionId,
  signal,
}: {
  baseUrl: string
  directory?: string | null
  sessionId: string
  signal: AbortSignal
}) {
  await requestOpenCode<null>({
    baseUrl,
    directory,
    method: "POST",
    path: `/session/${sessionId}/abort`,
    signal,
  }).catch(() => null)
}

async function* streamOpenCodeNativeRun(
  input: AgentRunInput,
  options: OpenCodeNativeRuntimeOptions
): AsyncGenerator<AgentEvent> {
  const queue = new AgentEventQueue()
  const runAbort = new AbortController()
  let server: OpenCodeNativeServerHandle | null = null
  let sessionId: string | null = null

  const abortRun = () => runAbort.abort(input.signal.reason)
  input.signal.addEventListener("abort", abortRun, { once: true })

  void (async () => {
    try {
      const directory = input.projectPath?.trim() || null

      server = await startOpenCodeNativeServer(options)

      sessionId = input.runtimeSessionRef?.trim() || null

      if (!sessionId) {
        const session = await createOpenCodeSession({
          baseUrl: server.baseUrl,
          directory,
          input,
          options,
          signal: runAbort.signal,
        })

        sessionId = session.id
      }

      queue.push({ type: "run_meta", sessionRef: sessionId })

      let markEventsReady = () => {}
      const eventsReady = new Promise<void>((resolve) => {
        markEventsReady = resolve
      })
      const events = consumeOpenCodeRunEvents({
        baseUrl: server.baseUrl,
        directory,
        onReady: markEventsReady,
        queue,
        sessionId,
        signal: runAbort.signal,
      })

      await Promise.race([eventsReady, events])

      await sendOpenCodePrompt({
        baseUrl: server.baseUrl,
        directory,
        input,
        options,
        sessionId,
        signal: runAbort.signal,
      })

      await events
      queue.close()
    } catch (error) {
      if (runAbort.signal.aborted || input.signal.aborted) {
        queue.close()
      } else {
        queue.fail(error)
      }
    } finally {
      if (sessionId && server && runAbort.signal.aborted) {
        await abortOpenCodeSession({
          baseUrl: server.baseUrl,
          directory: input.projectPath?.trim() || null,
          sessionId,
          signal: new AbortController().signal,
        })
      }

      await server?.dispose()
    }
  })()

  try {
    for await (const event of queue) {
      yield event
    }
  } finally {
    runAbort.abort()
    input.signal.removeEventListener("abort", abortRun)
  }
}

export class OpenCodeNativeRuntime implements AgentRuntime {
  readonly info = OPENCODE_NATIVE_RUNTIME_INFO

  constructor(private readonly options: OpenCodeNativeRuntimeOptions = {}) {}

  getInfo() {
    return this.info
  }

  startRun(input: AgentRunInput): AsyncIterable<AgentEvent> {
    return streamOpenCodeNativeRun(input, this.options)
  }
}

export function createOpenCodeNativeRuntime(
  options: OpenCodeNativeRuntimeOptions = {}
) {
  return new OpenCodeNativeRuntime(options)
}

export function registerOpenCodeNativeRuntime() {
  registerAgentRuntime(createOpenCodeNativeRuntime())
}

registerOpenCodeNativeRuntime()
