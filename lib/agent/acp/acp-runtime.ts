import {
  client as createAcpClient,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type ActiveSession,
  type AuthMethod,
  type ClientConnection,
  type ContentBlock,
  type CreateElicitationRequest,
  type InitializeResponse,
  type NewSessionResponse,
  type PromptCapabilities,
  type ProviderInfo,
  type SessionConfigOption,
  type SessionConfigSelectGroup,
  type SessionConfigSelectOption,
  type SessionConfigSelectOptions,
  type SessionNotification,
  type SessionMode,
  type SessionModeState,
  type SessionUpdate,
  type TerminalExitStatus,
} from "@agentclientprotocol/sdk"
import {
  MemoryAcpCookieStore,
  createHttpStream,
} from "@agentclientprotocol/sdk/experimental/http-client"
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { StringDecoder } from "node:string_decoder"
import { pathToFileURL } from "node:url"
import { WebSocket as NodeWebSocket } from "ws"

import type {
  PromptMention,
  SlashCommandDescriptor,
} from "@/lib/agent/composer-types"
import type { AgentEvent, AgentFileChangeEvent } from "@/lib/agent/events"
import type { AgentMessage, AgentMessageContent } from "@/lib/agent/messages"
import {
  isAgentToolKind,
  isAgentMessagePhase,
  isAgentToolCallContent,
  isAgentToolCallLocation,
  sanitizeAgentContentBlock,
  sanitizeAgentStructuredValue,
  sanitizeAgentText,
  sanitizeAgentToolCallContent,
  sanitizeAgentToolCallLocation,
  AGENT_STRUCTURED_RAW_LIMIT,
  AGENT_STRUCTURED_TEXT_LIMIT,
  type AgentContentBlock,
  type AgentPlanPriority,
  type AgentToolCallContent,
  type AgentToolKind,
  type AgentToolCallLocation,
  type AgentToolCallStatus,
} from "@/lib/agent/structured-content"
import { normalizeAgentToolName } from "@/lib/agent/tool-names"
import { getConfiguredPythonProcessEnvironment } from "@/lib/agent/python-process-environment"
import { createUnifiedFileDiff } from "@/lib/agent/unified-diff"
import {
  cancelSessionPermissions,
  requestPermission,
  type PermissionOption,
} from "@/lib/agent/permission-broker"
import { getPreferredAcpSessionModes } from "@/lib/agent/permission-policy"
import {
  cancelSessionUserInputs,
  requestUserInput,
} from "@/lib/agent/user-input-broker"
import type {
  AgentRunInput,
  AgentRuntime,
  AgentRuntimeInfo,
} from "@/lib/agent/runtime"
import {
  ACP_MCP_METHODS,
  AcpMcpBridge,
  connectMcpRequestParser,
  disconnectMcpRequestParser,
  messageMcpRequestParser,
  type AcpMcpBridgeServer,
} from "@/lib/agent/acp/mcp-bridge"
import {
  mapAcpSubagentToolUpdate,
  type AcpMappedSubagent,
} from "@/lib/agent/acp/subagent-mapper"
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"
import { getAcpStopReasonErrorMessage } from "@/lib/agent/acp/stop-reason"
import { getMcpToolServerName } from "@/lib/mcp"
import { setStudioSessionAvailableCommands } from "@/lib/studio-db/sessions"

export type AcpStdioCommandSpec = {
  transport?: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string | undefined>
}

export type AcpHttpCommandSpec = {
  transport: "http"
  url: string
  headers?: Record<string, string>
}

export type AcpWebSocketCommandSpec = {
  transport: "websocket"
  url: string
  headers?: Record<string, string>
}

export type AcpCommandSpec =
  AcpStdioCommandSpec | AcpHttpCommandSpec | AcpWebSocketCommandSpec

export type AcpAuthenticationSpec = {
  methodId: string
  _meta?: Record<string, unknown>
}

export type AcpMcpKeyValue = {
  name: string
  value: string
  _meta?: Record<string, unknown> | null
}

export type AcpMcpServer =
  | {
      name: string
      command: string
      args: string[]
      env: AcpMcpKeyValue[]
      _meta?: Record<string, unknown> | null
    }
  | {
      name: string
      type: "http" | "sse"
      url: string
      headers: AcpMcpKeyValue[]
      _meta?: Record<string, unknown> | null
    }
  | {
      name: string
      type: "acp"
      serverId: string
      _meta?: Record<string, unknown> | null
    }

export type AcpSessionPlugins = {
  additionalDirectories?: string[]
  fallbackMcpServers?: AcpMcpServer[]
  mcpBridgeServers?: AcpMcpBridgeServer[]
  mcpServers: AcpMcpServer[]
  promptPreamble: string | null
}

export type AcpRuntimeOptions = {
  info: AgentRuntimeInfo
  onInitializeResponse?: (response: InitializeResponse) => void
  resolveAuthentication?: (input: AgentRunInput) => AcpAuthenticationSpec | null
  resolveCommand: (
    input: AgentRunInput
  ) => AcpCommandSpec | null | Promise<AcpCommandSpec | null>
  resolveSessionPlugins?: (input: AgentRunInput) => AcpSessionPlugins | null
  resolveSessionMeta?: (input: AgentRunInput) => Record<string, unknown> | null
  resolveSessionKey?: (input: AgentRunInput) => string | null
}

type AcpSessionState = {
  acpSessionId: string
  activeSession: ActiveSession
  additionalDirectories: string[]
  availableCommands: SlashCommandDescriptor[]
  child: ChildProcessWithoutNullStreams | null
  command: AcpCommandSpec
  configOptions: SessionConfigOption[]
  connection: ClientConnection
  controlCancelTimer: NodeJS.Timeout | null
  cookieStoreKey: string | null
  currentModeId: string | null
  disposed: boolean
  idleTimer: NodeJS.Timeout | null
  initializeResponse: InitializeResponse
  key: string
  loadReplayUpdateCount: number
  loadReplayUpdates: SessionUpdate[]
  mcpServers: AcpMcpServer[]
  mcpBridge: AcpMcpBridge | null
  pendingStartupEvents: AgentEvent[]
  queue: AgentEventQueue | null
  rateLimitInfo: Record<string, unknown> | null
  replacementNotifications: SessionNotification[] | null
  restoredFromProvider: boolean
  runtimeId: string
  runTail: Promise<void>
  runSignal: AbortSignal | null
  stderr: string
  sessionKey: string
  sessionMeta: Record<string, unknown> | null
  shouldIncludeRecapOnNextRun: boolean
  sessionInfo: Extract<
    SessionUpdate,
    { sessionUpdate: "session_info_update" }
  > | null
  studioSessionId: string
  subagentTasksByAgentId: Map<string, AcpMappedSubagent>
  subagentTasksByProviderThreadId: Map<string, AcpMappedSubagent>
  subagentTasksByToolCall: Map<string, AcpMappedSubagent[]>
  toolCallIds: Set<string>
  toolFileChangeSignatures: Map<string, Set<string>>
  toolNames: Map<string, string>
  toolOutputs: Map<string, string>
  workspace: string
}

type AcpPreparedState = {
  child: ChildProcessWithoutNullStreams | null
  command: AcpCommandSpec
  connection: ClientConnection
  cookieStoreKey: string | null
  disposed: boolean
  failSessionStart: (error: Error) => void
  idleTimer: NodeJS.Timeout | null
  initializeResponse: InitializeResponse
  key: string
  mcpBridge: AcpMcpBridge | null
  operationTail: Promise<void>
  requestSessionStart: () => Promise<void>
  runtimeId: string
  sessionKey: string
  sessionStartRequested: boolean
  studioSessionId: string
  workspace: string
}

export type AcpPreparedStartHandle = {
  requestSessionStart: () => Promise<void>
}

export function createAcpPreparationBarrier<T extends AcpPreparedStartHandle>({
  onStale,
}: { onStale?: (state: T) => void } = {}) {
  let resolvePrepared!: (state: T) => void
  let rejectPrepared!: (error: unknown) => void
  let stale = false
  const ready = new Promise<T>((resolve, reject) => {
    resolvePrepared = resolve
    rejectPrepared = reject
  })
  // A superseded preparation may have no remaining caller by the time its
  // slow initialize settles. Keep its rejection observed while preserving the
  // original rejecting promise for callers that are still awaiting it.
  void ready.catch(() => undefined)

  return {
    ready,
    get stale() {
      return stale
    },
    resolvePrepared: (state: T) => {
      if (stale) {
        onStale?.(state)
        return
      }
      resolvePrepared(state)
    },
    rejectPrepared,
    markStale: (error: Error) => {
      if (stale) {
        return
      }
      stale = true
      rejectPrepared(error)
    },
    requestSessionStart: async () => {
      const prepared = await ready

      await prepared.requestSessionStart()
    },
  }
}

export function invalidateAcpPreparationRegistryEntries<T>({
  coordinators,
  disposeStartup,
  isStale,
  reason,
  startups,
}: {
  coordinators: Map<string, { markStale: (error: Error) => void }>
  disposeStartup: (key: string, state: T, reason: string) => void
  isStale: (key: string) => boolean
  reason: string
  startups: Map<string, Promise<T>>
}) {
  for (const [key, coordinator] of coordinators) {
    if (!isStale(key)) {
      continue
    }

    coordinators.delete(key)
    coordinator.markStale(new Error(reason))
  }

  for (const [key, startup] of startups) {
    if (!isStale(key)) {
      continue
    }

    startups.delete(key)
    void startup.then(
      (state: T) => disposeStartup(key, state, reason),
      () => undefined
    )
  }
}

type AcpPreparationCoordinator = ReturnType<
  typeof createAcpPreparationBarrier<AcpPreparedState>
>

export type AcpMapperReplayState = {
  configOptions?: SessionConfigOption[]
  currentModeId?: string | null
  rateLimitInfo?: Record<string, unknown> | null
  runtimeId?: string
  sessionInfo?: Extract<
    SessionUpdate,
    { sessionUpdate: "session_info_update" }
  > | null
  subagentTasksByAgentId: Map<string, AcpMappedSubagent>
  subagentTasksByProviderThreadId: Map<string, AcpMappedSubagent>
  subagentTasksByToolCall: Map<string, AcpMappedSubagent[]>
  toolCallIds: Set<string>
  toolFileChangeSignatures: Map<string, Set<string>>
  toolNames: Map<string, string>
  toolOutputs: Map<string, string>
  workspace?: string
}

class AcpStartupError extends Error {
  readonly stderr: string

  constructor(error: unknown, stderr: string) {
    super(errorMessage(error))
    this.name = "AcpStartupError"
    this.cause = error
    this.stderr = stderr
  }
}

const ACP_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const ACP_STARTUP_TIMEOUT_MS = 20 * 1000
const ACP_ABORT_KILL_TIMEOUT_MS = 5 * 1000
const ACP_TERMINATE_KILL_TIMEOUT_MS = 2 * 1000
const ACP_TERMINAL_DEFAULT_OUTPUT_BYTE_LIMIT = 256 * 1024
const ACP_EMBEDDED_RESOURCE_MAX_BYTES = 64 * 1024
const ACP_TOOL_OUTPUT_CHARACTER_LIMIT = 20_000
const ACP_TOOL_OUTPUT_TRUNCATED_MARKER = "[output truncated]\n"
const ACP_STRUCTURED_COLLECTION_LIMIT = 100
const MAX_CAPTURED_STDERR_LENGTH = 4000
const ASTRAFLOW_ACP_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
const ASTRAFLOW_DESKTOP_VERSION =
  process.env.ASTRAFLOW_APP_VERSION?.trim() ||
  process.env.npm_package_version?.trim() ||
  "1.1.4"
const ACP_SESSION_KEY_SEPARATOR = "\u0000"
const ACP_SAFE_WRITE_FLAGS =
  fsConstants.O_WRONLY |
  fsConstants.O_CREAT |
  fsConstants.O_TRUNC |
  (fsConstants.O_NOFOLLOW ?? 0)

type AcpRuntimeGlobalState = {
  children: Set<ChildProcessWithoutNullStreams>
  cleanupHooksInstalled: boolean
  cookieStores: Map<string, MemoryAcpCookieStore>
  preparationCoordinators: Map<string, AcpPreparationCoordinator>
  preparations: Map<string, AcpPreparedState>
  sessions: Map<string, AcpSessionState>
  startups: Map<string, Promise<AcpSessionState>>
  terminals: Map<string, AcpTerminalState>
}

type AcpTerminalState = {
  child: ChildProcessWithoutNullStreams
  // Set when a tool_call/tool_call_update references this terminal; lets
  // stdout/stderr chunks stream to the UI as tool_output events while the
  // command is still running.
  emitEvent: ((event: AgentEvent) => void) | null
  exitStatus: TerminalExitStatus | null
  output: string
  outputByteLimit: number
  released: boolean
  streamTimer: NodeJS.Timeout | null
  studioSessionId: string
  terminalId: string
  toolCallId: string | null
  toolName: string
  truncated: boolean
  waiters: Array<(status: TerminalExitStatus) => void>
}

const ACP_GLOBAL_STATE_KEY = Symbol.for("astraflow.acp.runtimeState")
const acpRuntimeGlobal = globalThis as typeof globalThis &
  Record<symbol, AcpRuntimeGlobalState | undefined>
const acpGlobalState =
  acpRuntimeGlobal[ACP_GLOBAL_STATE_KEY] ??
  (acpRuntimeGlobal[ACP_GLOBAL_STATE_KEY] = {
    children: new Set(),
    cleanupHooksInstalled: false,
    cookieStores: new Map(),
    preparationCoordinators: new Map(),
    preparations: new Map(),
    sessions: new Map(),
    startups: new Map(),
    terminals: new Map(),
  })

const acpChildren = acpGlobalState.children
const acpTransportCookieStores =
  acpGlobalState.cookieStores ?? (acpGlobalState.cookieStores = new Map())
const acpSessions = acpGlobalState.sessions
const acpPreparedSessions =
  acpGlobalState.preparations ?? (acpGlobalState.preparations = new Map())
const acpPreparationCoordinators =
  acpGlobalState.preparationCoordinators ??
  (acpGlobalState.preparationCoordinators = new Map())
const acpSessionStartups = acpGlobalState.startups
const acpTerminalSessions = acpGlobalState.terminals

class AgentEventQueue implements AsyncIterable<AgentEvent> {
  private events: AgentEvent[] = []
  private closed = false
  private waiters: Array<() => void> = []

  push(event: AgentEvent) {
    if (this.closed) {
      return
    }

    this.events.push(event)
    this.notify()
  }

  close() {
    if (this.closed) {
      return
    }

    this.closed = true
    this.notify()
  }

  private notify() {
    const waiters = this.waiters
    this.waiters = []

    for (const waiter of waiters) {
      waiter()
    }
  }

  private wait() {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const event = this.events.shift()

      if (event) {
        yield event
        continue
      }

      if (this.closed) {
        return
      }

      await this.wait()
    }
  }
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function stringifyPayload(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function truncateForPrompt(text: string, maxLength = 500) {
  const cleaned = text.replace(/\s+/g, " ").trim()

  return cleaned.length > maxLength
    ? `${cleaned.slice(0, maxLength)}...`
    : cleaned
}

export function trimUtf8BytesFromStart(text: string, maxBytes: number) {
  const encoded = Buffer.from(text, "utf8")

  if (encoded.byteLength <= maxBytes) {
    return { text, truncated: false }
  }

  if (maxBytes <= 0) {
    return { text: "", truncated: encoded.byteLength > 0 }
  }

  // Starting in the middle of a UTF-8 sequence decodes to U+FFFD. Remove only
  // those leading replacement characters so the returned snapshot always
  // contains complete Unicode code points and never exceeds the byte limit.
  const result = encoded
    .subarray(encoded.byteLength - maxBytes)
    .toString("utf8")
    .replace(/^\uFFFD+/, "")

  return { text: result, truncated: true }
}

export function createAcpUtf8ChunkDecoder() {
  const decoder = new StringDecoder("utf8")

  return {
    write: (chunk: Buffer) => decoder.write(chunk),
    end: () => decoder.end(),
  }
}

function appendTerminalOutput(state: AcpTerminalState, chunk: string) {
  if (!chunk) {
    return
  }

  const next = sanitizeAgentText(
    `${state.output}${chunk}`,
    state.outputByteLimit
  )
  const trimmed = trimUtf8BytesFromStart(next, state.outputByteLimit)

  state.output = trimmed.text
  state.truncated = state.truncated || trimmed.truncated
  scheduleTerminalOutputStream(state)
}

const ACP_TERMINAL_STREAM_INTERVAL_MS = 150

// Trailing-edge throttle: at most one tool_output event per interval, always
// flushing the latest accumulated buffer.
function scheduleTerminalOutputStream(state: AcpTerminalState) {
  if (!state.toolCallId || !state.emitEvent || state.streamTimer) {
    return
  }

  state.streamTimer = setTimeout(() => {
    state.streamTimer = null
    flushTerminalOutputStream(state)
  }, ACP_TERMINAL_STREAM_INTERVAL_MS)
  state.streamTimer.unref?.()
}

function flushTerminalOutputStream(state: AcpTerminalState) {
  if (!state.toolCallId || !state.emitEvent || state.released) {
    return
  }

  state.emitEvent({
    type: "tool_output",
    id: state.toolCallId,
    name: state.toolName || undefined,
    output: state.output,
  })
}

function clearTerminalOutputStream(state: AcpTerminalState) {
  if (state.streamTimer) {
    clearTimeout(state.streamTimer)
    state.streamTimer = null
  }

  state.toolCallId = null
}

function getUpdateTerminalIds(content: unknown) {
  if (!Array.isArray(content)) {
    return []
  }

  return content.flatMap((item) => {
    const record = getRecord(item)

    return record?.type === "terminal" && typeof record.terminalId === "string"
      ? [record.terminalId]
      : []
  })
}

function linkAcpTerminalsToToolCall(
  update: { content?: unknown; toolCallId: string },
  name: string
) {
  for (const terminalId of getUpdateTerminalIds(update.content)) {
    const terminal = acpTerminalSessions.get(terminalId)

    if (!terminal || terminal.released) {
      continue
    }

    terminal.toolCallId = update.toolCallId
    terminal.toolName = name

    if (terminal.output) {
      scheduleTerminalOutputStream(terminal)
    }
  }
}

function unlinkAcpToolCallTerminals(toolCallId: string) {
  for (const terminal of acpTerminalSessions.values()) {
    if (terminal.toolCallId === toolCallId) {
      clearTerminalOutputStream(terminal)
    }
  }
}

function terminalExitStatus(
  code: number | null,
  signal: NodeJS.Signals | null
): TerminalExitStatus {
  return {
    exitCode: code,
    signal: signal ?? null,
  }
}

function resolveTerminalWaiters(state: AcpTerminalState) {
  if (!state.exitStatus) {
    return
  }

  const waiters = state.waiters
  state.waiters = []

  for (const waiter of waiters) {
    waiter(state.exitStatus)
  }
}

function getAcpTerminalSnapshot(terminalId: string) {
  const terminal = acpTerminalSessions.get(terminalId)

  if (!terminal) {
    return null
  }

  return {
    output: terminal.output,
    truncated: terminal.truncated,
    exitStatus: terminal.exitStatus,
  }
}

function debugAcp(label: string, payload: Record<string, unknown>) {
  if (!ASTRAFLOW_ACP_DEBUG) {
    return
  }

  console.debug(`[studio-chat:acp] ${label}`, payload)
}

export function deriveAcpRuntimeInfoFromInitialize(
  info: AgentRuntimeInfo,
  response: InitializeResponse
): AgentRuntimeInfo {
  const capabilities = response.agentCapabilities

  if (!capabilities) {
    return info
  }

  const meta = getRecord(capabilities._meta)
  const subagents = meta?.subagents ?? meta?.subAgents ?? meta?.tasks
  const skills = meta?.skills
  const mcp =
    capabilities.mcpCapabilities === undefined
      ? info.capabilities.mcp
      : Boolean(
          capabilities.mcpCapabilities?.http ||
          capabilities.mcpCapabilities?.sse ||
          capabilities.mcpCapabilities?.acp
        )
  const resume =
    capabilities.sessionCapabilities?.resume !== undefined
      ? Boolean(capabilities.sessionCapabilities.resume)
      : typeof capabilities.loadSession === "boolean"
        ? capabilities.loadSession
        : info.capabilities.resume

  return {
    ...info,
    capabilities: {
      ...info.capabilities,
      resume,
      mcp,
      subagents:
        typeof subagents === "boolean"
          ? subagents
          : info.capabilities.subagents,
      skills: typeof skills === "boolean" ? skills : info.capabilities.skills,
    },
  }
}

function fingerprintSessionPlugins(plugins: AcpSessionPlugins) {
  if (
    !plugins.additionalDirectories?.length &&
    !plugins.fallbackMcpServers?.length &&
    !plugins.mcpBridgeServers?.length &&
    !plugins.mcpServers.length &&
    !plugins.promptPreamble
  ) {
    return null
  }

  return createHash("sha256")
    .update(JSON.stringify(plugins))
    .digest("hex")
    .slice(0, 16)
}

function getSessionKey(
  runtimeId: string,
  sessionId: string,
  workspace: string,
  modelKey: string | null,
  pluginKey: string | null
) {
  return [
    runtimeId,
    sessionId,
    workspace,
    modelKey ?? "",
    pluginKey ?? "",
  ].join(ACP_SESSION_KEY_SEPARATOR)
}

export function isAcpRuntimeSessionKey(
  key: string,
  runtimeId: string,
  sessionId: string
) {
  return key.startsWith(
    [runtimeId, sessionId, ""].join(ACP_SESSION_KEY_SEPARATOR)
  )
}

function getAcpWorkspace(input: AgentRunInput) {
  const projectPath =
    input.environment === "remote"
      ? input.workspaceRoot?.trim()
      : input.agentWorkspaceRoot?.trim() || input.projectPath?.trim()

  return projectPath
    ? resolve(projectPath)
    : ensureAcpWorkspace(input.sessionId)
}

function commandToString(command: AcpCommandSpec) {
  if (command.transport === "http" || command.transport === "websocket") {
    return command.url
  }

  return [command.command, ...(command.args ?? [])].join(" ")
}

function isAbortLikeError(error: unknown, signal?: AbortSignal) {
  const record = getRecord(error)
  const name = typeof record?.name === "string" ? record.name : ""
  const message = error instanceof Error ? error.message : String(error)

  return (
    Boolean(signal?.aborted) ||
    name === "AbortError" ||
    message.includes("aborted") ||
    message.includes("cancelled") ||
    message.includes("Active session disposed") ||
    message.includes("ACP connection closed")
  )
}

function acpErrorDetailToText(value: unknown) {
  if (typeof value === "string") {
    return sanitizeAgentText(value.trim(), 8192)
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(sanitizeAgentStructuredValue(value, 8192))
  } catch {
    return ""
  }
}

function codexErrorInfoToText(value: unknown) {
  if (typeof value === "string") {
    return sanitizeAgentText(value.trim(), 512)
  }

  const info = getRecord(value)
  const variant = info ? Object.entries(info)[0] : null

  if (!variant) {
    return acpErrorDetailToText(value)
  }

  const [name, payload] = variant
  const details = getRecord(payload)
  const httpStatusCode = details?.httpStatusCode
  const turnKind = details?.turnKind

  return `${sanitizeAgentText(name, 512)}${
    typeof httpStatusCode === "number" ? ` (HTTP ${httpStatusCode})` : ""
  }${typeof turnKind === "string" ? ` (${sanitizeAgentText(turnKind, 512)})` : ""}`
}

export function formatAcpErrorMessage(error: unknown) {
  const record = getRecord(error)
  const nestedError = record?.error
  const directMessage =
    typeof record?.message === "string" ? record.message.trim() : ""
  const nestedMessage =
    nestedError instanceof Error
      ? nestedError.message.trim()
      : typeof nestedError === "string"
        ? nestedError.trim()
        : ""
  const fallbackMessage = String(error)
  const message =
    (error instanceof Error ? error.message.trim() : "") ||
    directMessage ||
    nestedMessage ||
    (record?.type === "error" && fallbackMessage === "[object ErrorEvent]"
      ? "ACP WebSocket connection failed."
      : fallbackMessage)
  const sanitizedMessage =
    sanitizeAgentText(message, 8192).trim() || "ACP request failed."
  const data = getRecord(record?.data)
  const detailCandidates = [
    data?.message,
    data?.details,
    data?.additionalDetails,
    record?.details,
  ]
    .map(acpErrorDetailToText)
    .filter(
      (detail, index, details) =>
        Boolean(detail) &&
        detail !== sanitizedMessage &&
        details.indexOf(detail) === index
    )
  const codexErrorInfo = codexErrorInfoToText(data?.codexErrorInfo)

  if (codexErrorInfo) {
    detailCandidates.push(`Codex error: ${codexErrorInfo}`)
  }

  return detailCandidates.length
    ? `${sanitizedMessage}: ${detailCandidates.join("; ")}`
    : sanitizedMessage
}

function errorMessage(error: unknown) {
  return formatAcpErrorMessage(error)
}

function createAbortError(message: string) {
  const error = new Error(message)
  error.name = "AbortError"

  return error
}

function createStartupErrorMessage({
  command,
  error,
  info,
  stderr,
}: {
  command: AcpCommandSpec
  error: unknown
  info: AgentRuntimeInfo
  stderr?: string
}) {
  const capturedStderr =
    stderr ??
    (error instanceof AcpStartupError && error.stderr
      ? error.stderr
      : undefined)
  const stderrText = capturedStderr?.trim()

  return [
    `${info.label} ACP failed to start (${commandToString(command)}): ${errorMessage(error)}`,
    stderrText ? `stderr: ${stderrText}` : null,
    "Check that the ACP binary exists, is executable, and its package or local CLI installation is intact.",
  ]
    .filter(Boolean)
    .join("\n")
}

async function syncAcpPermissionMode({
  input,
  info,
  state,
}: {
  input: AgentRunInput
  info: AgentRuntimeInfo
  state: AcpSessionState
}) {
  const preferredModeIds = getPreferredAcpSessionModes({
    mode: input.permissionMode,
    runtimeId: info.id,
  })
  const modeConfig = state.configOptions.find(
    (option) =>
      option.type === "select" &&
      (option.category === "mode" || option.id === "mode")
  )

  if (modeConfig?.type === "select") {
    const configValues = modeConfig.options.flatMap((option) =>
      "group" in option
        ? option.options.map((entry) => entry.value)
        : [option.value]
    )
    const preferredValue = preferredModeIds.find((modeId) =>
      configValues.includes(modeId)
    )

    if (!preferredValue || modeConfig.currentValue === preferredValue) {
      return
    }

    try {
      const response = await state.connection.agent.request(
        methods.agent.session.setConfigOption,
        {
          configId: modeConfig.id,
          sessionId: state.acpSessionId,
          value: preferredValue,
        }
      )

      state.configOptions = sanitizeAcpConfigOptions(response.configOptions)
    } catch (error) {
      debugAcp("permission_config_sync_failed", {
        configId: modeConfig.id,
        error: errorMessage(error),
        requestedMode: input.permissionMode,
        runtimeId: info.id,
        selectedValue: preferredValue,
        sessionId: state.acpSessionId,
      })
    }

    return
  }

  const modes = state.activeSession.modes

  if (!modes?.availableModes?.length) {
    return
  }

  const preferredModeId = preferredModeIds.find((modeId) =>
    modes.availableModes.some((availableMode) => availableMode.id === modeId)
  )

  if (
    !preferredModeId ||
    (state.currentModeId ?? modes.currentModeId) === preferredModeId
  ) {
    return
  }

  try {
    await state.connection.agent.request(methods.agent.session.setMode, {
      modeId: preferredModeId,
      sessionId: state.acpSessionId,
    })
    state.currentModeId = preferredModeId
  } catch (error) {
    debugAcp("permission_mode_sync_failed", {
      error: errorMessage(error),
      requestedMode: input.permissionMode,
      runtimeId: info.id,
      selectedModeId: preferredModeId,
      sessionId: state.acpSessionId,
    })
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: NodeJS.Timeout | null = null

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref()
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

function isNotFoundError(error: unknown) {
  return getRecord(error)?.code === "ENOENT"
}

function requireAbsoluteAcpPath(path: string, field: string) {
  if (!isAbsolute(path)) {
    throw new Error(`ACP ${field} must be an absolute path.`)
  }
}

function combineAcpRequestSignals(
  requestSignal: AbortSignal,
  runSignal: AbortSignal
) {
  if (requestSignal === runSignal) {
    return requestSignal
  }

  return AbortSignal.any([requestSignal, runSignal])
}

function assertAcpSessionScope(
  requestSessionId: string | null | undefined,
  activeSessionId: string | null
) {
  if (
    activeSessionId &&
    requestSessionId &&
    requestSessionId !== activeSessionId
  ) {
    throw new Error("ACP request belongs to a different session.")
  }
}

async function findExistingAncestor(path: string) {
  let candidate = path
  let lastError: unknown = null

  for (;;) {
    try {
      await lstat(candidate)

      return candidate
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error
      }

      lastError = error
    }

    const parent = dirname(candidate)

    if (parent === candidate) {
      throw lastError ?? new Error("No existing path ancestor found.")
    }

    candidate = parent
  }
}

async function resolveSafeWriteParent(
  workspaceRealPath: string,
  parentPath: string
) {
  assertPathInsideWorkspace(workspaceRealPath, parentPath)

  const existingAncestor = await findExistingAncestor(parentPath)
  const existingAncestorRealPath = await realpath(
    /* turbopackIgnore: true */ existingAncestor
  )

  assertPathInsideWorkspace(workspaceRealPath, existingAncestorRealPath)

  await mkdir(parentPath, { recursive: true })

  const parentRealPath = await realpath(parentPath)

  assertPathInsideWorkspace(workspaceRealPath, parentRealPath)

  return parentRealPath
}

async function assertSafeExistingWriteTarget(
  workspaceRealPath: string,
  targetPath: string
) {
  try {
    await lstat(targetPath)
  } catch (error) {
    if (isNotFoundError(error)) {
      return
    }

    throw error
  }

  const targetRealPath = await realpath(targetPath)

  assertPathInsideWorkspace(workspaceRealPath, targetRealPath)
}

function asAcpFileSystemRoots(roots: string | readonly string[]) {
  return typeof roots === "string" ? [roots] : [...roots]
}

function isPathInsideRoot(root: string, target: string) {
  const pathFromRoot = relative(root, target)

  return (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))
  )
}

async function resolveSafeReadPath(
  roots: string | readonly string[],
  rawPath: string
) {
  const configuredRoots = asAcpFileSystemRoots(roots)
  const targetPath = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(await realpath(configuredRoots[0]), rawPath)
  const targetRealPath = await realpath(targetPath)

  for (const root of configuredRoots) {
    const rootRealPath = await realpath(root)

    if (isPathInsideRoot(rootRealPath, targetRealPath)) {
      return targetRealPath
    }
  }

  throw new Error(
    "ACP file access is limited to this session's cwd and additionalDirectories."
  )
}

async function resolveSafeWritePath(
  roots: string | readonly string[],
  rawPath: string
) {
  const configuredRoots = asAcpFileSystemRoots(roots)
  const rawTargetPath = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(await realpath(configuredRoots[0]), rawPath)

  for (const root of configuredRoots) {
    const configuredRootPath = resolve(root)
    const rootRealPath = await realpath(root)
    const targetPath = isPathInsideRoot(configuredRootPath, rawTargetPath)
      ? resolve(rootRealPath, relative(configuredRootPath, rawTargetPath))
      : rawTargetPath

    if (!isPathInsideRoot(rootRealPath, targetPath)) {
      continue
    }

    const parentRealPath = await resolveSafeWriteParent(
      rootRealPath,
      dirname(targetPath)
    )
    const safePath = resolve(parentRealPath, basename(targetPath))

    await assertSafeExistingWriteTarget(rootRealPath, safePath)

    return safePath
  }

  throw new Error(
    "ACP file access is limited to this session's cwd and additionalDirectories."
  )
}

function assertPathInsideWorkspace(workspace: string, target: string) {
  if (isPathInsideRoot(workspace, target)) {
    return
  }

  throw new Error("ACP file access is limited to this session workspace.")
}

export function applyLineWindow(
  content: string,
  line?: number | null,
  limit?: number | null
) {
  if (line == null && limit == null) {
    return content
  }

  const lines = content.split(/\r?\n/)
  const start = Math.max((line ?? 1) - 1, 0)
  const end = limit == null ? undefined : start + Math.max(limit, 0)

  return lines.slice(start, end).join("\n")
}

async function getSafeWriteChange(
  workspace: string,
  safePath: string,
  nextContent: string
): Promise<Extract<AgentEvent, { type: "file_change" }> | null> {
  let previousContent: string | null = null

  try {
    previousContent = await readFile(safePath, "utf8")
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error
    }
  }

  if (previousContent === nextContent) {
    return null
  }

  const workspaceRealPath = await realpath(workspace)
  const pathFromWorkspace = relative(workspaceRealPath, safePath)
  const displayPath =
    pathFromWorkspace &&
    !pathFromWorkspace.startsWith("..") &&
    !isAbsolute(pathFromWorkspace)
      ? pathFromWorkspace
      : safePath

  return {
    type: "file_change",
    path: displayPath,
    kind: previousContent === null ? "create" : "edit",
    status: "complete",
    diff: createUnifiedFileDiff({
      path: displayPath,
      previousContent,
      nextContent,
    }),
  }
}

const ACP_TERMINAL_PERMISSION_OPTIONS: PermissionOption[] = [
  {
    optionId: "allow_once",
    name: "Allow once",
    kind: "allow_once",
  },
  {
    optionId: "allow_always",
    name: "Allow always",
    kind: "allow_always",
  },
  {
    optionId: "reject_once",
    name: "Reject",
    kind: "reject_once",
  },
]

function getTerminalPermissionInput(params: {
  args?: string[]
  command: string
  cwd?: string | null
  env?: Array<{ name: string; value: string }>
}) {
  return stringifyPayload(
    compactObject([
      ["command", [params.command, ...(params.args ?? [])].join(" ")],
      ["cwd", params.cwd],
      ["env", params.env?.map((entry) => entry.name).filter(Boolean) ?? []],
    ])
  )
}

async function requestAcpTerminalPermission({
  emitEvent,
  params,
  sessionId,
  signal,
}: {
  emitEvent?: (event: AgentEvent) => void
  params: {
    args?: string[]
    command: string
    cwd?: string | null
    env?: Array<{ name: string; value: string }>
  }
  sessionId: string
  signal: AbortSignal
}) {
  const requestId = randomUUID()
  const options = ACP_TERMINAL_PERMISSION_OPTIONS.map((option) => ({
    ...option,
  }))
  const input = getTerminalPermissionInput(params)
  const toolName = "terminal"

  emitEvent?.({
    type: "permission_request",
    requestId,
    toolName,
    input,
    options,
    status: "pending",
    selectedOptionId: null,
    decisions: [],
  })

  const decision = await requestPermission({
    sessionId,
    requestId,
    toolName,
    inputPreview: input,
    options,
    signal,
  })

  if ("cancelled" in decision) {
    emitEvent?.({
      type: "permission_request",
      requestId,
      toolName,
      input,
      options,
      status: "resolved",
      selectedOptionId: null,
      decisions: ["cancelled"],
    })

    throw new Error("Terminal execution cancelled.")
  }

  const option =
    options.find((candidate) => candidate.optionId === decision.optionId) ??
    null

  emitEvent?.({
    type: "permission_request",
    requestId,
    toolName,
    input,
    options,
    status: "resolved",
    selectedOptionId: decision.optionId,
    decisions: [decision.feedback || option?.name || decision.optionId],
  })

  if (!option?.kind.startsWith("allow")) {
    throw new Error(decision.feedback || "Terminal execution rejected.")
  }
}

function getTerminalSession(terminalId: string, studioSessionId: string) {
  const terminal = acpTerminalSessions.get(terminalId)

  if (
    !terminal ||
    terminal.released ||
    terminal.studioSessionId !== studioSessionId
  ) {
    throw new Error(`ACP terminal not found: ${terminalId}`)
  }

  return terminal
}

function releaseAcpTerminal(terminalId: string, studioSessionId?: string) {
  const terminal = acpTerminalSessions.get(terminalId)

  if (
    !terminal ||
    (studioSessionId && terminal.studioSessionId !== studioSessionId)
  ) {
    return
  }

  // A short-lived terminal can be released before the trailing throttle fires.
  // Flush the final snapshot while the stream is still live so no output is
  // lost between the last data chunk and terminal/release.
  flushTerminalOutputStream(terminal)
  terminal.released = true
  clearTerminalOutputStream(terminal)
  acpTerminalSessions.delete(terminalId)
  terminateChild(terminal.child)
}

function releaseAcpSessionTerminals(studioSessionId: string) {
  for (const terminal of [...acpTerminalSessions.values()]) {
    if (terminal.studioSessionId === studioSessionId) {
      releaseAcpTerminal(terminal.terminalId)
    }
  }
}

async function createAcpTerminal({
  allowedDirectories,
  emitEvent,
  params,
  sessionId,
  workspace,
}: {
  allowedDirectories?: readonly string[]
  emitEvent?: (event: AgentEvent) => void
  params: {
    args?: string[]
    command: string
    cwd?: string | null
    env?: Array<{ name: string; value: string }>
    outputByteLimit?: number | null
  }
  sessionId: string
  workspace: string
}) {
  const fileSystemRoots = [workspace, ...(allowedDirectories ?? [])]
  const cwd = params.cwd
    ? await resolveSafeReadPath(fileSystemRoots, params.cwd)
    : await realpath(workspace)
  const env = Object.fromEntries(
    (params.env ?? []).flatMap((entry) =>
      entry.name ? [[entry.name, entry.value]] : []
    )
  )
  const child = spawn(params.command, params.args ?? [], {
    cwd,
    env: getConfiguredPythonProcessEnvironment(env),
    stdio: ["pipe", "pipe", "pipe"],
  })
  const terminalId = randomUUID()
  const outputByteLimit = Math.max(
    0,
    Math.min(
      params.outputByteLimit ?? ACP_TERMINAL_DEFAULT_OUTPUT_BYTE_LIMIT,
      2 * 1024 * 1024
    )
  )
  const terminal: AcpTerminalState = {
    child,
    emitEvent: emitEvent ?? null,
    exitStatus: null,
    output: "",
    outputByteLimit,
    released: false,
    streamTimer: null,
    studioSessionId: sessionId,
    terminalId,
    toolCallId: null,
    toolName: "",
    truncated: false,
    waiters: [],
  }
  const stdoutDecoder = createAcpUtf8ChunkDecoder()
  const stderrDecoder = createAcpUtf8ChunkDecoder()

  acpTerminalSessions.set(terminalId, terminal)
  child.stdout.on("data", (chunk: Buffer) =>
    appendTerminalOutput(terminal, stdoutDecoder.write(chunk))
  )
  child.stderr.on("data", (chunk: Buffer) =>
    appendTerminalOutput(terminal, stderrDecoder.write(chunk))
  )
  child.stdout.once("end", () =>
    appendTerminalOutput(terminal, stdoutDecoder.end())
  )
  child.stderr.once("end", () =>
    appendTerminalOutput(terminal, stderrDecoder.end())
  )
  // `close` is emitted only after stdout/stderr have closed, whereas `exit`
  // may precede their final data. Resolving waiters here makes a subsequent
  // terminal/release flush deterministic.
  child.once("close", (code, signal) => {
    terminal.exitStatus = terminalExitStatus(code, signal)
    resolveTerminalWaiters(terminal)
  })
  child.once("error", (error) => {
    appendTerminalOutput(terminal, `${errorMessage(error)}\n`)
    terminal.exitStatus = terminalExitStatus(1, null)
    resolveTerminalWaiters(terminal)
  })

  return terminalId
}

export function waitForAcpTerminalExit(
  terminal: AcpTerminalState,
  signal?: AbortSignal
) {
  if (terminal.exitStatus) {
    return Promise.resolve(terminal.exitStatus)
  }

  return new Promise<TerminalExitStatus>((resolve, reject) => {
    let settled = false
    const removeWaiter = () => {
      const index = terminal.waiters.indexOf(resolveAndCleanup)

      if (index >= 0) {
        terminal.waiters.splice(index, 1)
      }
    }
    const onAbort = () => {
      if (settled) {
        return
      }

      settled = true
      removeWaiter()
      reject(createAbortError("ACP terminal wait cancelled."))
    }
    const resolveAndCleanup = (status: TerminalExitStatus) => {
      if (settled) {
        return
      }

      settled = true
      signal?.removeEventListener("abort", onAbort)
      removeWaiter()
      resolve(status)
    }

    if (signal?.aborted) {
      onAbort()
      return
    }

    signal?.addEventListener("abort", onAbort, { once: true })
    terminal.waiters.push(resolveAndCleanup)
  })
}

function getElicitationScopeSessionId(params: CreateElicitationRequest) {
  return "sessionId" in params && typeof params.sessionId === "string"
    ? params.sessionId
    : null
}

function getElicitationPropertyOptions(property: Record<string, unknown>) {
  const enumValues = Array.isArray(property.enum)
    ? property.enum.filter(
        (value): value is string => typeof value === "string"
      )
    : []

  if (enumValues.length) {
    return enumValues.slice(0, 8).map((value) => ({
      optionId: value,
      label: value,
      description: "",
    }))
  }

  const oneOf = Array.isArray(property.oneOf) ? property.oneOf : []
  const titledOptions = oneOf.flatMap((entry) => {
    const record = getRecord(entry)
    const value = typeof record?.const === "string" ? record.const : ""
    const title = typeof record?.title === "string" ? record.title : value

    return value
      ? [
          {
            optionId: value,
            label: title,
            description: "",
          },
        ]
      : []
  })

  if (titledOptions.length) {
    return titledOptions.slice(0, 8)
  }

  if (property.type === "boolean") {
    return [
      {
        optionId: "true",
        label: "Yes",
        description: "",
      },
      {
        optionId: "false",
        label: "No",
        description: "",
      },
    ]
  }

  return []
}

function createElicitationQuestions(params: CreateElicitationRequest) {
  if (params.mode === "url" && typeof params.url === "string") {
    return [
      {
        id: "url",
        header: "Open URL",
        question: `${params.message}\n${params.url}`,
        options: [
          {
            optionId: "continue",
            label: "Continue",
            description: "Continue after completing this step.",
          },
        ],
        allowOther: false,
        isSecret: false,
      },
    ]
  }

  const schema =
    params.mode === "form" ? getRecord(params.requestedSchema) : null
  const properties = getRecord(schema?.properties) ?? {}
  const required = new Set(
    Array.isArray(schema?.required)
      ? schema.required.filter(
          (value: unknown): value is string => typeof value === "string"
        )
      : []
  )
  const entries = Object.entries(properties).slice(0, 3)

  if (!entries.length) {
    return [
      {
        id: "response",
        header: "Input",
        question: params.message,
        options: [],
        allowOther: true,
        isSecret: false,
      },
    ]
  }

  return entries.map(([id, property]) => {
    const record = getRecord(property) ?? {}
    const title = typeof record.title === "string" ? record.title : id
    const description =
      typeof record.description === "string" ? record.description : ""

    return {
      id,
      header: title.slice(0, 24) || "Input",
      question: [params.message, description].filter(Boolean).join("\n"),
      options: getElicitationPropertyOptions(record),
      allowOther:
        !getElicitationPropertyOptions(record).length || !required.has(id),
      isSecret:
        record.format === "password" || /password|secret|token|key/i.test(id),
    }
  })
}

function coerceElicitationValue(value: string, schema: unknown) {
  const record = getRecord(schema)

  if (record?.type === "number" || record?.type === "integer") {
    const parsed =
      record.type === "integer" ? Number.parseInt(value, 10) : Number(value)

    return Number.isFinite(parsed) ? parsed : value
  }

  if (record?.type === "boolean") {
    return value === "true" || /^yes$/i.test(value)
  }

  if (record?.type === "array") {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  }

  return value
}

function elicitationAnswersToContent(
  params: CreateElicitationRequest,
  answers: Array<{ questionId: string; text: string; label: string | null }>
) {
  if (params.mode !== "form") {
    return {}
  }

  const schema = getRecord(params.requestedSchema)
  const properties = getRecord(schema?.properties) ?? {}

  return Object.fromEntries(
    answers.map((answer) => [
      answer.questionId,
      coerceElicitationValue(
        answer.text || answer.label || "",
        properties[answer.questionId]
      ),
    ])
  )
}

export function createAcpClientApp({
  debugLabel,
  emitEvent,
  getAdditionalDirectories,
  getAcpSessionId,
  getSignal,
  localWorkspaceAccess = true,
  mcpBridge,
  onSessionUpdate,
  sessionId,
  workspace,
}: {
  debugLabel: string
  emitEvent?: (event: AgentEvent) => void
  getAdditionalDirectories?: () => readonly string[]
  getAcpSessionId?: () => string | null
  getSignal: () => AbortSignal
  localWorkspaceAccess?: boolean
  mcpBridge?: AcpMcpBridge | null
  onSessionUpdate?: (notification: SessionNotification) => void
  sessionId: string
  workspace: string
}) {
  const getFileSystemRoots = () => [
    workspace,
    ...(getAdditionalDirectories?.() ?? []),
  ]
  const requireLocalWorkspaceAccess = () => {
    if (!localWorkspaceAccess) {
      throw new Error(
        "This remote ACP connection does not grant access to the Desktop filesystem or terminal."
      )
    }
  }

  return createAcpClient({ name: "AstraFlow Desktop" })
    .onNotification(methods.client.session.update, ({ params }) => {
      onSessionUpdate?.(params)
    })
    .onRequest(methods.client.fs.readTextFile, async ({ params, signal }) => {
      requireLocalWorkspaceAccess()
      assertAcpSessionScope(params.sessionId, getAcpSessionId?.() ?? null)
      requireAbsoluteAcpPath(params.path, "fs/read_text_file path")
      signal.throwIfAborted()
      const safePath = await resolveSafeReadPath(
        getFileSystemRoots(),
        params.path
      )
      const content = await readFile(safePath, "utf8")

      signal.throwIfAborted()
      return {
        content: applyLineWindow(content, params.line, params.limit),
      }
    })
    .onRequest(methods.client.fs.writeTextFile, async ({ params, signal }) => {
      requireLocalWorkspaceAccess()
      assertAcpSessionScope(params.sessionId, getAcpSessionId?.() ?? null)
      requireAbsoluteAcpPath(params.path, "fs/write_text_file path")
      signal.throwIfAborted()
      const safePath = await resolveSafeWritePath(
        getFileSystemRoots(),
        params.path
      )
      const fileChange = await getSafeWriteChange(
        workspace,
        safePath,
        params.content
      )

      await writeFile(safePath, params.content, {
        encoding: "utf8",
        flag: ACP_SAFE_WRITE_FLAGS,
      })
      signal.throwIfAborted()

      if (fileChange) {
        emitEvent?.(fileChange)
        debugAcp("fs_write_text_file", {
          debugLabel,
          kind: fileChange.kind,
          path: fileChange.path,
          sessionId: params.sessionId,
        })
      }
    })
    .onRequest(methods.client.terminal.create, async ({ params, signal }) => {
      requireLocalWorkspaceAccess()
      assertAcpSessionScope(params.sessionId, getAcpSessionId?.() ?? null)
      if (params.cwd) {
        requireAbsoluteAcpPath(params.cwd, "terminal/create cwd")
      }
      const requestSignal = combineAcpRequestSignals(signal, getSignal())

      await requestAcpTerminalPermission({
        emitEvent,
        params,
        sessionId,
        signal: requestSignal,
      })
      requestSignal.throwIfAborted()

      const terminalId = await createAcpTerminal({
        allowedDirectories: getAdditionalDirectories?.(),
        emitEvent,
        params,
        sessionId,
        workspace,
      })

      debugAcp("terminal_create", {
        command: params.command,
        debugLabel,
        terminalId,
      })

      return { terminalId }
    })
    .onRequest(methods.client.terminal.output, async ({ params, signal }) => {
      requireLocalWorkspaceAccess()
      assertAcpSessionScope(params.sessionId, getAcpSessionId?.() ?? null)
      signal.throwIfAborted()
      const terminal = getTerminalSession(params.terminalId, sessionId)

      return {
        output: terminal.output,
        truncated: terminal.truncated,
        exitStatus: terminal.exitStatus,
      }
    })
    .onRequest(
      methods.client.terminal.waitForExit,
      async ({ params, signal }) => {
        requireLocalWorkspaceAccess()
        assertAcpSessionScope(params.sessionId, getAcpSessionId?.() ?? null)
        return waitForAcpTerminalExit(
          getTerminalSession(params.terminalId, sessionId),
          combineAcpRequestSignals(signal, getSignal())
        )
      }
    )
    .onRequest(methods.client.terminal.kill, async ({ params, signal }) => {
      requireLocalWorkspaceAccess()
      assertAcpSessionScope(params.sessionId, getAcpSessionId?.() ?? null)
      signal.throwIfAborted()
      const terminal = getTerminalSession(params.terminalId, sessionId)

      terminateChild(terminal.child)
    })
    .onRequest(methods.client.terminal.release, async ({ params, signal }) => {
      requireLocalWorkspaceAccess()
      assertAcpSessionScope(params.sessionId, getAcpSessionId?.() ?? null)
      signal.throwIfAborted()
      releaseAcpTerminal(params.terminalId, sessionId)
    })
    .onRequest(
      methods.client.elicitation.create,
      async ({ params, signal }) => {
        const scopedSessionId = getElicitationScopeSessionId(params)

        assertAcpSessionScope(scopedSessionId, getAcpSessionId?.() ?? null)
        const requestSignal = combineAcpRequestSignals(signal, getSignal())
        requestSignal.throwIfAborted()
        const requestId =
          "requestId" in params && typeof params.requestId === "string"
            ? params.requestId
            : "elicitationId" in params &&
                typeof params.elicitationId === "string"
              ? params.elicitationId
              : randomUUID()
        const questions = createElicitationQuestions(params)

        emitEvent?.({
          type: "user_input_request",
          requestId,
          questions,
          status: "pending",
        })

        const decision = await requestUserInput({
          questions,
          requestId,
          sessionId,
          signal: requestSignal,
        })

        if ("cancelled" in decision) {
          emitEvent?.({
            type: "user_input_request",
            requestId,
            questions,
            answers: [],
            status: "resolved",
          })

          return { action: "cancel" as const }
        }

        emitEvent?.({
          type: "user_input_request",
          requestId,
          questions,
          answers: decision.answers,
          status: "resolved",
        })

        debugAcp("elicitation_answered", {
          debugLabel,
          mode: params.mode,
          scopedSessionId,
        })

        return {
          action: "accept" as const,
          content: elicitationAnswersToContent(params, decision.answers),
        }
      }
    )
    .onNotification(methods.client.elicitation.complete, async ({ params }) => {
      emitEvent?.({
        type: "run_meta",
        metadata: {
          acp: {
            elicitationComplete: params,
          },
        },
      })
    })
    .onRequest(
      ACP_MCP_METHODS.connect,
      connectMcpRequestParser,
      async ({ agent, params }) => {
        if (!mcpBridge) {
          throw new Error("ACP MCP bridge is not configured for this session.")
        }

        return mcpBridge.connect(params, agent)
      }
    )
    .onRequest(
      ACP_MCP_METHODS.message,
      messageMcpRequestParser,
      async ({ params, signal }) => {
        if (!mcpBridge) {
          throw new Error("ACP MCP bridge is not configured for this session.")
        }

        return mcpBridge.request(params, {
          signal: combineAcpRequestSignals(signal, getSignal()),
        })
      }
    )
    .onNotification(
      ACP_MCP_METHODS.message,
      messageMcpRequestParser,
      async ({ params }) => {
        if (!mcpBridge) {
          return
        }

        await mcpBridge.notify(params, { signal: getSignal() })
      }
    )
    .onRequest(
      ACP_MCP_METHODS.disconnect,
      disconnectMcpRequestParser,
      async ({ params }) => {
        if (!mcpBridge) {
          return {}
        }

        await mcpBridge.disconnect(params)

        return {}
      }
    )
    .onRequest(
      methods.client.session.requestPermission,
      async ({ params, signal }) => {
        assertAcpSessionScope(params.sessionId, getAcpSessionId?.() ?? null)
        const requestSignal = combineAcpRequestSignals(signal, getSignal())
        const permissionRequestId = randomUUID()
        const options: PermissionOption[] = params.options.map((option) => ({
          optionId: option.optionId,
          name: option.name,
          kind: option.kind,
          _meta: option._meta ?? null,
        }))
        const toolCall = params.toolCall
        const toolName =
          toolCall.kind === "execute"
            ? "execute"
            : normalizeAgentToolName(toolCall.title ?? toolCall.kind ?? "tool")
        const input = stringifyPayload(toolCall.rawInput ?? toolCall)

        emitEvent?.({
          type: "permission_request",
          requestId: permissionRequestId,
          toolName,
          input,
          options,
          status: "pending",
          selectedOptionId: null,
          decisions: [],
        })

        const decision = await requestPermission({
          sessionId,
          requestId: permissionRequestId,
          toolName,
          inputPreview: input,
          options,
          signal: requestSignal,
        })

        if ("cancelled" in decision) {
          emitEvent?.({
            type: "permission_request",
            requestId: permissionRequestId,
            toolName,
            input,
            options,
            status: "resolved",
            selectedOptionId: null,
            decisions: ["cancelled"],
          })

          return {
            outcome: { outcome: "cancelled" as const },
          }
        }

        const option = options.find(
          (candidate) => candidate.optionId === decision.optionId
        )

        debugAcp("permission_auto_selected", {
          debugLabel,
          optionId: decision.optionId,
          optionKind: option?.kind,
          sessionId: params.sessionId,
        })

        emitEvent?.({
          type: "permission_request",
          requestId: permissionRequestId,
          toolName,
          input,
          options,
          status: "resolved",
          selectedOptionId: decision.optionId,
          decisions: [decision.feedback || option?.name || decision.optionId],
        })

        return {
          outcome: {
            outcome: "selected" as const,
            optionId: decision.optionId,
            ...(decision.feedback
              ? { _meta: { astraflowFeedback: decision.feedback } }
              : {}),
          },
        }
      }
    )
}

export function spawnAcpChild(
  command: AcpStdioCommandSpec,
  cwd: string
): ChildProcessWithoutNullStreams {
  const child = spawn(command.command, command.args ?? [], {
    cwd,
    env: getConfiguredPythonProcessEnvironment(command.env),
    stdio: ["pipe", "pipe", "pipe"],
  })

  acpChildren.add(child)
  child.once("exit", () => {
    acpChildren.delete(child)
  })

  return child
}

export function createAcpProcessStream(child: ChildProcessWithoutNullStreams) {
  return ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
  )
}

export function getAcpTransportCookieStoreKey(
  command: AcpCommandSpec,
  sessionKey: string
) {
  if (command.transport !== "http" && command.transport !== "websocket") {
    return null
  }

  const identityHash = createHash("sha256")
    .update(command.transport)
    .update("\0")
    .update(command.url)
    .update("\0")
    .update(JSON.stringify(Object.entries(command.headers ?? {}).sort()))
    .digest("hex")

  return `${sessionKey}:${identityHash}`
}

function createAcpCommandStream(
  command: AcpCommandSpec,
  cwd: string,
  sessionKey: string
): {
  child: ChildProcessWithoutNullStreams | null
  cookieStoreKey: string | null
  spawnError: Promise<never>
  stream: ReturnType<typeof ndJsonStream>
} {
  const cookieState = (() => {
    if (command.transport !== "http" && command.transport !== "websocket") {
      return { key: null, store: null }
    }

    const key = getAcpTransportCookieStoreKey(command, sessionKey)

    if (!key) {
      return { key: null, store: null }
    }
    const existing = acpTransportCookieStores.get(key)

    if (existing) {
      return { key, store: existing }
    }

    const created = new MemoryAcpCookieStore()

    acpTransportCookieStores.set(key, created)
    return { key, store: created }
  })()

  if (command.transport === "http") {
    return {
      child: null,
      cookieStoreKey: cookieState.key,
      spawnError: new Promise<never>(() => undefined),
      stream: createHttpStream(command.url, {
        cookieStore: cookieState.store ?? undefined,
        cookies: "include",
        headers: command.headers,
      }) as ReturnType<typeof ndJsonStream>,
    }
  }

  if (command.transport === "websocket") {
    return {
      child: null,
      cookieStoreKey: cookieState.key,
      spawnError: new Promise<never>(() => undefined),
      stream: createWebSocketStream(command.url, {
        cookieStore: cookieState.store ?? undefined,
        cookies: "include",
        headers: command.headers,
        // Node's built-in WebSocket wraps useful connection failures in an
        // opaque ErrorEvent. The ws implementation preserves the underlying
        // handshake or network error and is the SDK's documented Node path.
        WebSocket: NodeWebSocket,
      }) as ReturnType<typeof ndJsonStream>,
    }
  }

  const child = spawnAcpChild(command, cwd)

  return {
    child,
    cookieStoreKey: null,
    spawnError: new Promise<never>((_, reject) => {
      child.once("error", reject)
    }),
    stream: createAcpProcessStream(child),
  }
}

export async function initializeAcpConnection(
  connection: ClientConnection,
  { remoteWorkspace = false }: { remoteWorkspace?: boolean } = {}
): Promise<InitializeResponse> {
  const response = await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      auth: {
        terminal: false,
      },
      elicitation: {
        form: {},
      },
      fs: {
        readTextFile: !remoteWorkspace,
        writeTextFile: !remoteWorkspace,
      },
      plan: {},
      positionEncodings: ["utf-16", "utf-8"],
      session: {
        configOptions: {
          boolean: {},
        },
      },
      terminal: !remoteWorkspace,
    },
    clientInfo: {
      name: "AstraFlow Desktop",
      title: "AstraFlow Desktop",
      version: ASTRAFLOW_DESKTOP_VERSION,
    },
  })

  if (response.protocolVersion > PROTOCOL_VERSION) {
    throw new Error(
      `ACP protocol version ${response.protocolVersion} is not supported; AstraFlow Desktop supports versions through ${PROTOCOL_VERSION}.`
    )
  }

  return response
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

function parseImageDataUrl(url: string) {
  const match = url.match(/^data:([^;,]+);base64,([\s\S]+)$/)

  if (!match) {
    return null
  }

  return {
    mimeType: match[1] || "image/png",
    data: match[2] || "",
  }
}

export function supportsAcpPromptImage(
  capabilities?: PromptCapabilities | null
) {
  return capabilities?.image === true
}

function supportsAcpPromptAudio(capabilities?: PromptCapabilities | null) {
  return capabilities?.audio === true
}

function supportsAcpEmbeddedContext(capabilities?: PromptCapabilities | null) {
  return capabilities?.embeddedContext === true
}

function contentPartToBlocks(
  part: unknown,
  capabilities?: PromptCapabilities | null
): ContentBlock[] {
  if (typeof part === "string") {
    return part ? [{ type: "text", text: part }] : []
  }

  const record = getRecord(part)

  if (!record) {
    return []
  }

  if (record.type === "text" && typeof record.text === "string") {
    return record.text ? [{ type: "text", text: record.text }] : []
  }

  if (record.type === "image_url") {
    const imageUrl = getRecord(record.image_url)
    const url =
      typeof record.image_url === "string"
        ? record.image_url
        : typeof imageUrl?.url === "string"
          ? imageUrl.url
          : null

    if (!url) {
      return []
    }

    const image = parseImageDataUrl(url)

    if (image) {
      return supportsAcpPromptImage(capabilities)
        ? [{ type: "image", data: image.data, mimeType: image.mimeType }]
        : [
            {
              type: "text",
              text: "[image attachment omitted: agent does not advertise image prompt support]",
            },
          ]
    }

    return [
      {
        type: "resource_link",
        name: "image",
        uri: url,
      },
    ]
  }

  if (record.type === "audio" || record.type === "input_audio") {
    const data =
      typeof record.data === "string"
        ? record.data
        : typeof record.audio === "string"
          ? record.audio
          : null
    const mimeType =
      typeof record.mimeType === "string"
        ? record.mimeType
        : typeof record.format === "string"
          ? `audio/${record.format}`
          : "audio/mpeg"

    if (data && supportsAcpPromptAudio(capabilities)) {
      return [{ type: "audio", data, mimeType }]
    }

    return [
      {
        type: "text",
        text: "[audio attachment omitted: agent does not advertise audio prompt support]",
      },
    ]
  }

  return [{ type: "text", text: stringifyPayload(record) }]
}

export function messageContentToBlocks(
  content: AgentMessageContent,
  capabilities?: PromptCapabilities | null
) {
  if (typeof content === "string") {
    return content
      ? [{ type: "text", text: content } satisfies ContentBlock]
      : []
  }

  if (Array.isArray(content)) {
    return content.flatMap((part) => contentPartToBlocks(part, capabilities))
  }

  return [
    { type: "text", text: stringifyPayload(content) } satisfies ContentBlock,
  ]
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

function mentionToResourceLinkBlock(
  mention: Extract<PromptMention, { kind: "file" | "folder" }>
): ContentBlock {
  return {
    type: "resource_link",
    uri: filePathToAcpUri(mention.path),
    name: mention.name,
  }
}

export function filePathToAcpUri(path: string) {
  return pathToFileURL(path).href
}

async function mentionToPromptBlock({
  capabilities,
  mention,
  workspace,
}: {
  capabilities?: PromptCapabilities | null
  mention: Extract<PromptMention, { kind: "file" | "folder" }>
  workspace: string
}): Promise<ContentBlock> {
  if (mention.kind !== "file" || !supportsAcpEmbeddedContext(capabilities)) {
    return mentionToResourceLinkBlock(mention)
  }

  try {
    const safePath = await resolveSafeReadPath(workspace, mention.path)
    const stat = await lstat(safePath)

    if (!stat.isFile() || stat.size > ACP_EMBEDDED_RESOURCE_MAX_BYTES) {
      return mentionToResourceLinkBlock(mention)
    }

    const text = await readFile(safePath, "utf8")

    return {
      type: "resource",
      resource: {
        uri: filePathToAcpUri(safePath),
        text,
        mimeType: "text/plain",
      },
    }
  } catch (error) {
    debugAcp("embedded_resource_failed", {
      error: errorMessage(error),
      path: mention.path,
    })

    return mentionToResourceLinkBlock(mention)
  }
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

function createConversationRecap(
  messages: AgentMessage[],
  latestUserIndex: number
) {
  const priorMessages = messages
    .slice(Math.max(0, latestUserIndex - 6), latestUserIndex)
    .map((message) => {
      const text = truncateForPrompt(messageContentToText(message.content))

      return text ? `- ${roleLabelForMessage(message)}: ${text}` : null
    })
    .filter(Boolean)

  if (!priorMessages.length) {
    return null
  }

  return [
    "Conversation recap before reconnecting the external ACP agent:",
    ...priorMessages,
  ].join("\n")
}

function isSlashCommandText(text: string) {
  return /^\/[A-Za-z0-9][\w:-]*(?:\s|$)/.test(text.trim())
}

function startsWithSlashCommand(blocks: ContentBlock[]) {
  const firstBlock = blocks[0]

  return firstBlock?.type === "text" && isSlashCommandText(firstBlock.text)
}

function getAcpAgentDisplayName(response: InitializeResponse) {
  const agentInfo = response.agentInfo
  const title =
    typeof agentInfo?.title === "string" ? agentInfo.title.trim() : ""
  const name = typeof agentInfo?.name === "string" ? agentInfo.name.trim() : ""

  return title || name || "ACP agent"
}

export async function createPromptBlocks(
  messages: AgentMessage[],
  capabilities: PromptCapabilities | null | undefined,
  shouldIncludeRecap: boolean,
  promptPreamble: string | null,
  workspace: string
) {
  const latestUserMessage = getLatestUserMessage(messages)
  const preambleBlocks = promptPreamble
    ? [{ type: "text", text: promptPreamble } satisfies ContentBlock]
    : []

  if (!latestUserMessage) {
    return preambleBlocks.length
      ? preambleBlocks
      : [{ type: "text", text: "" } satisfies ContentBlock]
  }

  const blocks = messageContentToBlocks(
    latestUserMessage.message.content,
    capabilities
  )
  const latestBlocks = blocks.length
    ? blocks
    : [{ type: "text", text: "" } satisfies ContentBlock]
  const mentionBlocks = await Promise.all(
    getFilePromptMentions(latestUserMessage.message).map((mention) =>
      mentionToPromptBlock({
        capabilities,
        mention,
        workspace,
      })
    )
  )

  if (startsWithSlashCommand(latestBlocks)) {
    return [...latestBlocks, ...preambleBlocks, ...mentionBlocks]
  }

  if (!shouldIncludeRecap) {
    return [...preambleBlocks, ...latestBlocks, ...mentionBlocks]
  }

  const recap = createConversationRecap(messages, latestUserMessage.index)

  if (!recap) {
    return [...preambleBlocks, ...latestBlocks, ...mentionBlocks]
  }

  return [
    ...preambleBlocks,
    {
      type: "text",
      text: `${recap}\n\nLatest user message:`,
    } satisfies ContentBlock,
    ...latestBlocks,
    ...mentionBlocks,
  ]
}

function contentBlockToDisplayText(content: unknown) {
  const record = getRecord(content)

  if (!record) {
    return ""
  }

  if (record.type === "text" && typeof record.text === "string") {
    return record.text
  }

  if (record.type === "image") {
    const mimeType =
      typeof record.mimeType === "string" ? record.mimeType : "image"
    const uri = typeof record.uri === "string" ? ` ${record.uri}` : ""

    return `\n[image: ${mimeType}${uri}]\n`
  }

  if (record.type === "audio") {
    const mimeType =
      typeof record.mimeType === "string" ? record.mimeType : "audio"

    return `\n[audio: ${mimeType}]\n`
  }

  if (record.type === "resource_link") {
    const name = typeof record.name === "string" ? record.name : "resource"
    const uri = typeof record.uri === "string" ? record.uri : ""

    return `\n[resource: ${name}${uri ? ` ${uri}` : ""}]\n`
  }

  if (record.type === "resource") {
    const resource = getRecord(record.resource)
    const uri = typeof resource?.uri === "string" ? resource.uri : "resource"

    if (typeof resource?.text === "string") {
      return `\n[resource: ${uri}]\n${resource.text}\n`
    }

    const mimeType =
      typeof resource?.mimeType === "string" ? resource.mimeType : "binary"

    return `\n[resource: ${uri} ${mimeType}]\n`
  }

  return stringifyPayload(record)
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

function getToolName(
  update: {
    content?: unknown
    kind?: string | null
    rawInput?: unknown
    title?: string | null
    toolCallId: string
  },
  state: AcpMapperReplayState
) {
  const existing = state.toolNames.get(update.toolCallId)

  if (existing && existing !== "tool") {
    return existing
  }

  const rawInput = getRecord(update.rawInput)
  const server =
    typeof rawInput?.server === "string" ? rawInput.server.trim() : ""
  const tool = typeof rawInput?.tool === "string" ? rawInput.tool.trim() : ""
  const isCommand =
    typeof rawInput?.command === "string" ||
    getUpdateTerminalIds(update.content).length > 0
  const executeName = isCommand
    ? "execute"
    : server && tool
      ? `${getMcpToolServerName(server)}__${tool}`
      : update.title?.trim() || "execute"
  const title = update.title?.trim() ?? ""
  const normalizedTitle = title ? normalizeAgentToolName(title) : ""
  const useProviderToolAlias =
    Boolean(title) &&
    normalizedTitle !== title &&
    (!update.kind || update.kind === "other" || update.kind === "think")
  const candidate =
    update.kind === "execute"
      ? executeName
      : useProviderToolAlias
        ? normalizedTitle
        : update.kind && update.kind !== "other"
          ? update.kind
          : title || update.kind || existing || "tool"

  state.toolNames.set(update.toolCallId, candidate)

  return candidate
}

type AcpToolEventFields = {
  title?: string | null
  kind?: AgentToolKind | null
  acpStatus?: AgentToolCallStatus | null
  locations?: AgentToolCallLocation[] | null
  content?: AgentToolCallContent[] | null
  rawInput?: unknown
  rawOutput?: unknown
  meta?: Record<string, unknown> | null
  parentTaskId?: string
}

function sanitizeAcpRecord(value: Record<string, unknown>) {
  return (
    getRecord(
      sanitizeAgentStructuredValue(value, AGENT_STRUCTURED_RAW_LIMIT)
    ) ?? { _truncated: true }
  )
}

function truncateAcpStructuredText(value: string) {
  if (value.length <= AGENT_STRUCTURED_TEXT_LIMIT) {
    return value
  }

  const marker = "\n[truncated]"

  return `${value.slice(0, AGENT_STRUCTURED_TEXT_LIMIT - marker.length)}${marker}`
}

function truncateAcpControlText(value: string, limit = 2048) {
  return value.length <= limit ? value : value.slice(0, limit)
}

function sanitizeAcpMeta(value: Record<string, unknown> | null | undefined) {
  return value ? sanitizeAcpRecord(value) : value
}

function sanitizeAcpSelectOption(
  option: SessionConfigSelectOption
): SessionConfigSelectOption {
  return {
    value: truncateAcpControlText(option.value, 512),
    name: truncateAcpControlText(option.name),
    ...(option.description !== undefined
      ? {
          description:
            option.description === null
              ? null
              : truncateAcpControlText(option.description, 8192),
        }
      : {}),
    ...(option._meta !== undefined
      ? { _meta: sanitizeAcpMeta(option._meta) }
      : {}),
  }
}

function sanitizeAcpConfigOptions(
  options: readonly SessionConfigOption[] | null | undefined
): SessionConfigOption[] {
  if (!options?.length) {
    return []
  }

  let remainingValues = ACP_STRUCTURED_COLLECTION_LIMIT

  return options
    .slice(0, ACP_STRUCTURED_COLLECTION_LIMIT)
    .map((option): SessionConfigOption => {
      const common = {
        id: truncateAcpControlText(option.id, 512),
        name: truncateAcpControlText(option.name),
        ...(option.description !== undefined
          ? {
              description:
                option.description === null
                  ? null
                  : truncateAcpControlText(option.description, 8192),
            }
          : {}),
        ...(option.category !== undefined
          ? {
              category:
                option.category === null
                  ? null
                  : truncateAcpControlText(option.category, 512),
            }
          : {}),
        ...(option._meta !== undefined
          ? { _meta: sanitizeAcpMeta(option._meta) }
          : {}),
      }

      if (option.type === "boolean") {
        return {
          ...common,
          type: "boolean",
          currentValue: option.currentValue,
        }
      }

      const values = option.options.flatMap(
        (
          candidate
        ): Array<SessionConfigSelectOption | SessionConfigSelectGroup> => {
          if (remainingValues <= 0) {
            return []
          }

          if ("group" in candidate) {
            const groupValues = candidate.options
              .slice(0, remainingValues)
              .map(sanitizeAcpSelectOption)

            remainingValues -= groupValues.length

            return [
              {
                group: truncateAcpControlText(candidate.group, 512),
                name: truncateAcpControlText(candidate.name),
                options: groupValues,
                ...(candidate._meta !== undefined
                  ? { _meta: sanitizeAcpMeta(candidate._meta) }
                  : {}),
              },
            ]
          }

          remainingValues -= 1
          return [sanitizeAcpSelectOption(candidate)]
        }
      )

      return {
        ...common,
        type: "select",
        currentValue: truncateAcpControlText(option.currentValue, 512),
        options: values as SessionConfigSelectOptions,
      }
    })
}

function sanitizeAcpSessionModes(
  modes: SessionModeState | null | undefined,
  currentModeId?: string | null
): SessionModeState | null {
  if (!modes) {
    return null
  }

  return {
    currentModeId: truncateAcpControlText(
      currentModeId ?? modes.currentModeId,
      512
    ),
    availableModes: modes.availableModes
      .slice(0, ACP_STRUCTURED_COLLECTION_LIMIT)
      .map((mode) => ({
        id: truncateAcpControlText(mode.id, 512),
        name: truncateAcpControlText(mode.name),
        ...(mode.description !== undefined
          ? {
              description:
                mode.description === null
                  ? null
                  : truncateAcpControlText(mode.description, 8192),
            }
          : {}),
        ...(mode._meta !== undefined
          ? { _meta: sanitizeAcpMeta(mode._meta) }
          : {}),
      })),
    ...(modes._meta !== undefined
      ? { _meta: sanitizeAcpMeta(modes._meta) }
      : {}),
  }
}

function sanitizeAcpSessionInfoUpdate(
  update: Extract<SessionUpdate, { sessionUpdate: "session_info_update" }>
) {
  return {
    sessionUpdate: "session_info_update" as const,
    ...(update.title !== undefined
      ? {
          title:
            update.title === null
              ? null
              : truncateAcpControlText(update.title, 8192),
        }
      : {}),
    ...(update.updatedAt !== undefined
      ? {
          updatedAt:
            update.updatedAt === null
              ? null
              : truncateAcpControlText(update.updatedAt, 128),
        }
      : {}),
    ...(update._meta !== undefined
      ? { _meta: sanitizeAcpMeta(update._meta) }
      : {}),
  }
}

function mergeAcpExtensionMeta(
  current: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>
) {
  const merged: Record<string, unknown> = { ...(current ?? {}) }

  for (const [key, value] of Object.entries(incoming)) {
    const currentRecord = getRecord(merged[key])
    const incomingRecord = getRecord(value)

    merged[key] =
      currentRecord && incomingRecord
        ? { ...currentRecord, ...incomingRecord }
        : value
  }

  return merged
}

export function mergeAcpSessionInfoUpdate(
  current: Extract<
    SessionUpdate,
    { sessionUpdate: "session_info_update" }
  > | null,
  update: Extract<SessionUpdate, { sessionUpdate: "session_info_update" }>
) {
  const incoming = sanitizeAcpSessionInfoUpdate(update)
  const currentMeta = getRecord(current?._meta)
  const incomingMeta = getRecord(incoming._meta)
  const meta =
    incoming._meta === undefined
      ? current?._meta
      : incoming._meta === null
        ? null
        : mergeAcpExtensionMeta(currentMeta, incomingMeta ?? {})

  return {
    sessionUpdate: "session_info_update" as const,
    ...(incoming.title !== undefined
      ? { title: incoming.title }
      : current?.title !== undefined
        ? { title: current.title }
        : {}),
    ...(incoming.updatedAt !== undefined
      ? { updatedAt: incoming.updatedAt }
      : current?.updatedAt !== undefined
        ? { updatedAt: current.updatedAt }
        : {}),
    ...(meta !== undefined ? { _meta: meta } : {}),
  }
}

function getClaudeRateLimitInfo(
  update: Extract<SessionUpdate, { sessionUpdate: "usage_update" }>
) {
  if (
    !update._meta ||
    !Object.prototype.hasOwnProperty.call(update._meta, "_claude/rateLimit")
  ) {
    return undefined
  }

  const value = update._meta["_claude/rateLimit"]

  if (value === null) {
    return null
  }

  const record = getRecord(value)

  return record ? sanitizeAcpRecord(record) : undefined
}

function getAcpToolEventFields(
  update: {
    _meta?: Record<string, unknown> | null
    content?: unknown
    kind?: string | null
    locations?: unknown
    rawInput?: unknown
    rawOutput?: unknown
    status?: string | null
    title?: string | null
  },
  replacementSemantics = false
): AcpToolEventFields {
  const acpStatus =
    update.status === "pending" ||
    update.status === "in_progress" ||
    update.status === "completed" ||
    update.status === "failed"
      ? update.status
      : null
  const locations = Array.isArray(update.locations)
    ? update.locations
        .filter(isAgentToolCallLocation)
        .slice(0, ACP_STRUCTURED_COLLECTION_LIMIT)
        .map(sanitizeAgentToolCallLocation)
    : null
  const content = Array.isArray(update.content)
    ? update.content
        .filter(isAgentToolCallContent)
        .slice(0, ACP_STRUCTURED_COLLECTION_LIMIT)
        .map(sanitizeAgentToolCallContent)
    : null
  const claudeCode = getRecord(update._meta?.claudeCode)
  const astraflow = getRecord(update._meta?.astraflow)
  const rawParentTaskId =
    typeof claudeCode?.parentToolUseId === "string"
      ? claudeCode.parentToolUseId
      : typeof astraflow?.parentTaskId === "string"
        ? astraflow.parentTaskId
        : ""
  const parentTaskId =
    rawParentTaskId.trim().length > 0
      ? sanitizeAgentText(rawParentTaskId.trim(), 512)
      : ""

  return {
    ...(replacementSemantics || update.title !== undefined
      ? { title: update.title?.slice(0, 2048) ?? null }
      : {}),
    ...(replacementSemantics || update.kind !== undefined
      ? { kind: isAgentToolKind(update.kind) ? update.kind : null }
      : {}),
    ...(replacementSemantics || update.status !== undefined
      ? { acpStatus }
      : {}),
    ...(replacementSemantics || update.locations !== undefined
      ? { locations }
      : {}),
    ...(replacementSemantics || update.content !== undefined
      ? { content }
      : {}),
    ...(replacementSemantics || update.rawInput !== undefined
      ? {
          rawInput:
            update.rawInput === undefined || update.rawInput === null
              ? null
              : sanitizeAgentStructuredValue(update.rawInput),
        }
      : {}),
    ...(replacementSemantics || update.rawOutput !== undefined
      ? {
          rawOutput:
            update.rawOutput === undefined || update.rawOutput === null
              ? null
              : sanitizeAgentStructuredValue(update.rawOutput),
        }
      : {}),
    ...(replacementSemantics || update._meta !== undefined
      ? { meta: update._meta ? sanitizeAcpRecord(update._meta) : null }
      : {}),
    ...(parentTaskId ? { parentTaskId } : {}),
  }
}

function truncateAcpToolOutput(output: string) {
  if (output.length <= ACP_TOOL_OUTPUT_CHARACTER_LIMIT) {
    return output
  }

  const tailLength =
    ACP_TOOL_OUTPUT_CHARACTER_LIMIT - ACP_TOOL_OUTPUT_TRUNCATED_MARKER.length

  return `${ACP_TOOL_OUTPUT_TRUNCATED_MARKER}${output.slice(-tailLength)}`
}

function toolOutputToString(update: {
  content?: unknown
  rawOutput?: unknown
}) {
  if (update.rawOutput !== undefined) {
    const sanitizedRawOutput = sanitizeAgentStructuredValue(update.rawOutput)
    const rawOutput = getRecord(sanitizedRawOutput)

    if (rawOutput && typeof rawOutput.formatted_output === "string") {
      return stringifyPayload({
        ...rawOutput,
        formatted_output: truncateAcpToolOutput(rawOutput.formatted_output),
      })
    }

    if (rawOutput && typeof rawOutput.formattedOutput === "string") {
      return stringifyPayload({
        ...rawOutput,
        formattedOutput: truncateAcpToolOutput(rawOutput.formattedOutput),
      })
    }

    if (rawOutput && typeof rawOutput.output === "string") {
      return stringifyPayload({
        ...rawOutput,
        output: truncateAcpToolOutput(rawOutput.output),
      })
    }

    return truncateAcpToolOutput(stringifyPayload(sanitizedRawOutput))
  }

  if (Array.isArray(update.content)) {
    return truncateAcpToolOutput(
      update.content
        .filter(isAgentToolCallContent)
        .slice(0, ACP_STRUCTURED_COLLECTION_LIMIT)
        .map(sanitizeAgentToolCallContent)
        .map(toolCallContentToString)
        .filter(Boolean)
        .join("\n")
    )
  }

  return truncateAcpToolOutput(
    stringifyPayload(sanitizeAgentStructuredValue(update.content))
  )
}

function toolInputToString(update: {
  content?: unknown
  kind?: string | null
  locations?: unknown
  rawInput?: unknown
  status?: string | null
  title?: string | null
}) {
  if (update.rawInput !== undefined) {
    return truncateAcpToolOutput(
      stringifyPayload(sanitizeAgentStructuredValue(update.rawInput))
    )
  }

  if (Array.isArray(update.content)) {
    const content = update.content
      .filter(isAgentToolCallContent)
      .slice(0, ACP_STRUCTURED_COLLECTION_LIMIT)
      .map(sanitizeAgentToolCallContent)
      .map(toolCallContentToString)
      .filter(Boolean)
      .join("\n")

    if (content) {
      return truncateAcpToolOutput(content)
    }
  }

  return truncateAcpToolOutput(
    stringifyPayload(
      sanitizeAgentStructuredValue(
        compactObject([
          ["title", update.title],
          ["locations", update.locations],
        ])
      )
    )
  )
}

function getAcpToolExitCode(rawOutput: unknown) {
  const output = getRecord(rawOutput)
  const exitCode = output?.exit_code ?? output?.exitCode

  return typeof exitCode === "number" && Number.isFinite(exitCode)
    ? exitCode
    : null
}

function getAcpTerminalOutputUpdate(meta: unknown) {
  const record = getRecord(meta)
  const delta = getRecord(record?.terminal_output_delta)

  if (typeof delta?.data === "string") {
    return { data: delta.data, mode: "append" as const }
  }

  const snapshot = getRecord(record?.terminal_output)

  return typeof snapshot?.data === "string"
    ? { data: snapshot.data, mode: "replace" as const }
    : null
}

// The Pi forwarder streams the model's raw argument JSON for a still-
// generating tool call via `meta.astraflow.toolInput` (snapshot semantics).
function getAcpToolInputSnapshot(meta: unknown) {
  const record = getRecord(meta)
  const astraflow = getRecord(record?.astraflow)

  if (typeof astraflow?.toolInput !== "string" || !astraflow.toolInput) {
    return null
  }

  const sanitized = sanitizeAgentStructuredValue(
    astraflow.toolInput,
    ACP_TOOL_OUTPUT_CHARACTER_LIMIT
  )

  return typeof sanitized === "string" ? truncateAcpToolOutput(sanitized) : null
}

function updateAcpToolOutput(
  state: AcpMapperReplayState,
  toolCallId: string,
  update: { data: string; mode: "append" | "replace" }
) {
  const combined =
    update.mode === "append"
      ? `${state.toolOutputs.get(toolCallId) ?? ""}${update.data}`
      : update.data
  const sanitized = sanitizeAgentStructuredValue(
    combined,
    ACP_TOOL_OUTPUT_CHARACTER_LIMIT
  )
  const output = truncateAcpToolOutput(
    typeof sanitized === "string" ? sanitized : "[output redacted]"
  )

  state.toolOutputs.set(toolCallId, output)

  return output
}

// Extracts displayable partial output from a still-running tool_call_update.
// ACP servers that do not stream through terminals (e.g. the Pi forwarder)
// report progress as a tool-result-shaped partial in `rawOutput`; its text
// content blocks hold the accumulated output snapshot.
function getAcpToolPartialOutputText(update: {
  content?: unknown
  rawOutput?: unknown
}) {
  const rawOutput = getRecord(update.rawOutput)

  if (rawOutput && Array.isArray(rawOutput.content)) {
    const text = rawOutput.content
      .map(contentBlockToDisplayText)
      .filter(Boolean)
      .join("\n")
      .trim()

    if (text) {
      const sanitized = sanitizeAgentStructuredValue(
        text,
        ACP_TOOL_OUTPUT_CHARACTER_LIMIT
      )

      return typeof sanitized === "string" ? sanitized : "[output redacted]"
    }
  }

  if (typeof update.rawOutput === "string" && update.rawOutput.trim()) {
    const sanitized = sanitizeAgentStructuredValue(
      update.rawOutput.trim(),
      ACP_TOOL_OUTPUT_CHARACTER_LIMIT
    )

    return typeof sanitized === "string" ? sanitized : "[output redacted]"
  }

  // Only inspect `content` when no raw output is present: servers derive
  // `content` from `rawOutput` and may stringify an empty partial result,
  // which must not become visible output text.
  if (update.rawOutput === undefined && Array.isArray(update.content)) {
    const text = update.content
      .map((block) => {
        const record = getRecord(block)

        return record?.type === "content"
          ? contentBlockToDisplayText(record.content)
          : ""
      })
      .filter(Boolean)
      .join("\n")
      .trim()

    if (text) {
      const sanitized = sanitizeAgentStructuredValue(
        text,
        ACP_TOOL_OUTPUT_CHARACTER_LIMIT
      )

      return typeof sanitized === "string" ? sanitized : "[output redacted]"
    }
  }

  return ""
}

function createAcpToolResult(
  update: {
    _meta?: Record<string, unknown> | null
    content?: unknown
    kind?: string | null
    locations?: unknown
    rawInput?: unknown
    rawOutput?: unknown
    status?: string | null
    title?: string | null
    toolCallId: string
  },
  name: string,
  output: string
): Extract<AgentEvent, { type: "tool_result" }> {
  const exitCode = getAcpToolExitCode(update.rawOutput)
  const commandReachedProcessExit =
    name === "execute" && exitCode !== null && exitCode !== 0

  if (update.status === "completed" || commandReachedProcessExit) {
    return {
      type: "tool_result",
      id: update.toolCallId,
      name,
      status: "complete",
      output,
      ...getAcpToolEventFields(update),
    }
  }

  return {
    type: "tool_result",
    id: update.toolCallId,
    name,
    status: "error",
    output,
    error: output || "Tool call failed.",
    ...getAcpToolEventFields(update),
  }
}

function diffContentToString(content: Record<string, unknown>) {
  const path = typeof content.path === "string" ? content.path : "unknown"
  const oldText = typeof content.oldText === "string" ? content.oldText : null
  const newText = typeof content.newText === "string" ? content.newText : ""

  return stringifyPayload({
    type: "diff",
    path,
    oldText,
    newText,
  })
}

function getStructuredDiffFileChanges(
  update: {
    content?: unknown
    status?: string | null
    toolCallId: string
  },
  state: AcpMapperReplayState
): Array<Extract<AgentEvent, { type: "file_change" }>> {
  if (!Array.isArray(update.content)) {
    return []
  }

  const signatures =
    state.toolFileChangeSignatures.get(update.toolCallId) ?? new Set<string>()
  const events = update.content.flatMap((content) => {
    const record = getRecord(content)

    if (
      record?.type !== "diff" ||
      typeof record.path !== "string" ||
      typeof record.newText !== "string"
    ) {
      return []
    }

    const rawPath = record.path.trim()

    if (!rawPath) {
      return []
    }

    const pathFromWorkspace =
      state.workspace && isAbsolute(rawPath)
        ? relative(state.workspace, rawPath)
        : null
    const path =
      pathFromWorkspace !== null &&
      pathFromWorkspace !== "" &&
      !pathFromWorkspace.startsWith("..") &&
      !isAbsolute(pathFromWorkspace)
        ? pathFromWorkspace
        : rawPath
    const metadataKind = getRecord(record._meta)?.kind
    const kind: AgentFileChangeEvent["kind"] =
      metadataKind === "add" || metadataKind === "create"
        ? "create"
        : metadataKind === "delete"
          ? "delete"
          : metadataKind === "update" || metadataKind === "edit"
            ? "edit"
            : record.oldText === null || record.oldText === undefined
              ? "create"
              : "edit"
    const previousContent =
      kind === "create"
        ? null
        : typeof record.oldText === "string"
          ? record.oldText
          : null
    const nextContent = kind === "delete" ? null : record.newText

    if (
      (previousContent?.length ?? 0) > AGENT_STRUCTURED_TEXT_LIMIT ||
      (nextContent?.length ?? 0) > AGENT_STRUCTURED_TEXT_LIMIT
    ) {
      debugAcp("tool_diff_omitted", {
        path,
        reason: "structured diff exceeded the client limit",
        toolCallId: update.toolCallId,
      })
      return []
    }

    if (previousContent === nextContent) {
      return []
    }

    const diff = createUnifiedFileDiff({
      path,
      previousContent,
      nextContent,
    })

    if (!diff) {
      return []
    }

    const signature = createHash("sha256")
      .update(path)
      .update("\0")
      .update(diff)
      .digest("hex")

    if (signatures.has(signature)) {
      return []
    }

    signatures.add(signature)

    const event: AgentFileChangeEvent = {
      type: "file_change" as const,
      path,
      kind,
      status: update.status === "failed" ? "error" : "complete",
      ...(update.status === "failed"
        ? { error: "ACP tool reported that the file edit failed." }
        : {}),
      diff,
    }

    return [event]
  })

  state.toolFileChangeSignatures.set(update.toolCallId, signatures)

  return events
}

function terminalContentToString(content: Record<string, unknown>) {
  const terminalId =
    typeof content.terminalId === "string" ? content.terminalId : ""
  const snapshot = terminalId ? getAcpTerminalSnapshot(terminalId) : null

  if (!terminalId) {
    return "[terminal]"
  }

  return stringifyPayload({
    type: "terminal",
    terminalId,
    ...(snapshot ?? {}),
  })
}

function toolCallContentToString(content: unknown) {
  const record = getRecord(content)

  if (!record) {
    return stringifyPayload(content)
  }

  if (record.type === "content") {
    return contentBlockToDisplayText(record.content)
  }

  if (record.type === "diff") {
    return diffContentToString(record)
  }

  if (record.type === "terminal") {
    return terminalContentToString(record)
  }

  return stringifyPayload(record)
}

function synthesizeToolCallFromUpdate(
  update: {
    _meta?: Record<string, unknown> | null
    content?: unknown
    kind?: string | null
    locations?: unknown
    rawInput?: unknown
    status?: string | null
    title?: string | null
    toolCallId: string
  },
  name: string
): AgentEvent {
  return {
    type: "tool_call",
    id: update.toolCallId,
    name,
    input: toolInputToString(update),
    ...getAcpToolEventFields(update),
  }
}

function normalizePlanStatus(status: unknown) {
  return status === "in_progress" || status === "completed" ? status : "pending"
}

function normalizePlanPriority(priority: unknown): AgentPlanPriority | null {
  return priority === "high" || priority === "medium" || priority === "low"
    ? priority
    : null
}

const ACP_STABLE_PLAN_ID = "acp:stable-plan"

function planEntriesToEvent(
  entries: unknown,
  planId = ACP_STABLE_PLAN_ID,
  meta?: Record<string, unknown> | null
): AgentEvent | null {
  if (!Array.isArray(entries)) {
    return null
  }

  return {
    type: "plan_update",
    planId: truncateAcpControlText(planId, 512),
    variant: "items",
    ...(meta ? { meta: sanitizeAcpRecord(meta) } : {}),
    todos: entries
      .slice(0, ACP_STRUCTURED_COLLECTION_LIMIT)
      .flatMap((entry) => {
        const record = getRecord(entry)
        const text =
          typeof record?.content === "string"
            ? truncateAcpStructuredText(record.content)
            : ""

        if (!text) {
          return []
        }

        const todo: Extract<
          AgentEvent,
          { type: "plan_update" }
        >["todos"][number] = {
          text,
          status: normalizePlanStatus(record?.status),
        }

        const priority = normalizePlanPriority(record?.priority)

        if (priority) {
          todo.priority = priority
        }
        if (getRecord(record?._meta)) {
          todo.meta = sanitizeAcpRecord(
            record?._meta as Record<string, unknown>
          )
        }

        return [todo]
      }),
  }
}

function markdownPlanToEvent(
  content: string,
  planId: string,
  meta?: Record<string, unknown> | null
): AgentEvent {
  const safeContent = truncateAcpStructuredText(content)
  const todos = safeContent
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^\s*(?:[-*]\s+)?\[( |x|X|-)\]\s+(.+)$/)

      if (!match) {
        return []
      }

      return [
        {
          text: match[2].trim(),
          status:
            match[1].toLowerCase() === "x"
              ? ("completed" as const)
              : match[1] === "-"
                ? ("in_progress" as const)
                : ("pending" as const),
        },
      ]
    })
    .slice(0, ACP_STRUCTURED_COLLECTION_LIMIT)

  return {
    type: "plan_update",
    planId: truncateAcpControlText(planId, 512),
    variant: "markdown",
    content: safeContent,
    ...(meta ? { meta: sanitizeAcpRecord(meta) } : {}),
    todos: todos.length
      ? todos
      : [
          {
            text: safeContent.trim() || "Plan updated",
            status: "in_progress",
          },
        ],
  }
}

function planUpdateToEvent(
  update: Extract<SessionUpdate, { sessionUpdate: "plan_update" }>
) {
  if (update.plan.type === "items") {
    return planEntriesToEvent(
      update.plan.entries,
      update.plan.planId,
      update.plan._meta
    )
  }

  if (update.plan.type === "markdown") {
    return markdownPlanToEvent(
      update.plan.content,
      update.plan.planId,
      update.plan._meta
    )
  }

  if (update.plan.type === "file") {
    return {
      type: "plan_update",
      planId: truncateAcpControlText(update.plan.planId, 512),
      variant: "file",
      uri: update.plan.uri.slice(0, 8192),
      todos: [],
      ...(update.plan._meta
        ? { meta: sanitizeAcpRecord(update.plan._meta) }
        : {}),
    } satisfies AgentEvent
  }

  return null
}

function availableCommandsToEvent(
  commands: SessionUpdate & { sessionUpdate: "available_commands_update" },
  runtimeId?: string
): Extract<AgentEvent, { type: "available-commands" }> {
  return {
    type: "available-commands",
    commands: commands.availableCommands
      .slice(0, ACP_STRUCTURED_COLLECTION_LIMIT)
      .flatMap((command) => {
        const name = command.name.trim().replace(/^\/+/, "")

        if (!name) {
          return []
        }

        const descriptor: SlashCommandDescriptor = {
          name: name.slice(0, 256),
          description: truncateAcpStructuredText(command.description),
          source: "runtime",
          ...(runtimeId ? { runtimeId } : {}),
          ...(command._meta ? { meta: sanitizeAcpRecord(command._meta) } : {}),
        }

        const inputHint = command.input?.hint?.trim()

        if (inputHint) {
          descriptor.inputHint = truncateAcpControlText(inputHint, 2048)
        }
        if (command.input?._meta) {
          descriptor.inputMeta = sanitizeAcpRecord(command.input._meta)
        }

        return [descriptor]
      }),
  }
}

function cacheAcpAvailableCommands(
  studioSessionId: string,
  commands: SlashCommandDescriptor[]
) {
  try {
    setStudioSessionAvailableCommands(studioSessionId, commands)
  } catch (error) {
    debugAcp("available_commands_cache_failed", {
      error: errorMessage(error),
      studioSessionId,
    })
  }
}

function astraflowRetryToEvent(
  update: Extract<
    SessionUpdate,
    { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
  >
): AgentEvent | null {
  const meta = getRecord(update._meta)
  const astraflow = getRecord(meta?.astraflow)
  const retry = getRecord(astraflow?.retry)
  const phase = retry?.phase
  const attempt = retry?.attempt

  if (
    !retry ||
    (phase !== "start" && phase !== "end") ||
    typeof attempt !== "number" ||
    typeof update.messageId !== "string"
  ) {
    return null
  }

  return {
    type: "assistant_retry",
    phase,
    messageId: update.messageId,
    channel:
      update.sessionUpdate === "agent_thought_chunk" ? "reasoning" : "text",
    attempt,
    ...(typeof retry.maxAttempts === "number"
      ? { maxAttempts: retry.maxAttempts }
      : {}),
    ...(typeof retry.delayMs === "number" ? { delayMs: retry.delayMs } : {}),
    ...(typeof retry.success === "boolean" ? { success: retry.success } : {}),
    ...(typeof retry.errorMessage === "string"
      ? { errorMessage: retry.errorMessage }
      : {}),
  }
}

function getAstraflowMessageId(
  update: Extract<
    SessionUpdate,
    { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
  >
) {
  return typeof update.messageId === "string" ? update.messageId : undefined
}

function getCodexMessagePhase(
  update: Extract<SessionUpdate, { sessionUpdate: "agent_message_chunk" }>
) {
  const codex = getRecord(update._meta?.codex)

  return isAgentMessagePhase(codex?.phase) ? codex.phase : undefined
}

function mapAcpSessionUpdateCore(
  update: SessionUpdate,
  state: AcpMapperReplayState
): AgentEvent[] {
  if (update.sessionUpdate === "user_message_chunk") {
    return [
      {
        type: "run_meta",
        metadata: {
          acp: {
            userMessageChunk: sanitizeAgentContentBlock(
              update.content as AgentContentBlock
            ),
          },
        },
      },
    ]
  }

  if (update.sessionUpdate === "agent_message_chunk") {
    const retry = astraflowRetryToEvent(update)

    if (retry) {
      return [retry]
    }

    const messageId = getAstraflowMessageId(update)
    const phase = getCodexMessagePhase(update)

    if (update.content.type !== "text") {
      return [
        {
          type: "content_block",
          content: sanitizeAgentContentBlock(
            update.content as AgentContentBlock
          ),
          channel: "message",
          ...(messageId ? { messageId } : {}),
          ...(phase ? { phase } : {}),
        },
      ]
    }

    const delta = truncateAcpStructuredText(update.content.text)

    return delta
      ? [
          {
            type: "text_delta",
            delta,
            ...(messageId ? { messageId } : {}),
            ...(phase ? { phase } : {}),
          },
        ]
      : []
  }

  if (update.sessionUpdate === "agent_thought_chunk") {
    const retry = astraflowRetryToEvent(update)

    if (retry) {
      return [retry]
    }

    const messageId = getAstraflowMessageId(update)

    if (update.content.type !== "text") {
      return [
        {
          type: "content_block",
          content: sanitizeAgentContentBlock(
            update.content as AgentContentBlock
          ),
          channel: "thought",
          ...(messageId ? { messageId } : {}),
        },
      ]
    }

    const delta = truncateAcpStructuredText(update.content.text)

    return delta
      ? [
          {
            type: "reasoning_delta",
            delta,
            ...(messageId ? { messageId } : {}),
          },
        ]
      : []
  }

  if (update.sessionUpdate === "tool_call") {
    const name = getToolName(update, state)
    const fileChanges = getStructuredDiffFileChanges(update, state)
    const subagentEvents = mapAcpSubagentToolUpdate(update, name, state)
    const call = {
      type: "tool_call",
      id: update.toolCallId,
      name,
      input: toolInputToString(update),
      ...getAcpToolEventFields(update),
    } satisfies AgentEvent

    state.toolCallIds.add(update.toolCallId)

    if (update.status === "completed" || update.status === "failed") {
      const output = toolOutputToString(update)

      state.toolOutputs.delete(update.toolCallId)

      return [
        call,
        ...subagentEvents,
        ...fileChanges,
        createAcpToolResult(update, name, output),
      ]
    }

    linkAcpTerminalsToToolCall(update, name)

    return [call, ...subagentEvents, ...fileChanges]
  }

  if (update.sessionUpdate === "tool_call_update") {
    const name = getToolName(update, state)
    const fileChanges = getStructuredDiffFileChanges(update, state)
    const subagentEvents = mapAcpSubagentToolUpdate(update, name, state)
    const hasToolCall = state.toolCallIds.has(update.toolCallId)
    const toolPatch = getAcpToolEventFields(update)
    const toolPatchEvents = Object.keys(toolPatch).length
      ? ([
          {
            type: "tool_update",
            id: update.toolCallId,
            name,
            ...toolPatch,
          } satisfies AgentEvent,
        ] as AgentEvent[])
      : []
    const terminalOutputUpdate = getAcpTerminalOutputUpdate(update._meta)
    let streamedOutput = terminalOutputUpdate
      ? updateAcpToolOutput(state, update.toolCallId, terminalOutputUpdate)
      : null

    if (update.status === "completed" || update.status === "failed") {
      unlinkAcpToolCallTerminals(update.toolCallId)

      const output =
        toolOutputToString(update) ||
        streamedOutput ||
        state.toolOutputs.get(update.toolCallId) ||
        ""
      const result = createAcpToolResult(update, name, output)

      state.toolOutputs.delete(update.toolCallId)

      if (hasToolCall) {
        return [
          ...toolPatchEvents,
          ...subagentEvents,
          ...fileChanges,
          result,
        ]
      }

      state.toolCallIds.add(update.toolCallId)

      return [
        synthesizeToolCallFromUpdate(update, name),
        ...subagentEvents,
        ...fileChanges,
        result,
      ]
    }

    // A still-running update may attach the terminal that carries the
    // command's live output; link it so stdout chunks stream to the UI.
    linkAcpTerminalsToToolCall(update, name)

    // A still-generating tool call streams its argument JSON via
    // meta.astraflow.toolInput; surface it as an incremental input snapshot.
    const toolInputSnapshot = getAcpToolInputSnapshot(update._meta)
    const inputEvent =
      toolInputSnapshot !== null
        ? ({
            type: "tool_input",
            id: update.toolCallId,
            name,
            input: toolInputSnapshot,
          } satisfies AgentEvent)
        : null
    const inputEvents = inputEvent ? [inputEvent] : []

    // Tools without a terminal can still report progress: the Pi forwarder
    // sends each tool's partial result as a running tool_call_update. Turn
    // it into a streaming output snapshot so the UI shows live tool output
    // instead of waiting for the final result.
    if (streamedOutput === null) {
      const partialOutput = getAcpToolPartialOutputText(update)

      if (
        partialOutput &&
        partialOutput !== state.toolOutputs.get(update.toolCallId)
      ) {
        streamedOutput = updateAcpToolOutput(state, update.toolCallId, {
          data: partialOutput,
          mode: "replace",
        })
      }
    }

    if (streamedOutput !== null) {
      const outputEvent = {
        type: "tool_output",
        id: update.toolCallId,
        name,
        output: streamedOutput,
      } satisfies AgentEvent

      if (hasToolCall) {
        return [
          ...toolPatchEvents,
          ...subagentEvents,
          ...inputEvents,
          ...fileChanges,
          outputEvent,
        ]
      }

      state.toolCallIds.add(update.toolCallId)

      return [
        synthesizeToolCallFromUpdate(update, name),
        ...subagentEvents,
        ...inputEvents,
        ...fileChanges,
        outputEvent,
      ]
    }

    if (inputEvent) {
      if (hasToolCall) {
        return [
          ...toolPatchEvents,
          ...subagentEvents,
          ...fileChanges,
          inputEvent,
        ]
      }

      state.toolCallIds.add(update.toolCallId)

      return [
        synthesizeToolCallFromUpdate(update, name),
        ...subagentEvents,
        ...fileChanges,
        inputEvent,
      ]
    }

    if (!hasToolCall && (update.rawInput !== undefined || update.status)) {
      state.toolCallIds.add(update.toolCallId)

      return [
        synthesizeToolCallFromUpdate(update, name),
        ...subagentEvents,
        ...fileChanges,
      ]
    }

    if (hasToolCall && toolPatchEvents.length) {
      return [...toolPatchEvents, ...subagentEvents, ...fileChanges]
    }

    if (subagentEvents.length) {
      return [...subagentEvents, ...fileChanges]
    }

    debugAcp("tool_call_update_ignored", {
      hasContent: Array.isArray(update.content)
        ? update.content.length > 0
        : Boolean(update.content),
      hasRawInput: update.rawInput !== undefined,
      hasRawOutput: update.rawOutput !== undefined,
      status: update.status ?? null,
      toolCallId: update.toolCallId,
    })

    return fileChanges
  }

  if (update.sessionUpdate === "usage_update") {
    const rateLimitInfo = getClaudeRateLimitInfo(update)

    if (rateLimitInfo !== undefined) {
      state.rateLimitInfo = rateLimitInfo
    }

    return [{ type: "run_meta", usage: update }]
  }

  if (update.sessionUpdate === "plan") {
    const event = planEntriesToEvent(
      update.entries,
      ACP_STABLE_PLAN_ID,
      update._meta
    )

    return event ? [event] : []
  }

  if (update.sessionUpdate === "plan_update") {
    const event = planUpdateToEvent(update)

    return event ? [event] : []
  }

  if (update.sessionUpdate === "plan_removed") {
    return [
      {
        type: "plan_remove",
        planId: truncateAcpControlText(update.planId, 512),
      },
    ]
  }

  if (update.sessionUpdate === "available_commands_update") {
    return [availableCommandsToEvent(update, state.runtimeId)]
  }

  if (update.sessionUpdate === "current_mode_update") {
    const currentModeId = truncateAcpControlText(update.currentModeId, 512)

    state.currentModeId = currentModeId

    return [
      {
        type: "run_meta",
        metadata: {
          acp: {
            currentModeId,
          },
        },
      },
    ]
  }

  if (update.sessionUpdate === "config_option_update") {
    const configOptions = sanitizeAcpConfigOptions(update.configOptions)

    state.configOptions = configOptions

    return [
      {
        type: "run_meta",
        metadata: {
          acp: {
            configOptions,
          },
        },
      },
    ]
  }

  if (update.sessionUpdate === "session_info_update") {
    const sessionInfo = mergeAcpSessionInfoUpdate(
      state.sessionInfo ?? null,
      update
    )

    state.sessionInfo = sessionInfo

    return [
      {
        type: "run_meta",
        metadata: {
          acp: {
            sessionInfo,
          },
        },
        ...(sessionInfo.title !== undefined
          ? { sessionTitle: sessionInfo.title }
          : {}),
      },
    ]
  }

  debugAcp("unknown_session_update_ignored", {
    keys: Object.keys(update).sort(),
    sessionUpdate: (update as { sessionUpdate?: unknown }).sessionUpdate,
  })

  return []
}

function mapAcpSessionUpdate(
  update: SessionUpdate,
  state: AcpMapperReplayState
): AgentEvent[] {
  const events = mapAcpSessionUpdateCore(update, state)
  const meta = update._meta ? sanitizeAcpRecord(update._meta) : null

  if (!meta) {
    return events
  }

  return [
    {
      type: "run_meta",
      metadata: {
        acp: {
          sessionUpdateExtension: {
            sessionUpdate: update.sessionUpdate,
            _meta: meta,
          },
        },
      },
    },
    ...events,
  ]
}

export function createAcpMapperReplayState(): AcpMapperReplayState {
  return {
    configOptions: [],
    currentModeId: null,
    rateLimitInfo: null,
    subagentTasksByAgentId: new Map(),
    subagentTasksByProviderThreadId: new Map(),
    subagentTasksByToolCall: new Map(),
    toolCallIds: new Set(),
    toolFileChangeSignatures: new Map(),
    toolNames: new Map(),
    toolOutputs: new Map(),
  }
}

export function mapAcpSessionUpdatesForReplay(
  updates: readonly SessionUpdate[],
  state: AcpMapperReplayState = createAcpMapperReplayState()
): AgentEvent[] {
  return updates.flatMap((update) => mapAcpSessionUpdate(update, state))
}

function disposeAcpSession(
  key: string,
  state: AcpSessionState,
  reason: string,
  protocolClose = true
) {
  const isCurrentSession = acpSessions.get(key) === state

  if (isCurrentSession) {
    acpSessions.delete(key)
  }

  if (state.disposed) {
    terminateAcpChild(state)
    return
  }

  state.disposed = true
  cancelSessionPermissions(state.studioSessionId)
  cancelSessionUserInputs(state.studioSessionId)
  releaseAcpSessionTerminals(state.studioSessionId)
  void state.mcpBridge?.closeAll()

  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }
  if (state.controlCancelTimer) {
    clearTimeout(state.controlCancelTimer)
    state.controlCancelTimer = null
  }

  debugAcp("session_dispose", {
    key,
    reason,
    acpSessionId: state.acpSessionId,
    stale: !isCurrentSession,
  })

  state.activeSession.dispose()
  const finishTransportCleanup = () => {
    state.connection.close(new Error(reason))
    terminateAcpChild(state)
  }

  if (
    protocolClose &&
    state.initializeResponse.agentCapabilities?.sessionCapabilities?.close
  ) {
    void withTimeout(
      state.connection.agent.request(methods.agent.session.close, {
        sessionId: state.acpSessionId,
      }),
      ACP_TERMINATE_KILL_TIMEOUT_MS,
      "ACP session/close"
    )
      .catch((error) => {
        debugAcp("session_close_failed", {
          error: errorMessage(error),
          sessionId: state.acpSessionId,
        })
      })
      .finally(finishTransportCleanup)
    return
  }

  finishTransportCleanup()
}

function disposeAcpPreparedSession(
  key: string,
  state: AcpPreparedState,
  reason: string
) {
  if (acpPreparedSessions.get(key) === state) {
    acpPreparedSessions.delete(key)
  }
  if (state.disposed) {
    if (state.child) {
      terminateChild(state.child)
    }
    return
  }

  state.disposed = true
  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }
  state.failSessionStart(new Error(reason))
  void state.mcpBridge?.closeAll()
  state.connection.close(new Error(reason))
  if (state.child) {
    terminateChild(state.child)
  }

  debugAcp("prepared_session_dispose", { key, reason })
}

function scheduleAcpPreparedIdleCleanup(state: AcpPreparedState) {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
  }
  state.idleTimer = setTimeout(() => {
    disposeAcpPreparedSession(
      state.key,
      state,
      "ACP prepared connection idle timeout"
    )
  }, ACP_IDLE_TIMEOUT_MS)
  state.idleTimer.unref()
}

function terminateAcpChild(
  state: AcpSessionState,
  timeoutMs = ACP_TERMINATE_KILL_TIMEOUT_MS
) {
  if (!state.child) {
    return
  }

  terminateChild(state.child, timeoutMs)
}

export function terminateChild(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = ACP_TERMINATE_KILL_TIMEOUT_MS
) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.kill("SIGTERM")

  if (timeoutMs <= 0) {
    return
  }

  const killTimer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
    }
  }, timeoutMs)

  killTimer.unref()
}

function scheduleAcpSessionIdleCleanup(state: AcpSessionState) {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer)
  }

  state.idleTimer = setTimeout(() => {
    disposeAcpSession(state.key, state, "ACP session idle timeout")
  }, ACP_IDLE_TIMEOUT_MS)
  state.idleTimer.unref()
}

function clearAcpSessionIdleCleanup(state: AcpSessionState) {
  if (!state.idleTimer) {
    return
  }

  clearTimeout(state.idleTimer)
  state.idleTimer = null
}

function disposeAllAcpSessions(reason: string) {
  for (const [key, state] of [...acpPreparedSessions]) {
    disposeAcpPreparedSession(key, state, reason)
  }
  for (const [key, state] of [...acpSessions]) {
    disposeAcpSession(key, state, reason)
  }

  for (const child of [...acpChildren]) {
    terminateChild(child)
  }
}

export function resetAcpSessionsForStudioSession(sessionId: string) {
  invalidateAcpPreparationRegistryEntries({
    coordinators: acpPreparationCoordinators,
    disposeStartup: (key, state, reason) =>
      disposeAcpSession(key, state, reason),
    isStale: (key) => key.split(ACP_SESSION_KEY_SEPARATOR)[1] === sessionId,
    reason: "Studio workspace history restored",
    startups: acpSessionStartups,
  })
  for (const [key, state] of [...acpPreparedSessions]) {
    if (state.studioSessionId === sessionId) {
      disposeAcpPreparedSession(key, state, "Studio workspace history restored")
    }
  }
  for (const [key, state] of [...acpSessions]) {
    if (state.studioSessionId === sessionId) {
      disposeAcpSession(key, state, "Studio workspace history restored")
    }
  }
}

export function resetAcpSessionsForStudioSessionRuntime(
  sessionId: string,
  runtimeId: string
) {
  const matchesRuntimeSession = (key: string) =>
    isAcpRuntimeSessionKey(key, runtimeId, sessionId)

  invalidateAcpPreparationRegistryEntries({
    coordinators: acpPreparationCoordinators,
    disposeStartup: (key, state, reason) =>
      disposeAcpSession(key, state, reason),
    isStale: matchesRuntimeSession,
    reason: "Studio runtime changed",
    startups: acpSessionStartups,
  })
  for (const [key, state] of [...acpPreparedSessions]) {
    if (
      state.studioSessionId === sessionId &&
      state.runtimeId === runtimeId
    ) {
      disposeAcpPreparedSession(key, state, "Studio runtime changed")
    }
  }
  for (const [key, state] of [...acpSessions]) {
    if (
      state.studioSessionId === sessionId &&
      state.runtimeId === runtimeId
    ) {
      disposeAcpSession(key, state, "Studio runtime changed")
    }
  }
}

function invalidateConflictingAcpContexts({
  keepKey,
  reason,
  runtimeId,
  studioSessionId,
}: {
  keepKey: string
  reason: string
  runtimeId: string
  studioSessionId: string
}) {
  const conflicts = (candidateKey: string) =>
    candidateKey !== keepKey &&
    isAcpRuntimeSessionKey(candidateKey, runtimeId, studioSessionId)

  invalidateAcpPreparationRegistryEntries({
    coordinators: acpPreparationCoordinators,
    disposeStartup: (key, state, staleReason) =>
      disposeAcpSession(key, state, staleReason),
    isStale: conflicts,
    reason,
    startups: acpSessionStartups,
  })

  for (const [candidateKey, prepared] of acpPreparedSessions) {
    if (conflicts(candidateKey)) {
      disposeAcpPreparedSession(candidateKey, prepared, reason)
    }
  }

  for (const [candidateKey, active] of acpSessions) {
    if (conflicts(candidateKey)) {
      disposeAcpSession(candidateKey, active, reason)
    }
  }
}

export type AcpSessionControlAction =
  | { action: "authenticate"; methodId: string; meta?: Record<string, unknown> }
  | { action: "cancel" }
  | { action: "close"; meta?: Record<string, unknown> }
  | {
      action: "delete_session"
      sessionId: string
      meta?: Record<string, unknown>
    }
  | { action: "list_providers"; meta?: Record<string, unknown> }
  | {
      action: "list_sessions"
      cursor?: string | null
      cwd?: string | null
      meta?: Record<string, unknown>
    }
  | { action: "logout"; meta?: Record<string, unknown> }
  | {
      action: "set_config_option"
      configId: string
      value: string | boolean
      meta?: Record<string, unknown>
    }
  | { action: "set_mode"; modeId: string; meta?: Record<string, unknown> }
  | {
      action: "set_provider"
      apiType: string
      baseUrl: string
      headers?: Record<string, string>
      meta?: Record<string, unknown>
      providerId: string
    }
  | {
      action: "disable_provider"
      meta?: Record<string, unknown>
      providerId: string
    }

function getAcpSessionForControl(studioSessionId: string, runtimeId: string) {
  const states = [...acpSessions.values()].filter(
    (state) =>
      !state.disposed &&
      state.studioSessionId === studioSessionId &&
      state.runtimeId === runtimeId
  )

  return states.at(-1) ?? null
}

function getAcpPreparedSessionForControl(
  studioSessionId: string,
  runtimeId: string
) {
  const states = [...acpPreparedSessions.values()].filter(
    (state) =>
      !state.disposed &&
      state.studioSessionId === studioSessionId &&
      state.runtimeId === runtimeId
  )

  return states.at(-1) ?? null
}

export function getAcpSessionControlSnapshot(
  studioSessionId: string,
  runtimeId: string
) {
  const state = getAcpSessionForControl(studioSessionId, runtimeId)

  if (!state) {
    const prepared = getAcpPreparedSessionForControl(studioSessionId, runtimeId)

    if (!prepared) {
      return null
    }

    const sessionCapabilities =
      prepared.initializeResponse.agentCapabilities?.sessionCapabilities

    return {
      connected: true,
      phase: "initialized" as const,
      studioSessionId,
      runtimeId,
      sessionId: null,
      workspace: prepared.workspace,
      protocolVersion: prepared.initializeResponse.protocolVersion,
      agentInfo: prepared.initializeResponse.agentInfo ?? null,
      agentCapabilities: prepared.initializeResponse.agentCapabilities ?? {},
      authMethods: prepared.initializeResponse.authMethods ?? [],
      authentication: {
        logout: Boolean(
          prepared.initializeResponse.agentCapabilities?.auth?.logout
        ),
      },
      session: {
        canClose: false,
        canDelete: Boolean(sessionCapabilities?.delete),
        canList: Boolean(sessionCapabilities?.list),
        canResume: Boolean(
          sessionCapabilities?.resume ||
            prepared.initializeResponse.agentCapabilities?.loadSession
        ),
        modes: null,
        configOptions: [],
        loadReplayUpdateCount: 0,
        availableCommands: [],
        info: null,
        rateLimitInfo: null,
      },
      providers: {
        configurable: Boolean(
          prepared.initializeResponse.agentCapabilities?.providers
        ),
      },
    }
  }

  const sessionCapabilities =
    state.initializeResponse.agentCapabilities?.sessionCapabilities

  return {
    connected: true,
    phase: "session" as const,
    studioSessionId,
    runtimeId,
    sessionId: state.acpSessionId,
    workspace: state.workspace,
    protocolVersion: state.initializeResponse.protocolVersion,
    agentInfo: state.initializeResponse.agentInfo ?? null,
    agentCapabilities: state.initializeResponse.agentCapabilities ?? {},
    authMethods: state.initializeResponse.authMethods ?? [],
    authentication: {
      logout: Boolean(state.initializeResponse.agentCapabilities?.auth?.logout),
    },
    session: {
      canClose: Boolean(sessionCapabilities?.close),
      canDelete: Boolean(sessionCapabilities?.delete),
      canList: Boolean(sessionCapabilities?.list),
      canResume: Boolean(
        sessionCapabilities?.resume ||
          state.initializeResponse.agentCapabilities?.loadSession
      ),
      modes: sanitizeAcpSessionModes(
        state.activeSession.modes,
        state.currentModeId
      ),
      configOptions: state.configOptions,
      loadReplayUpdateCount: state.loadReplayUpdateCount,
      availableCommands: state.availableCommands,
      info: state.sessionInfo,
      rateLimitInfo: state.rateLimitInfo,
    },
    providers: {
      configurable: Boolean(
        state.initializeResponse.agentCapabilities?.providers
      ),
    },
  }
}

export async function activatePreparedAcpSession(
  studioSessionId: string,
  runtimeId: string
) {
  const active = getAcpSessionForControl(studioSessionId, runtimeId)

  if (active) {
    scheduleAcpSessionIdleCleanup(active)
    return getAcpSessionControlSnapshot(studioSessionId, runtimeId)
  }

  const prepared = getAcpPreparedSessionForControl(
    studioSessionId,
    runtimeId
  )

  if (!prepared) {
    throw new Error(
      "No prepared ACP connection exists for this Studio session and runtime."
    )
  }

  const startup = acpSessionStartups.get(prepared.key)

  await prepared.requestSessionStart()
  await startup

  const started = getAcpSessionForControl(studioSessionId, runtimeId)

  if (!started) {
    throw new Error("The ACP session did not become active.")
  }

  scheduleAcpSessionIdleCleanup(started)
  return getAcpSessionControlSnapshot(studioSessionId, runtimeId)
}

function enqueueAcpPreparedOperation<T>(
  state: AcpPreparedState,
  operation: () => Promise<T>
) {
  const result = state.operationTail.then(async () => {
    if (state.disposed) {
      throw new Error("The ACP prepared connection is no longer available.")
    }
    if (state.sessionStartRequested) {
      throw new Error("The ACP session has already started.")
    }

    return operation()
  })

  state.operationTail = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

async function runAcpPreparedControlAction(
  state: AcpPreparedState,
  action: AcpSessionControlAction
) {
  const agent = state.connection.agent
  const sessionCapabilities =
    state.initializeResponse.agentCapabilities?.sessionCapabilities
  const meta = "meta" in action ? action.meta : undefined

  if (action.action === "cancel") {
    return { cancelled: false }
  }
  if (
    action.action === "close" ||
    action.action === "set_mode" ||
    action.action === "set_config_option"
  ) {
    throw new Error("This ACP control requires an active session.")
  }
  if (action.action === "list_sessions") {
    assertAcpControlCapability(sessionCapabilities?.list, "session.list")
    return enqueueAcpPreparedOperation(state, () =>
      agent.request(methods.agent.session.list, {
        ...(action.cwd !== undefined ? { cwd: action.cwd } : {}),
        ...(action.cursor !== undefined ? { cursor: action.cursor } : {}),
        ...(meta ? { _meta: meta } : {}),
      })
    )
  }
  if (action.action === "delete_session") {
    assertAcpControlCapability(sessionCapabilities?.delete, "session.delete")
    return enqueueAcpPreparedOperation(state, () =>
      agent.request(methods.agent.session.delete, {
        sessionId: action.sessionId,
        ...(meta ? { _meta: meta } : {}),
      })
    )
  }
  if (action.action === "authenticate") {
    const method = state.initializeResponse.authMethods?.find(
      (candidate: AuthMethod) => candidate.id === action.methodId
    )
    if (!method) {
      throw new Error(`Unknown ACP authentication method: ${action.methodId}`)
    }
    if (("type" in method ? method.type : "agent") !== "agent") {
      throw new Error(
        `ACP authentication method ${action.methodId} requires unsupported client-side setup.`
      )
    }
    return enqueueAcpPreparedOperation(state, () =>
      agent.request(methods.agent.authenticate, {
        methodId: action.methodId,
        ...(meta ? { _meta: meta } : {}),
      })
    )
  }
  if (action.action === "logout") {
    return performAcpLogout({
      supported: state.initializeResponse.agentCapabilities?.auth?.logout,
      request: () =>
        enqueueAcpPreparedOperation(state, () =>
          agent.request(methods.agent.logout, {
            ...(meta ? { _meta: meta } : {}),
          })
        ),
      clearCookies: async () => {
        if (state.cookieStoreKey) {
          await acpTransportCookieStores.get(state.cookieStoreKey)?.clear()
          acpTransportCookieStores.delete(state.cookieStoreKey)
        }
      },
      dispose: () =>
        disposeAcpPreparedSession(state.key, state, "ACP logout completed"),
    })
  }

  assertAcpControlCapability(
    state.initializeResponse.agentCapabilities?.providers,
    "configurable providers"
  )
  if (action.action === "list_providers") {
    return enqueueAcpPreparedOperation(state, () =>
      agent.request(methods.agent.providers.list, {
        ...(meta ? { _meta: meta } : {}),
      })
    )
  }
  if (action.action === "set_provider") {
    return enqueueAcpPreparedOperation(state, () =>
      agent.request(methods.agent.providers.set, {
        providerId: action.providerId,
        apiType: action.apiType,
        baseUrl: action.baseUrl,
        ...(action.headers ? { headers: action.headers } : {}),
        ...(meta ? { _meta: meta } : {}),
      })
    )
  }

  return enqueueAcpPreparedOperation(state, async () => {
    const providers = await agent.request(methods.agent.providers.list, {
      ...(meta ? { _meta: meta } : {}),
    })
    const provider = providers.providers.find(
      (candidate: ProviderInfo) => candidate.providerId === action.providerId
    )
    if (provider?.required) {
      throw new Error(
        `Required ACP provider ${action.providerId} cannot be disabled.`
      )
    }
    return agent.request(methods.agent.providers.disable, {
      providerId: action.providerId,
      ...(meta ? { _meta: meta } : {}),
    })
  })
}

function assertAcpControlCapability<T>(
  supported: T,
  capability: string
): asserts supported is NonNullable<T> {
  if (!supported) {
    throw new Error(`The ACP agent does not advertise ${capability}.`)
  }
}

export async function performAcpLogout<T>({
  clearCookies,
  dispose,
  request,
  supported,
}: {
  clearCookies: () => Promise<void>
  dispose: () => void
  request: () => Promise<T>
  supported: unknown
}) {
  assertAcpControlCapability(supported, "logout")
  const response = await request()

  await clearCookies()
  dispose()
  return response
}

async function clearAcpTransportCookies(state: AcpSessionState) {
  if (!state.cookieStoreKey) {
    return
  }

  const store = acpTransportCookieStores.get(state.cookieStoreKey)

  await store?.clear()
  acpTransportCookieStores.delete(state.cookieStoreKey)
}

async function replaceAcpSessionAfterProviderChange(state: AcpSessionState) {
  if (state.runSignal || state.queue) {
    throw new Error(
      "ACP provider configuration cannot change during an active prompt."
    )
  }

  const previousSession = state.activeSession
  const previousSessionId = state.acpSessionId
  const replacementNotifications: SessionNotification[] = []
  let replacement: Awaited<ReturnType<typeof startAcpSessionWithAuthentication>>

  state.replacementNotifications = replacementNotifications

  try {
    replacement = await startAcpSessionWithAuthentication({
      additionalDirectories: state.additionalDirectories,
      connection: state.connection,
      initializeResponse: state.initializeResponse,
      mcpServers: state.mcpServers,
      sessionMeta: state.sessionMeta,
      storedSessionRef: null,
      workspace: state.workspace,
    })
  } finally {
    state.replacementNotifications = null
  }

  if (state.initializeResponse.agentCapabilities?.sessionCapabilities?.close) {
    try {
      await state.connection.agent.request(methods.agent.session.close, {
        sessionId: previousSessionId,
      })
    } catch (error) {
      debugAcp("replaced_session_close_failed", {
        error: errorMessage(error),
        sessionId: previousSessionId,
      })
    }
  }

  previousSession.dispose()
  state.acpSessionId = replacement.activeSession.sessionId
  state.activeSession = replacement.activeSession
  state.availableCommands = []
  state.configOptions = sanitizeAcpConfigOptions(
    replacement.activeSession.newSessionResponse.configOptions
  )
  state.currentModeId = replacement.activeSession.modes?.currentModeId
    ? truncateAcpControlText(replacement.activeSession.modes.currentModeId, 512)
    : null
  state.loadReplayUpdateCount = 0
  state.loadReplayUpdates = []
  state.pendingStartupEvents = []
  state.rateLimitInfo = null
  state.restoredFromProvider = false
  state.sessionInfo = null
  state.shouldIncludeRecapOnNextRun = true
  resetAcpRunState(state)
  const setupUpdates = replacementNotifications
    .filter((notification) => notification.sessionId === state.acpSessionId)
    .map((notification) => notification.update)
  const setupEvents = mapAcpSessionUpdatesForReplay(setupUpdates, state)
  const announcedCommands = [...setupEvents]
    .reverse()
    .find((event) => event.type === "available-commands")
  const sessionInfo = [...setupUpdates]
    .reverse()
    .find((update) => update.sessionUpdate === "session_info_update")

  if (announcedCommands?.type === "available-commands") {
    state.availableCommands = announcedCommands.commands
  }
  if (sessionInfo?.sessionUpdate === "session_info_update") {
    state.sessionInfo = mergeAcpSessionInfoUpdate(
      state.sessionInfo,
      sessionInfo
    )
  }
  state.pendingStartupEvents.push(...setupEvents)
  if (replacement.activeSession.meta) {
    state.pendingStartupEvents.push({
      type: "run_meta",
      metadata: {
        acp: {
          sessionResponseMeta: sanitizeAcpRecord(
            replacement.activeSession.meta
          ),
        },
      },
    })
  }
  cacheAcpAvailableCommands(state.studioSessionId, state.availableCommands)

  return {
    previousSessionId,
    sessionId: state.acpSessionId,
  }
}

export async function runAcpSessionControlAction({
  action,
  runtimeId,
  studioSessionId,
}: {
  action: AcpSessionControlAction
  runtimeId: string
  studioSessionId: string
}) {
  const state = getAcpSessionForControl(studioSessionId, runtimeId)

  if (!state) {
    const prepared = getAcpPreparedSessionForControl(studioSessionId, runtimeId)

    if (prepared) {
      scheduleAcpPreparedIdleCleanup(prepared)
      return runAcpPreparedControlAction(prepared, action)
    }

    throw new Error(
      "No active ACP connection exists for this Studio session and runtime."
    )
  }

  clearAcpSessionIdleCleanup(state)
  scheduleAcpSessionIdleCleanup(state)

  const agent = state.connection.agent
  const sessionCapabilities =
    state.initializeResponse.agentCapabilities?.sessionCapabilities
  const meta = "meta" in action ? action.meta : undefined

  if (action.action === "cancel") {
    cancelSessionPermissions(state.studioSessionId)
    cancelSessionUserInputs(state.studioSessionId)
    releaseAcpSessionTerminals(state.studioSessionId)
    try {
      await notifyAcpCancel(state)
    } finally {
      if ((state.runSignal || state.queue) && !state.controlCancelTimer) {
        state.controlCancelTimer = scheduleAbortKill(state)
      }
    }
    return { cancelled: true }
  }

  if (action.action === "close") {
    assertAcpControlCapability(sessionCapabilities?.close, "session.close")
    await agent.request(methods.agent.session.close, {
      sessionId: state.acpSessionId,
      ...(meta ? { _meta: meta } : {}),
    })
    disposeAcpSession(state.key, state, "ACP session closed by user", false)
    return { closed: true }
  }

  if (action.action === "list_sessions") {
    assertAcpControlCapability(sessionCapabilities?.list, "session.list")
    return agent.request(methods.agent.session.list, {
      ...(action.cwd !== undefined ? { cwd: action.cwd } : {}),
      ...(action.cursor !== undefined ? { cursor: action.cursor } : {}),
      ...(meta ? { _meta: meta } : {}),
    })
  }

  if (action.action === "delete_session") {
    assertAcpControlCapability(sessionCapabilities?.delete, "session.delete")
    const response = await agent.request(methods.agent.session.delete, {
      sessionId: action.sessionId,
      ...(meta ? { _meta: meta } : {}),
    })

    if (action.sessionId === state.acpSessionId) {
      disposeAcpSession(state.key, state, "ACP session deleted by user", false)
    }

    return response
  }

  if (action.action === "set_mode") {
    const modes = state.activeSession.modes

    assertAcpControlCapability(modes, "session modes")
    if (
      !modes.availableModes.some(
        (mode: SessionMode) => mode.id === action.modeId
      )
    ) {
      throw new Error(`Unknown ACP session mode: ${action.modeId}`)
    }

    const response = await agent.request(methods.agent.session.setMode, {
      sessionId: state.acpSessionId,
      modeId: action.modeId,
      ...(meta ? { _meta: meta } : {}),
    })
    state.currentModeId = action.modeId
    return response
  }

  if (action.action === "set_config_option") {
    const option = state.configOptions.find(
      (candidate: SessionConfigOption) => candidate.id === action.configId
    )

    if (!option) {
      throw new Error(`Unknown ACP session config option: ${action.configId}`)
    }
    if (option.type === "boolean" && typeof action.value !== "boolean") {
      throw new Error(
        `ACP config option ${action.configId} requires a boolean.`
      )
    }
    if (option.type === "select" && typeof action.value !== "string") {
      throw new Error(
        `ACP config option ${action.configId} requires a value ID.`
      )
    }

    const response = await agent.request(
      methods.agent.session.setConfigOption,
      option.type === "boolean"
        ? {
            type: "boolean",
            sessionId: state.acpSessionId,
            configId: action.configId,
            value: action.value as boolean,
            ...(meta ? { _meta: meta } : {}),
          }
        : {
            sessionId: state.acpSessionId,
            configId: action.configId,
            value: action.value as string,
            ...(meta ? { _meta: meta } : {}),
          }
    )
    state.configOptions = sanitizeAcpConfigOptions(response.configOptions)
    return response
  }

  if (action.action === "authenticate") {
    const method = state.initializeResponse.authMethods?.find(
      (candidate: AuthMethod) => candidate.id === action.methodId
    )

    if (!method) {
      throw new Error(`Unknown ACP authentication method: ${action.methodId}`)
    }
    if (("type" in method ? method.type : "agent") !== "agent") {
      throw new Error(
        `ACP authentication method ${action.methodId} requires unsupported client-side setup.`
      )
    }

    return agent.request(methods.agent.authenticate, {
      methodId: action.methodId,
      ...(meta ? { _meta: meta } : {}),
    })
  }

  if (action.action === "logout") {
    return performAcpLogout({
      supported: state.initializeResponse.agentCapabilities?.auth?.logout,
      request: () =>
        agent.request(methods.agent.logout, {
          ...(meta ? { _meta: meta } : {}),
        }),
      clearCookies: () => clearAcpTransportCookies(state),
      dispose: () =>
        disposeAcpSession(
          state.key,
          state,
          "ACP logout completed",
          false
        ),
    })
  }

  assertAcpControlCapability(
    state.initializeResponse.agentCapabilities?.providers,
    "configurable providers"
  )

  if (action.action === "list_providers") {
    return agent.request(methods.agent.providers.list, {
      ...(meta ? { _meta: meta } : {}),
    })
  }

  if (action.action === "set_provider") {
    const response = await agent.request(methods.agent.providers.set, {
      providerId: action.providerId,
      apiType: action.apiType,
      baseUrl: action.baseUrl,
      ...(action.headers ? { headers: action.headers } : {}),
      ...(meta ? { _meta: meta } : {}),
    })
    const replacement = await replaceAcpSessionAfterProviderChange(state)

    return { ...response, ...replacement }
  }

  const providers = await agent.request(methods.agent.providers.list, {
    ...(meta ? { _meta: meta } : {}),
  })
  const provider = providers.providers.find(
    (candidate: ProviderInfo) => candidate.providerId === action.providerId
  )

  if (provider?.required) {
    throw new Error(
      `Required ACP provider ${action.providerId} cannot be disabled.`
    )
  }

  const response = await agent.request(methods.agent.providers.disable, {
    providerId: action.providerId,
    ...(meta ? { _meta: meta } : {}),
  })
  const replacement = await replaceAcpSessionAfterProviderChange(state)

  return { ...response, ...replacement }
}

function exitCodeForSignal(signal: NodeJS.Signals) {
  return signal === "SIGINT" ? 130 : 143
}

function installAcpProcessCleanupHooks() {
  if (acpGlobalState.cleanupHooksInstalled) {
    return
  }

  acpGlobalState.cleanupHooksInstalled = true

  process.once("exit", () => {
    disposeAllAcpSessions("process exit")
  })

  const shutdown = (signal: NodeJS.Signals) => {
    disposeAllAcpSessions(`process ${signal}`)
    process.exit(exitCodeForSignal(signal))
  }

  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}

installAcpProcessCleanupHooks()

function attachAcpSession(
  connection: ClientConnection,
  response: NewSessionResponse
) {
  const agent = connection.agent as unknown as {
    attachSession?: (response: NewSessionResponse) => ActiveSession
  }

  if (!agent.attachSession) {
    throw new Error("ACP SDK does not expose session attachment.")
  }

  return agent.attachSession(response)
}

function getAcpResumeSupport(response: InitializeResponse) {
  return Boolean(response.agentCapabilities?.sessionCapabilities?.resume)
}

function getAcpLoadSupport(response: InitializeResponse) {
  return Boolean(response.agentCapabilities?.loadSession)
}

function getAcpAdditionalDirectoriesSupport(response: InitializeResponse) {
  return Boolean(
    response.agentCapabilities?.sessionCapabilities?.additionalDirectories
  )
}

function getAcpMcpBridgeSupport(response: InitializeResponse) {
  return Boolean(response.agentCapabilities?.mcpCapabilities?.acp)
}

function selectAcpMcpServers({
  bridge,
  directServers,
  initializeResponse,
}: {
  bridge: AcpMcpBridge | null
  directServers: AcpMcpServer[]
  initializeResponse: InitializeResponse
}) {
  const mcpCapabilities = initializeResponse.agentCapabilities?.mcpCapabilities

  if (bridge?.size && getAcpMcpBridgeSupport(initializeResponse)) {
    return bridge.toAcpMcpServers() as AcpMcpServer[]
  }

  return directServers.filter((server) => {
    if (!("type" in server)) {
      return true
    }

    if (server.type === "http") {
      return mcpCapabilities?.http === true
    }

    if (server.type === "sse") {
      return mcpCapabilities?.sse === true
    }

    return mcpCapabilities?.acp === true
  })
}

async function startAcpSession({
  additionalDirectories,
  connection,
  initializeResponse,
  mcpServers,
  sessionMeta,
  storedSessionRef,
  workspace,
}: {
  additionalDirectories: string[]
  connection: ClientConnection
  initializeResponse: InitializeResponse
  mcpServers: AcpMcpServer[]
  sessionMeta: Record<string, unknown> | null
  storedSessionRef: string | null
  workspace: string
}) {
  if (storedSessionRef && getAcpResumeSupport(initializeResponse)) {
    const response = await connection.agent.request(
      methods.agent.session.resume,
      {
        ...(additionalDirectories.length ? { additionalDirectories } : {}),
        cwd: workspace,
        mcpServers,
        sessionId: storedSessionRef,
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      }
    )

    return {
      activeSession: attachAcpSession(connection, {
        sessionId: storedSessionRef,
        modes: response.modes,
        configOptions: response.configOptions,
        _meta: response._meta,
      }),
      resumed: true,
    }
  }

  if (storedSessionRef && getAcpLoadSupport(initializeResponse)) {
    const response = await connection.agent.request(
      methods.agent.session.load,
      {
        ...(additionalDirectories.length ? { additionalDirectories } : {}),
        cwd: workspace,
        mcpServers,
        sessionId: storedSessionRef,
        ...(sessionMeta ? { _meta: sessionMeta } : {}),
      }
    )

    return {
      activeSession: attachAcpSession(connection, {
        sessionId: storedSessionRef,
        modes: response.modes,
        configOptions: response.configOptions,
        _meta: response._meta,
      }),
      resumed: true,
    }
  }

  const sessionBuilder = connection.agent.buildSession({
    cwd: workspace,
    mcpServers,
    ...(sessionMeta ? { _meta: sessionMeta } : {}),
  })

  if (additionalDirectories.length) {
    sessionBuilder.withAdditionalDirectories(additionalDirectories)
  }

  const activeSession = await sessionBuilder.start()

  return {
    activeSession,
    resumed: false,
  }
}

function getAutomaticAcpAuthenticationMethod(
  initializeResponse: InitializeResponse
) {
  return initializeResponse.authMethods?.find((method) => {
    const type = "type" in method ? method.type : "agent"

    return type === "agent"
  })
}

export async function startAcpSessionWithAuthentication(
  options: Parameters<typeof startAcpSession>[0]
) {
  try {
    return await startAcpSession(options)
  } catch (error) {
    if (!(error instanceof RequestError) || error.code !== -32000) {
      throw error
    }

    const method = getAutomaticAcpAuthenticationMethod(
      options.initializeResponse
    )

    if (!method) {
      const advertised = options.initializeResponse.authMethods
        ?.map((candidate) => candidate.name)
        .join(", ")

      throw new Error(
        advertised
          ? `ACP authentication is required, but the advertised methods require unsupported client-side setup: ${advertised}.`
          : "ACP authentication is required, but the agent did not advertise a compatible authentication method.",
        { cause: error }
      )
    }

    await options.connection.agent.request(methods.agent.authenticate, {
      methodId: method.id,
    })

    return startAcpSession(options)
  }
}

export function shouldFallbackFromAcpSessionRestore({
  storedSessionRef,
  strict,
}: {
  storedSessionRef: string | null
  strict: boolean
}) {
  return Boolean(storedSessionRef) && !strict
}

async function createAcpSession({
  additionalDirectories,
  authentication,
  command,
  fallbackMcpServers,
  info,
  key,
  mcpBridgeServers,
  mcpServers,
  onInitializeResponse,
  sessionId,
  sessionKey,
  sessionMeta,
  strictStoredSessionRef,
  storedSessionRef,
  workspace,
  onPrepared,
}: {
  additionalDirectories: string[]
  authentication: AcpAuthenticationSpec | null
  command: AcpCommandSpec
  fallbackMcpServers: AcpMcpServer[]
  info: AgentRuntimeInfo
  key: string
  mcpBridgeServers: AcpMcpBridgeServer[]
  mcpServers: AcpMcpServer[]
  onInitializeResponse?: (response: InitializeResponse) => void
  sessionId: string
  sessionKey: string | null
  sessionMeta: Record<string, unknown> | null
  strictStoredSessionRef: boolean
  storedSessionRef: string | null
  workspace: string
  onPrepared?: (state: AcpPreparedState) => void
}) {
  const { child, cookieStoreKey, spawnError, stream } = createAcpCommandStream(
    command,
    workspace,
    key
  )
  let state: AcpSessionState | null = null
  let preparedState: AcpPreparedState | null = null
  let capturedStderr = ""
  let authorizedAdditionalDirectories: string[] = []
  const startupSessionNotifications: SessionNotification[] = []
  const fallbackAbortController = new AbortController()
  const mcpBridge = mcpBridgeServers.length
    ? new AcpMcpBridge(mcpBridgeServers)
    : null
  const app = createAcpClientApp({
    debugLabel: info.id,
    getAdditionalDirectories: () => authorizedAdditionalDirectories,
    getAcpSessionId: () => state?.acpSessionId ?? null,
    getSignal: () => state?.runSignal ?? fallbackAbortController.signal,
    localWorkspaceAccess:
      command.transport !== "http" && command.transport !== "websocket",
    mcpBridge,
    onSessionUpdate: (notification) => {
      if (!state) {
        startupSessionNotifications.push(notification)
        return
      }

      if (notification.sessionId !== state.acpSessionId) {
        state.replacementNotifications?.push(notification)
        return
      }

      const update = notification.update

      if (update.sessionUpdate === "current_mode_update") {
        state.currentModeId = truncateAcpControlText(update.currentModeId, 512)
      } else if (update.sessionUpdate === "config_option_update") {
        state.configOptions = sanitizeAcpConfigOptions(update.configOptions)
      } else if (update.sessionUpdate === "available_commands_update") {
        const event = availableCommandsToEvent(update, state.runtimeId)

        state.availableCommands = event.commands
        cacheAcpAvailableCommands(state.studioSessionId, event.commands)
      } else if (update.sessionUpdate === "session_info_update") {
        state.sessionInfo = mergeAcpSessionInfoUpdate(
          state.sessionInfo,
          update
        )
      } else if (update.sessionUpdate === "usage_update") {
        const rateLimitInfo = getClaudeRateLimitInfo(update)

        if (rateLimitInfo !== undefined) {
          state.rateLimitInfo = rateLimitInfo
        }
      }
    },
    sessionId,
    workspace,
    emitEvent: (event) => {
      state?.queue?.push(event)
    },
  })
  const connection = app.connect(stream)

  child?.stderr.on("data", (chunk: Buffer) => {
    capturedStderr = `${capturedStderr}${chunk.toString("utf8")}`

    if (capturedStderr.length > MAX_CAPTURED_STDERR_LENGTH) {
      capturedStderr = capturedStderr.slice(-MAX_CAPTURED_STDERR_LENGTH)
    }

    if (state) {
      state.stderr = capturedStderr
    }

    debugAcp("stderr", {
      runtimeId: info.id,
      text: chunk.toString("utf8").trim(),
    })
  })

  try {
    const initializeResponse = await withTimeout(
      Promise.race([
        initializeAcpConnection(connection, {
          remoteWorkspace:
            command.transport === "http" || command.transport === "websocket",
        }),
        spawnError,
      ]),
      ACP_STARTUP_TIMEOUT_MS,
      `${info.label} ACP initialize`
    )
    onInitializeResponse?.(initializeResponse)
    const supportsAdditionalDirectories =
      getAcpAdditionalDirectoriesSupport(initializeResponse)
    const selectedMcpServers = selectAcpMcpServers({
      bridge: mcpBridge,
      directServers: mcpServers,
      initializeResponse,
    })
    const selectedFallbackMcpServers = selectAcpMcpServers({
      bridge: null,
      directServers: fallbackMcpServers,
      initializeResponse,
    })
    const sessionMcpServers = supportsAdditionalDirectories
      ? selectedMcpServers
      : [...selectedMcpServers, ...selectedFallbackMcpServers]
    const sessionAdditionalDirectories = supportsAdditionalDirectories
      ? additionalDirectories
      : []

    authorizedAdditionalDirectories = sessionAdditionalDirectories

    if (authentication) {
      const advertisedMethod = initializeResponse.authMethods?.find(
        (method) => method.id === authentication.methodId
      )

      if (!advertisedMethod) {
        throw new Error(
          `${info.label} did not advertise authentication method ${authentication.methodId}.`
        )
      }
      if (
        ("type" in advertisedMethod ? advertisedMethod.type : "agent") !==
        "agent"
      ) {
        throw new Error(
          `${info.label} authentication method ${authentication.methodId} requires unsupported client-side setup.`
        )
      }

      await withTimeout(
        Promise.race([
          connection.agent.request(methods.agent.authenticate, authentication),
          spawnError,
        ]),
        ACP_STARTUP_TIMEOUT_MS,
        `${info.label} ACP authenticate`
      )
    }

    if (onPrepared) {
      let resolveSessionStart!: () => void
      let rejectSessionStart!: (error: Error) => void
      const sessionStart = new Promise<void>((resolve, reject) => {
        resolveSessionStart = resolve
        rejectSessionStart = reject
      })

      preparedState = {
        child,
        command,
        connection,
        cookieStoreKey,
        disposed: false,
        failSessionStart: rejectSessionStart,
        idleTimer: null,
        initializeResponse,
        key,
        mcpBridge,
        operationTail: Promise.resolve(),
        requestSessionStart: async () => {
          const prepared = preparedState

          if (!prepared || prepared.disposed) {
            throw new Error(
              "The ACP prepared connection is no longer available."
            )
          }
          if (prepared.sessionStartRequested) {
            return
          }

          await prepared.operationTail
          if (prepared.disposed) {
            throw new Error(
              "The ACP prepared connection is no longer available."
            )
          }
          prepared.sessionStartRequested = true
          if (prepared.idleTimer) {
            clearTimeout(prepared.idleTimer)
            prepared.idleTimer = null
          }
          resolveSessionStart()
        },
        runtimeId: info.id,
        sessionKey: sessionKey ?? "",
        sessionStartRequested: false,
        studioSessionId: sessionId,
        workspace,
      }
      acpPreparedSessions.set(key, preparedState)
      scheduleAcpPreparedIdleCleanup(preparedState)
      onPrepared(preparedState)

      child?.once("exit", () => {
        const prepared = preparedState

        if (prepared && acpPreparedSessions.get(key) === prepared) {
          disposeAcpPreparedSession(key, prepared, "ACP process exited")
        }
      })
      void connection.closed
        .then(() => {
          const prepared = preparedState

          if (prepared && acpPreparedSessions.get(key) === prepared) {
            disposeAcpPreparedSession(key, prepared, "ACP connection closed")
          }
        })
        .catch(() => undefined)

      await sessionStart
      if (preparedState.disposed) {
        throw new Error(
          "The ACP prepared connection closed before session setup."
        )
      }
      if (acpPreparedSessions.get(key) === preparedState) {
        acpPreparedSessions.delete(key)
      }
    }

    let activeSession: ActiveSession
    let resumed = false

    try {
      const session = await withTimeout(
        Promise.race([
          startAcpSessionWithAuthentication({
            additionalDirectories: sessionAdditionalDirectories,
            connection,
            initializeResponse,
            mcpServers: sessionMcpServers,
            sessionMeta,
            storedSessionRef,
            workspace,
          }),
          spawnError,
        ]),
        ACP_STARTUP_TIMEOUT_MS,
        `${info.label} ACP session/start`
      )

      activeSession = session.activeSession
      resumed = session.resumed
    } catch (error) {
      if (
        !shouldFallbackFromAcpSessionRestore({
          storedSessionRef,
          strict: strictStoredSessionRef,
        })
      ) {
        throw error
      }

      debugAcp("session_resume_failed", {
        error: errorMessage(error),
        runtimeId: info.id,
        storedSessionRef,
      })

      const session = await withTimeout(
        Promise.race([
          startAcpSessionWithAuthentication({
            additionalDirectories: sessionAdditionalDirectories,
            connection,
            initializeResponse,
            mcpServers: sessionMcpServers,
            sessionMeta,
            storedSessionRef: null,
            workspace,
          }),
          spawnError,
        ]),
        ACP_STARTUP_TIMEOUT_MS,
        `${info.label} ACP session/new`
      )

      activeSession = session.activeSession
      resumed = false
    }

    debugAcp("session_started", {
      acpSessionId: activeSession.sessionId,
      resumed,
      runtimeId: info.id,
    })

    state = {
      acpSessionId: activeSession.sessionId,
      activeSession,
      additionalDirectories: sessionAdditionalDirectories,
      availableCommands: [],
      child,
      command,
      configOptions: sanitizeAcpConfigOptions(
        activeSession.newSessionResponse.configOptions
      ),
      connection,
      controlCancelTimer: null,
      cookieStoreKey,
      currentModeId: activeSession.modes?.currentModeId ?? null,
      disposed: false,
      idleTimer: null,
      initializeResponse,
      key,
      loadReplayUpdateCount: 0,
      loadReplayUpdates: startupSessionNotifications
        .filter(
          (notification) => notification.sessionId === activeSession.sessionId
        )
        .map((notification) => notification.update),
      mcpBridge,
      mcpServers: sessionMcpServers,
      pendingStartupEvents: [],
      queue: null,
      rateLimitInfo: null,
      replacementNotifications: null,
      restoredFromProvider: resumed,
      runtimeId: info.id,
      runTail: Promise.resolve(),
      runSignal: null,
      sessionKey: sessionKey ?? "",
      sessionMeta,
      shouldIncludeRecapOnNextRun: false,
      sessionInfo: null,
      stderr: capturedStderr,
      studioSessionId: sessionId,
      subagentTasksByAgentId: new Map(),
      subagentTasksByProviderThreadId: new Map(),
      subagentTasksByToolCall: new Map(),
      toolCallIds: new Set(),
      toolFileChangeSignatures: new Map(),
      toolNames: new Map(),
      toolOutputs: new Map(),
      workspace,
    }

    // Command advertisements belong to the current ACP session. Clear any
    // cache left by a previous connection before applying this session's
    // startup replay; silence from the new agent means an empty command set.
    cacheAcpAvailableCommands(state.studioSessionId, [])

    if (state.loadReplayUpdates.length) {
      state.loadReplayUpdateCount = state.loadReplayUpdates.length
      const replayEvents = mapAcpSessionUpdatesForReplay(
        state.loadReplayUpdates,
        state
      )

      // The Studio session owns the durable transcript for a continued run.
      // Apply state-bearing load notifications, but do not append historical
      // assistant/tool chunks to the next assistant answer.
      state.pendingStartupEvents = replayEvents.filter(
        (event) =>
          event.type === "available-commands" || event.type === "run_meta"
      )
      const replayedCommands = [...state.pendingStartupEvents]
        .reverse()
        .find((event) => event.type === "available-commands")

      if (replayedCommands?.type === "available-commands") {
        state.availableCommands = replayedCommands.commands
        cacheAcpAvailableCommands(
          state.studioSessionId,
          replayedCommands.commands
        )
      }
      state.pendingStartupEvents.push({
        type: "run_meta",
        metadata: {
          acp: {
            loadReplay: {
              reconciled: true,
              updateCount: state.loadReplayUpdateCount,
            },
          },
        },
      })
      // Replay notifications can include complete historical content. Once
      // their state-bearing projections are reconciled, release the raw ACP
      // payloads and retain only the diagnostic count.
      state.loadReplayUpdates = []
    }

    if (activeSession.meta) {
      state.pendingStartupEvents.push({
        type: "run_meta",
        metadata: {
          acp: {
            sessionResponseMeta: sanitizeAcpRecord(activeSession.meta),
          },
        },
      })
    }
    if (initializeResponse._meta) {
      state.pendingStartupEvents.push({
        type: "run_meta",
        metadata: {
          acp: {
            initializeResponseMeta: sanitizeAcpRecord(initializeResponse._meta),
          },
        },
      })
    }

    child?.once("exit", (code, signal) => {
      if (!state) {
        return
      }

      debugAcp("process_exit", {
        runtimeId: info.id,
        code,
        signal,
      })
      disposeAcpSession(key, state, "ACP process exited")
    })

    connection.closed
      .then(() => {
        if (state) {
          disposeAcpSession(key, state, "ACP connection closed")
        }
      })
      .catch(() => {
        if (state) {
          disposeAcpSession(key, state, "ACP connection closed")
        }
      })

    acpSessions.set(key, state)

    return state
  } catch (error) {
    if (preparedState && acpPreparedSessions.get(key) === preparedState) {
      acpPreparedSessions.delete(key)
    }
    connection.close(error)
    void mcpBridge?.closeAll()

    if (child) {
      terminateChild(child)
    }

    throw new AcpStartupError(error, capturedStderr)
  }
}

async function getOrCreateAcpSession({
  additionalDirectories,
  authentication,
  command,
  fallbackMcpServers,
  info,
  mcpBridgeServers,
  mcpServers,
  modelKey,
  onInitializeResponse,
  pluginKey,
  sessionId,
  sessionMeta,
  strictStoredSessionRef,
  storedSessionRef,
  workspace,
}: {
  additionalDirectories: string[]
  authentication: AcpAuthenticationSpec | null
  command: AcpCommandSpec
  fallbackMcpServers: AcpMcpServer[]
  info: AgentRuntimeInfo
  mcpBridgeServers: AcpMcpBridgeServer[]
  mcpServers: AcpMcpServer[]
  modelKey: string | null
  onInitializeResponse?: (response: InitializeResponse) => void
  pluginKey: string | null
  sessionId: string
  sessionMeta: Record<string, unknown> | null
  strictStoredSessionRef: boolean
  storedSessionRef: string | null
  workspace: string
}) {
  const key = getSessionKey(info.id, sessionId, workspace, modelKey, pluginKey)
  const existing = acpSessions.get(key)

  invalidateConflictingAcpContexts({
    keepKey: key,
    reason: "ACP context changed",
    runtimeId: info.id,
    studioSessionId: sessionId,
  })

  if (existing && !existing.connection.signal.aborted) {
    clearAcpSessionIdleCleanup(existing)
    const shouldIncludeRecap = existing.shouldIncludeRecapOnNextRun

    existing.shouldIncludeRecapOnNextRun = false

    return {
      state: existing,
      shouldIncludeRecap,
    }
  }

  if (existing) {
    disposeAcpSession(key, existing, "ACP session stale")
  }

  const pendingStartup = acpSessionStartups.get(key)

  if (pendingStartup) {
    const prepared = acpPreparedSessions.get(key)
    const preparationCoordinator = acpPreparationCoordinators.get(key)

    if (prepared) {
      await prepared.requestSessionStart()
    } else if (preparationCoordinator) {
      // A first prompt may race the slow initialize phase. Record the start
      // intent by waiting only for prepared-ready, then release session setup;
      // never await the full startup while it is gated on this request.
      await preparationCoordinator.requestSessionStart()
    }
    const state = await pendingStartup

    if (!state.connection.signal.aborted) {
      clearAcpSessionIdleCleanup(state)
      const shouldIncludeRecap =
        state.shouldIncludeRecapOnNextRun || !state.restoredFromProvider

      state.shouldIncludeRecapOnNextRun = false

      return {
        state,
        shouldIncludeRecap,
      }
    }

    disposeAcpSession(key, state, "ACP session stale")
  }

  const startup = createAcpSession({
    additionalDirectories,
    authentication,
    command,
    fallbackMcpServers,
    info,
    key,
    mcpBridgeServers,
    mcpServers,
    onInitializeResponse,
    sessionId,
    sessionKey: [modelKey ?? "", pluginKey ?? ""].join(":"),
    sessionMeta,
    strictStoredSessionRef,
    storedSessionRef,
    workspace,
  })

  acpSessionStartups.set(key, startup)

  try {
    const state = await startup

    return {
      state,
      shouldIncludeRecap: !state.restoredFromProvider,
    }
  } finally {
    if (acpSessionStartups.get(key) === startup) {
      acpSessionStartups.delete(key)
    }
  }
}

function resetAcpRunState(state: AcpSessionState) {
  state.toolCallIds.clear()
  state.toolFileChangeSignatures.clear()
  state.toolNames.clear()
  state.toolOutputs.clear()
}

async function acquireAcpRunSlot(state: AcpSessionState, signal: AbortSignal) {
  const previousRun = state.runTail.catch(() => undefined)
  let releaseCurrent = () => {}
  let acquired = false
  let released = false
  const currentRun = new Promise<void>((resolve) => {
    releaseCurrent = resolve
  })
  const tail = previousRun.then(() => currentRun)

  state.runTail = tail

  let abortListener: (() => void) | null = null
  const abortWait = new Promise<"aborted">((resolve) => {
    if (signal.aborted) {
      resolve("aborted")
      return
    }

    abortListener = () => resolve("aborted")
    signal.addEventListener("abort", abortListener, { once: true })
  })
  const result = await Promise.race([
    previousRun.then(() => "ready" as const),
    abortWait,
  ])

  if (abortListener) {
    signal.removeEventListener("abort", abortListener)
  }

  if (result === "aborted" || signal.aborted) {
    released = true
    releaseCurrent()
    throw createAbortError("ACP run aborted before acquiring the session.")
  }

  acquired = true

  return () => {
    if (released) {
      return
    }

    released = true
    releaseCurrent()

    if (acquired && state.runTail === tail) {
      state.runTail = Promise.resolve()
    }
  }
}

function cleanupAbortHandler({
  clearAbortTimeout,
  killTimer,
  signal,
  abort,
}: {
  clearAbortTimeout: boolean
  killTimer: NodeJS.Timeout | null
  signal: AbortSignal
  abort: () => void
}) {
  signal.removeEventListener("abort", abort)

  if (clearAbortTimeout && killTimer) {
    clearTimeout(killTimer)
  }
}

function scheduleAbortKill(state: AcpSessionState) {
  const killTimer = setTimeout(() => {
    disposeAcpSession(state.key, state, "ACP abort timeout")
  }, ACP_ABORT_KILL_TIMEOUT_MS)

  killTimer.unref()

  return killTimer
}

function notifyAcpCancel(state: AcpSessionState) {
  return state.connection.agent.notify(methods.agent.session.cancel, {
    sessionId: state.acpSessionId,
  })
}

function installAbortHandler({
  signal,
  state,
}: {
  signal: AbortSignal
  state: AcpSessionState
}) {
  let killTimer: NodeJS.Timeout | null = null
  const abort = () => {
    if (killTimer) {
      return
    }

    cancelSessionPermissions(state.studioSessionId)
    cancelSessionUserInputs(state.studioSessionId)
    releaseAcpSessionTerminals(state.studioSessionId)
    void notifyAcpCancel(state).catch((error) => {
      debugAcp("cancel_failed", {
        acpSessionId: state.acpSessionId,
        error: errorMessage(error),
      })
    })
    killTimer = scheduleAbortKill(state)
  }

  if (signal.aborted) {
    abort()
  } else {
    signal.addEventListener("abort", abort, { once: true })
  }

  return {
    cleanup: (clearAbortTimeout: boolean) => {
      cleanupAbortHandler({
        clearAbortTimeout,
        killTimer,
        signal,
        abort,
      })
    },
    hasAbortTimeout: () => Boolean(killTimer),
  }
}

export function sendAcpPrompt(
  session: ActiveSession,
  blocks: ContentBlock[],
  signal: AbortSignal
) {
  return session.prompt(blocks, { cancellationSignal: signal })
}

async function pumpAcpPrompt({
  input,
  promptPreamble,
  queue,
  shouldIncludeRecap,
  state,
}: {
  input: AgentRunInput
  promptPreamble: string | null
  queue: AgentEventQueue
  shouldIncludeRecap: boolean
  state: AcpSessionState
}) {
  resetAcpRunState(state)
  state.runSignal = input.signal
  const abortHandler = installAbortHandler({
    signal: input.signal,
    state,
  })
  let completedNormally = false

  try {
    for (const event of state.pendingStartupEvents.splice(0)) {
      queue.push(event)
    }

    const promptResponse = sendAcpPrompt(
      state.activeSession,
      await createPromptBlocks(
        input.messages,
        state.initializeResponse.agentCapabilities?.promptCapabilities,
        shouldIncludeRecap,
        promptPreamble,
        state.workspace
      ),
      input.signal
    )

    promptResponse.catch(() => undefined)

    for (;;) {
      const message = await state.activeSession.nextUpdate()

      if (message.kind === "stop") {
        const stopReason = message.response.stopReason
        const promptResponseMeta = message.response._meta
          ? sanitizeAcpRecord(message.response._meta)
          : null

        queue.push({
          type: "run_meta",
          sessionRef: state.acpSessionId,
          ...(message.response.usage ? { usage: message.response.usage } : {}),
          metadata: {
            acp: {
              stopReason,
              ...(promptResponseMeta ? { promptResponseMeta } : {}),
            },
          },
        })

        const stopError = getAcpStopReasonErrorMessage({
          displayName: getAcpAgentDisplayName(state.initializeResponse),
          signalAborted: input.signal.aborted,
          stopReason,
        })

        if (stopError) {
          queue.push({ type: "error", message: stopError })
        }
        break
      }

      if (message.notification._meta) {
        queue.push({
          type: "run_meta",
          metadata: {
            acp: {
              sessionNotificationExtension: {
                sessionUpdate: message.update.sessionUpdate,
                _meta: sanitizeAcpRecord(message.notification._meta),
              },
            },
          },
        })
      }

      for (const event of mapAcpSessionUpdate(message.update, state)) {
        queue.push(event)
      }
    }

    await promptResponse
    completedNormally = true
  } catch (error) {
    if (!isAbortLikeError(error, input.signal)) {
      queue.push({
        type: "error",
        message: errorMessage(error),
      })
    }
  } finally {
    abortHandler.cleanup(completedNormally || !abortHandler.hasAbortTimeout())
    if (state.runSignal === input.signal) {
      state.runSignal = null
    }
    if (state.controlCancelTimer) {
      clearTimeout(state.controlCancelTimer)
      state.controlCancelTimer = null
    }
    queue.close()
  }
}

async function* streamAcpRun(
  options: AcpRuntimeOptions,
  input: AgentRunInput
): AsyncGenerator<AgentEvent> {
  let resolved: Awaited<ReturnType<typeof resolveAcpRunContext>>

  try {
    resolved = await resolveAcpRunContext(options, input)
  } catch (error) {
    yield {
      type: "error",
      message: errorMessage(error),
    }
    return
  }

  const {
    authentication,
    command,
    modelKey,
    pluginKey,
    sessionMeta,
    sessionPlugins,
    strictStoredSessionRef,
    storedSessionRef,
  } = resolved

  if (!command) {
    yield {
      type: "error",
      message: `${options.info.label} ACP runtime is not available on this machine. Install the required ACP adapter or local CLI and restart AstraFlow.`,
    }
    return
  }

  let state: AcpSessionState
  let shouldIncludeRecap = false
  const workspace = getAcpWorkspace(input)

  try {
    const session = await getOrCreateAcpSession({
      additionalDirectories: sessionPlugins.additionalDirectories ?? [],
      authentication,
      command,
      fallbackMcpServers: sessionPlugins.fallbackMcpServers ?? [],
      info: options.info,
      mcpBridgeServers: sessionPlugins.mcpBridgeServers ?? [],
      mcpServers: sessionPlugins.mcpServers,
      modelKey,
      onInitializeResponse: options.onInitializeResponse,
      pluginKey,
      sessionId: input.sessionId,
      sessionMeta,
      strictStoredSessionRef,
      storedSessionRef,
      workspace,
    })

    state = session.state
    shouldIncludeRecap = session.shouldIncludeRecap
  } catch (error) {
    yield {
      type: "error",
      message: createStartupErrorMessage({
        command,
        error,
        info: options.info,
      }),
    }
    return
  }

  let releaseRunSlot: (() => void) | null = null

  try {
    releaseRunSlot = await acquireAcpRunSlot(state, input.signal)
    clearAcpSessionIdleCleanup(state)
  } catch (error) {
    if (!isAbortLikeError(error, input.signal)) {
      yield {
        type: "error",
        message: errorMessage(error),
      }
    }
    return
  }

  if (state.connection.signal.aborted || acpSessions.get(state.key) !== state) {
    releaseRunSlot()
    yield {
      type: "error",
      message: `${options.info.label} ACP session ended before this run could start.`,
    }
    return
  }

  await syncAcpPermissionMode({
    input,
    info: options.info,
    state,
  })

  const queue = new AgentEventQueue()

  state.queue = queue

  const pump = pumpAcpPrompt({
    input,
    promptPreamble: sessionPlugins.promptPreamble,
    queue,
    shouldIncludeRecap,
    state,
  }).finally(() => {
    if (state.queue === queue) {
      state.queue = null
    }

    releaseRunSlot?.()

    if (
      acpSessions.get(state.key) === state &&
      !state.connection.signal.aborted
    ) {
      scheduleAcpSessionIdleCleanup(state)
    }
  })

  try {
    for await (const event of queue) {
      yield event
    }
  } finally {
    await pump
  }
}

async function resolveAcpRunContext(
  options: AcpRuntimeOptions,
  input: AgentRunInput
) {
  const sessionPlugins: AcpSessionPlugins = options.resolveSessionPlugins?.(
    input
  ) ?? {
    additionalDirectories: [],
    fallbackMcpServers: [],
    mcpBridgeServers: [],
    mcpServers: [],
    promptPreamble: null,
  }

  return {
    authentication: options.resolveAuthentication?.(input) ?? null,
    command: await options.resolveCommand(input),
    modelKey: options.resolveSessionKey?.(input) ?? null,
    pluginKey: fingerprintSessionPlugins(sessionPlugins),
    sessionMeta: withAcpTraceContext(options.resolveSessionMeta?.(input)),
    sessionPlugins,
    strictStoredSessionRef: Boolean(input.strictRuntimeSessionRef),
    storedSessionRef: input.runtimeSessionRef ?? null,
  }
}

export function createAcpTraceparent() {
  const traceId = randomUUID().replaceAll("-", "")
  const parentId = randomUUID().replaceAll("-", "").slice(0, 16)

  return `00-${traceId}-${parentId}-01`
}

function withAcpTraceContext(
  sessionMeta: Record<string, unknown> | null | undefined
) {
  const traceparent = sessionMeta?.traceparent

  return {
    ...(sessionMeta ?? {}),
    traceparent:
      typeof traceparent === "string" &&
      /^00-[\da-f]{32}-[\da-f]{16}-[\da-f]{2}$/i.test(traceparent)
        ? traceparent
        : createAcpTraceparent(),
  }
}

async function prepareAcpRun(options: AcpRuntimeOptions, input: AgentRunInput) {
  const resolved = await resolveAcpRunContext(options, input)
  const { command, sessionPlugins } = resolved

  if (!command) {
    throw new Error(
      `${options.info.label} ACP runtime is not available on this machine.`
    )
  }

  const workspace = getAcpWorkspace(input)
  const key = getSessionKey(
    options.info.id,
    input.sessionId,
    workspace,
    resolved.modelKey,
    resolved.pluginKey
  )

  invalidateConflictingAcpContexts({
    keepKey: key,
    reason: "ACP preparation context changed",
    runtimeId: options.info.id,
    studioSessionId: input.sessionId,
  })

  const active = acpSessions.get(key)

  if (active && !active.connection.signal.aborted) {
    return
  }

  const prepared = acpPreparedSessions.get(key)

  if (prepared && !prepared.disposed) {
    scheduleAcpPreparedIdleCleanup(prepared)
    return
  }

  const existingStartup = acpSessionStartups.get(key)

  if (existingStartup) {
    const coordinator = acpPreparationCoordinators.get(key)

    if (coordinator) {
      // Duplicate prepare callers wait for initialize/prepared-ready only.
      // Awaiting the full startup here would deadlock because session setup is
      // intentionally gated until the first prompt requests it.
      await coordinator.ready
    } else {
      await existingStartup
    }
    return
  }

  const coordinator = createAcpPreparationBarrier<AcpPreparedState>({
    onStale: (state) => {
      disposeAcpPreparedSession(
        key,
        state,
        "ACP preparation superseded before initialize completed"
      )
    },
  })

  // Publish prepared-ready before starting initialize so an overlapping first
  // prompt can register start intent even while initialize is still pending.
  acpPreparationCoordinators.set(key, coordinator)
  const startup = createAcpSession({
    additionalDirectories: sessionPlugins.additionalDirectories ?? [],
    authentication: resolved.authentication,
    command,
    fallbackMcpServers: sessionPlugins.fallbackMcpServers ?? [],
    info: options.info,
    key,
    mcpBridgeServers: sessionPlugins.mcpBridgeServers ?? [],
    mcpServers: sessionPlugins.mcpServers,
    onInitializeResponse: options.onInitializeResponse,
    onPrepared: coordinator.resolvePrepared,
    sessionId: input.sessionId,
    sessionKey: [resolved.modelKey ?? "", resolved.pluginKey ?? ""].join(":"),
    sessionMeta: resolved.sessionMeta,
    strictStoredSessionRef: resolved.strictStoredSessionRef,
    storedSessionRef: resolved.storedSessionRef,
    workspace,
  })

  acpSessionStartups.set(key, startup)
  void startup.then(
    () => {
      if (acpSessionStartups.get(key) === startup) {
        acpSessionStartups.delete(key)
      }
      if (acpPreparationCoordinators.get(key) === coordinator) {
        acpPreparationCoordinators.delete(key)
      }
    },
    (error) => {
      if (acpSessionStartups.get(key) === startup) {
        acpSessionStartups.delete(key)
      }
      if (acpPreparationCoordinators.get(key) === coordinator) {
        acpPreparationCoordinators.delete(key)
      }
      coordinator.rejectPrepared(error)
    }
  )

  await coordinator.ready
}

export class AcpRuntime implements AgentRuntime {
  readonly info: AgentRuntimeInfo
  private currentInfo: AgentRuntimeInfo
  private readonly options: AcpRuntimeOptions

  constructor(options: AcpRuntimeOptions) {
    this.info = options.info
    this.currentInfo = options.info
    this.options = options
  }

  getInfo(): AgentRuntimeInfo {
    return this.currentInfo
  }

  prepareRun(input: AgentRunInput): Promise<void> {
    return prepareAcpRun(
      {
        info: this.info,
        onInitializeResponse: (response) => {
          this.currentInfo = deriveAcpRuntimeInfoFromInitialize(
            this.info,
            response
          )
          this.options.onInitializeResponse?.(response)
        },
        resolveAuthentication: this.options.resolveAuthentication,
        resolveCommand: this.options.resolveCommand,
        resolveSessionPlugins: this.options.resolveSessionPlugins,
        resolveSessionKey: this.options.resolveSessionKey,
        resolveSessionMeta: this.options.resolveSessionMeta,
      },
      input
    )
  }

  startRun(input: AgentRunInput): AsyncIterable<AgentEvent> {
    return streamAcpRun(
      {
        info: this.info,
        onInitializeResponse: (response) => {
          this.currentInfo = deriveAcpRuntimeInfoFromInitialize(
            this.info,
            response
          )
          this.options.onInitializeResponse?.(response)
        },
        resolveAuthentication: this.options.resolveAuthentication,
        resolveCommand: this.options.resolveCommand,
        resolveSessionPlugins: this.options.resolveSessionPlugins,
        resolveSessionKey: this.options.resolveSessionKey,
        resolveSessionMeta: this.options.resolveSessionMeta,
      },
      input
    )
  }
}
