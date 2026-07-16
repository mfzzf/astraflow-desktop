import {
  client as createAcpClient,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ActiveSession,
  type ClientConnection,
  type ContentBlock,
  type CreateElicitationRequest,
  type InitializeResponse,
  type NewSessionResponse,
  type PromptCapabilities,
  type SessionUpdate,
  type TerminalExitStatus,
} from "@agentclientprotocol/sdk"
import { createHttpStream } from "@agentclientprotocol/sdk/experimental/http-client"
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { constants as fsConstants } from "node:fs"
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, relative, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { WebSocket as NodeWebSocket } from "ws"

import type {
  PromptMention,
  SlashCommandDescriptor,
} from "@/lib/agent/composer-types"
import type { AgentEvent, AgentFileChangeEvent } from "@/lib/agent/events"
import type {
  AgentMessage,
  AgentMessageContent,
} from "@/lib/agent/messages"
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
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"
import { getAcpStopReasonErrorMessage } from "@/lib/agent/acp/stop-reason"
import { getMcpToolServerName } from "@/lib/mcp"

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
  child: ChildProcessWithoutNullStreams | null
  command: AcpCommandSpec
  connection: ClientConnection
  disposed: boolean
  idleTimer: NodeJS.Timeout | null
  initializeResponse: InitializeResponse
  key: string
  mcpServers: AcpMcpServer[]
  mcpBridge: AcpMcpBridge | null
  queue: AgentEventQueue | null
  restoredFromProvider: boolean
  runTail: Promise<void>
  runSignal: AbortSignal | null
  stderr: string
  sessionKey: string
  sessionMeta: Record<string, unknown> | null
  studioSessionId: string
  toolCallIds: Set<string>
  toolFileChangeSignatures: Map<string, Set<string>>
  toolNames: Map<string, string>
  toolOutputs: Map<string, string>
  workspace: string
}

export type AcpMapperReplayState = {
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
const MAX_CAPTURED_STDERR_LENGTH = 4000
const ASTRAFLOW_ACP_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
const ACP_SESSION_KEY_SEPARATOR = "\u0000"
const ACP_SAFE_WRITE_FLAGS =
  fsConstants.O_WRONLY |
  fsConstants.O_CREAT |
  fsConstants.O_TRUNC |
  (fsConstants.O_NOFOLLOW ?? 0)

type AcpRuntimeGlobalState = {
  children: Set<ChildProcessWithoutNullStreams>
  cleanupHooksInstalled: boolean
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
    sessions: new Map(),
    startups: new Map(),
    terminals: new Map(),
  })

const acpChildren = acpGlobalState.children
const acpSessions = acpGlobalState.sessions
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

function trimUtf8BytesFromStart(text: string, maxBytes: number) {
  if (maxBytes <= 0 || Buffer.byteLength(text, "utf8") <= maxBytes) {
    return { text, truncated: false }
  }

  let result = text

  while (Buffer.byteLength(result, "utf8") > maxBytes && result.length > 0) {
    const overshoot = Buffer.byteLength(result, "utf8") - maxBytes
    result = result.slice(Math.max(1, Math.floor(overshoot / 2)))
  }

  return { text: result, truncated: true }
}

function appendTerminalOutput(state: AcpTerminalState, chunk: Buffer) {
  const next = `${state.output}${chunk.toString("utf8")}`
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
  if (!plugins.mcpServers.length && !plugins.promptPreamble) {
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

function isRuntimeSessionKey(
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
      : input.projectPath?.trim()

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

function errorMessage(error: unknown) {
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
  const data = getRecord(record?.data)
  const detail =
    typeof data?.details === "string"
      ? data.details.trim()
      : typeof record?.details === "string"
        ? record.details.trim()
        : ""

  return detail && detail !== message ? `${message}: ${detail}` : message
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
  const modes = state.activeSession.modes

  if (!modes?.availableModes?.length) {
    return
  }

  const preferredModeId = getPreferredAcpSessionModes({
    mode: input.permissionMode,
    runtimeId: info.id,
  }).find((modeId) =>
    modes.availableModes.some((availableMode) => availableMode.id === modeId)
  )

  if (!preferredModeId || modes.currentModeId === preferredModeId) {
    return
  }

  try {
    await state.connection.agent.request(methods.agent.session.setMode, {
      modeId: preferredModeId,
      sessionId: state.acpSessionId,
      _meta: {
        astraflowPermissionMode: input.permissionMode,
      },
    })
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

async function resolveSafeReadPath(workspace: string, rawPath: string) {
  const workspaceRealPath = await realpath(workspace)
  const targetPath = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(workspaceRealPath, rawPath)
  const targetRealPath = await realpath(targetPath)

  assertPathInsideWorkspace(workspaceRealPath, targetRealPath)

  return targetRealPath
}

async function resolveSafeWritePath(workspace: string, rawPath: string) {
  const workspaceRealPath = await realpath(workspace)
  const targetPath = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(workspaceRealPath, rawPath)
  const parentPath = dirname(targetPath)
  const parentRealPath = await resolveSafeWriteParent(
    workspaceRealPath,
    parentPath
  )
  const safePath = resolve(parentRealPath, basename(targetPath))

  await assertSafeExistingWriteTarget(workspaceRealPath, safePath)

  return safePath
}

function assertPathInsideWorkspace(workspace: string, target: string) {
  const pathFromWorkspace = relative(workspace, target)

  if (
    pathFromWorkspace === "" ||
    (!pathFromWorkspace.startsWith("..") && !isAbsolute(pathFromWorkspace))
  ) {
    return
  }

  throw new Error("ACP file access is limited to this session workspace.")
}

function applyLineWindow(
  content: string,
  line?: number | null,
  limit?: number | null
) {
  if (!line && !limit) {
    return content
  }

  const lines = content.split(/\r?\n/)
  const start = Math.max((line ?? 1) - 1, 0)
  const end = limit ? start + Math.max(limit, 0) : undefined

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
  getSignal,
  params,
  sessionId,
}: {
  emitEvent?: (event: AgentEvent) => void
  getSignal: () => AbortSignal
  params: {
    args?: string[]
    command: string
    cwd?: string | null
    env?: Array<{ name: string; value: string }>
  }
  sessionId: string
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
    signal: getSignal(),
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

function getTerminalSession(terminalId: string) {
  const terminal = acpTerminalSessions.get(terminalId)

  if (!terminal || terminal.released) {
    throw new Error(`ACP terminal not found: ${terminalId}`)
  }

  return terminal
}

function releaseAcpTerminal(terminalId: string) {
  const terminal = acpTerminalSessions.get(terminalId)

  if (!terminal) {
    return
  }

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
  emitEvent,
  params,
  sessionId,
  workspace,
}: {
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
  const cwd = params.cwd
    ? await resolveSafeReadPath(workspace, params.cwd)
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
    1024,
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

  acpTerminalSessions.set(terminalId, terminal)
  child.stdout.on("data", (chunk: Buffer) =>
    appendTerminalOutput(terminal, chunk)
  )
  child.stderr.on("data", (chunk: Buffer) =>
    appendTerminalOutput(terminal, chunk)
  )
  child.once("exit", (code, signal) => {
    terminal.exitStatus = terminalExitStatus(code, signal)
    resolveTerminalWaiters(terminal)
  })
  child.once("error", (error) => {
    appendTerminalOutput(terminal, Buffer.from(`${errorMessage(error)}\n`))
    terminal.exitStatus = terminalExitStatus(1, null)
    resolveTerminalWaiters(terminal)
  })

  return terminalId
}

function waitForAcpTerminalExit(terminal: AcpTerminalState) {
  if (terminal.exitStatus) {
    return Promise.resolve(terminal.exitStatus)
  }

  return new Promise<TerminalExitStatus>((resolve) => {
    terminal.waiters.push(resolve)
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
  getSignal,
  mcpBridge,
  sessionId,
  workspace,
}: {
  debugLabel: string
  emitEvent?: (event: AgentEvent) => void
  getSignal: () => AbortSignal
  mcpBridge?: AcpMcpBridge | null
  sessionId: string
  workspace: string
}) {
  return createAcpClient({ name: "AstraFlow Desktop" })
    .onRequest(methods.client.fs.readTextFile, async ({ params }) => {
      const safePath = await resolveSafeReadPath(workspace, params.path)
      const content = await readFile(safePath, "utf8")

      return {
        content: applyLineWindow(content, params.line, params.limit),
      }
    })
    .onRequest(methods.client.fs.writeTextFile, async ({ params }) => {
      const safePath = await resolveSafeWritePath(workspace, params.path)
      const fileChange = await getSafeWriteChange(
        workspace,
        safePath,
        params.content
      )

      await writeFile(safePath, params.content, {
        encoding: "utf8",
        flag: ACP_SAFE_WRITE_FLAGS,
      })

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
    .onRequest(methods.client.terminal.create, async ({ params }) => {
      await requestAcpTerminalPermission({
        emitEvent,
        getSignal,
        params,
        sessionId,
      })

      const terminalId = await createAcpTerminal({
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
    .onRequest(methods.client.terminal.output, async ({ params }) => {
      const terminal = getTerminalSession(params.terminalId)

      return {
        output: terminal.output,
        truncated: terminal.truncated,
        exitStatus: terminal.exitStatus,
      }
    })
    .onRequest(methods.client.terminal.waitForExit, async ({ params }) => {
      return waitForAcpTerminalExit(getTerminalSession(params.terminalId))
    })
    .onRequest(methods.client.terminal.kill, async ({ params }) => {
      const terminal = getTerminalSession(params.terminalId)

      terminateChild(terminal.child)
    })
    .onRequest(methods.client.terminal.release, async ({ params }) => {
      releaseAcpTerminal(params.terminalId)
    })
    .onRequest(methods.client.elicitation.create, async ({ params }) => {
      const requestId =
        "requestId" in params && typeof params.requestId === "string"
          ? params.requestId
          : "elicitationId" in params &&
              typeof params.elicitationId === "string"
            ? params.elicitationId
            : randomUUID()
      const questions = createElicitationQuestions(params)
      const scopedSessionId = getElicitationScopeSessionId(params)

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
        signal: getSignal(),
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
    })
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
      async ({ params }) => {
        if (!mcpBridge) {
          throw new Error("ACP MCP bridge is not configured for this session.")
        }

        return mcpBridge.request(params)
      }
    )
    .onNotification(
      ACP_MCP_METHODS.message,
      messageMcpRequestParser,
      async ({ params }) => {
        if (!mcpBridge) {
          return
        }

        await mcpBridge.notify(params)
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
    .onRequest(methods.client.session.requestPermission, async ({ params }) => {
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
        signal: getSignal(),
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
    })
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

function createAcpCommandStream(
  command: AcpCommandSpec,
  cwd: string
): {
  child: ChildProcessWithoutNullStreams | null
  spawnError: Promise<never>
  stream: ReturnType<typeof ndJsonStream>
} {
  if (command.transport === "http") {
    return {
      child: null,
      spawnError: new Promise<never>(() => undefined),
      stream: createHttpStream(command.url, {
        headers: command.headers,
      }) as ReturnType<typeof ndJsonStream>,
    }
  }

  if (command.transport === "websocket") {
    return {
      child: null,
      spawnError: new Promise<never>(() => undefined),
      stream: createWebSocketStream(command.url, {
        cookies: "omit",
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
  return connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      auth: {
        terminal: false,
        _meta: {
          gateway: true,
        },
      },
      elicitation: {
        form: {},
        url: {},
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
      version: "0.0.11",
    },
  })
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

function supportsAcpPromptImage(capabilities?: PromptCapabilities | null) {
  return capabilities?.image !== false
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

function messageContentToBlocks(
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
    uri: `file://${mention.path}`,
    name: mention.name,
  }
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
        uri: `file://${safePath}`,
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

function normalizeSlashCommand(text: string) {
  const trimmed = text.trim()
  const match = trimmed.match(/^\/([A-Za-z0-9][\w:-]*)(?:\s+([\s\S]*))?$/)

  return match
    ? {
        command: match[1].toLowerCase(),
        rest: match[2]?.trim() ?? "",
      }
    : null
}

function startsWithSlashCommand(blocks: ContentBlock[]) {
  const firstBlock = blocks[0]

  return firstBlock?.type === "text" && isSlashCommandText(firstBlock.text)
}

function getLatestUserMessageText(messages: AgentMessage[]) {
  const latestUserMessage = getLatestUserMessage(messages)

  return latestUserMessage
    ? messageContentToText(latestUserMessage.message.content).trim()
    : ""
}

function getAcpAgentDisplayName(response: InitializeResponse) {
  const agentInfo = response.agentInfo
  const title =
    typeof agentInfo?.title === "string" ? agentInfo.title.trim() : ""
  const name = typeof agentInfo?.name === "string" ? agentInfo.name.trim() : ""

  return title || name || "ACP agent"
}

function getAcpLogoutSupport(response: InitializeResponse) {
  return Boolean(response.agentCapabilities?.auth?.logout)
}

function getAcpProvidersSupport(response: InitializeResponse) {
  return Boolean(response.agentCapabilities?.providers)
}

function formatAcpProviderList(response: unknown) {
  const record = getRecord(response)
  const providers = Array.isArray(record?.providers) ? record.providers : []

  if (!providers.length) {
    return "No configurable ACP providers were reported."
  }

  return providers
    .flatMap((provider) => {
      const providerRecord = getRecord(provider)

      if (!providerRecord) {
        return []
      }

      const providerId =
        typeof providerRecord.providerId === "string"
          ? providerRecord.providerId
          : ""

      if (!providerId) {
        return []
      }

      const current = getRecord(providerRecord.current)
      const baseUrl =
        typeof current?.baseUrl === "string" && current.baseUrl
          ? current.baseUrl
          : "disabled"
      const apiType =
        typeof current?.apiType === "string" && current.apiType
          ? current.apiType
          : "n/a"
      const required =
        providerRecord.required === true ? "required" : "optional"

      return [`- ${providerId}: ${apiType} ${baseUrl} (${required})`]
    })
    .join("\n")
}

async function createPromptBlocks(
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
    return [...latestBlocks, ...mentionBlocks]
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

function getContentText(content: unknown) {
  const text = contentBlockToDisplayText(content)

  return text || null
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
    const rawOutput = getRecord(update.rawOutput)

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

    return truncateAcpToolOutput(stringifyPayload(update.rawOutput))
  }

  if (Array.isArray(update.content)) {
    return truncateAcpToolOutput(
      update.content.map(toolCallContentToString).filter(Boolean).join("\n")
    )
  }

  return truncateAcpToolOutput(stringifyPayload(update.content))
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
    return stringifyPayload(update.rawInput)
  }

  if (Array.isArray(update.content)) {
    const content = update.content
      .map(toolCallContentToString)
      .filter(Boolean)
      .join("\n")

    if (content) {
      return content
    }
  }

  return stringifyPayload(
    compactObject([
      ["title", update.title],
      ["locations", update.locations],
    ])
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

function updateAcpToolOutput(
  state: AcpMapperReplayState,
  toolCallId: string,
  update: { data: string; mode: "append" | "replace" }
) {
  const output = truncateAcpToolOutput(
    update.mode === "append"
      ? `${state.toolOutputs.get(toolCallId) ?? ""}${update.data}`
      : update.data
  )

  state.toolOutputs.set(toolCallId, output)

  return output
}

function createAcpToolResult(
  update: {
    content?: unknown
    rawOutput?: unknown
    status?: string | null
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
    }
  }

  return {
    type: "tool_result",
    id: update.toolCallId,
    name,
    status: "error",
    output,
    error: output || "Tool call failed.",
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
  }
}

function normalizePlanStatus(status: unknown) {
  return status === "in_progress" || status === "completed" ? status : "pending"
}

function planEntriesToEvent(entries: unknown): AgentEvent | null {
  if (!Array.isArray(entries)) {
    return null
  }

  return {
    type: "plan_update",
    todos: entries.flatMap((entry) => {
      const record = getRecord(entry)
      const text = typeof record?.content === "string" ? record.content : ""

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

      if (typeof record?.priority === "string") {
        todo.priority = record.priority
      }

      return [todo]
    }),
  }
}

function markdownPlanToEvent(content: string): AgentEvent {
  const todos = content.split(/\r?\n/).flatMap((line) => {
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

  return {
    type: "plan_update",
    todos: todos.length
      ? todos
      : [
          {
            text: content.trim() || "Plan updated",
            status: "in_progress",
          },
        ],
  }
}

function planUpdateToEvent(
  update: Extract<SessionUpdate, { sessionUpdate: "plan_update" }>
) {
  if (update.plan.type === "items") {
    return planEntriesToEvent(update.plan.entries)
  }

  if (update.plan.type === "markdown") {
    return markdownPlanToEvent(update.plan.content)
  }

  if (update.plan.type === "file") {
    return {
      type: "plan_update",
      todos: [
        {
          text: `Plan file: ${update.plan.uri}`,
          status: "in_progress",
        },
      ],
    } satisfies AgentEvent
  }

  return null
}

function availableCommandsToEvent(
  commands: SessionUpdate & { sessionUpdate: "available_commands_update" }
): AgentEvent {
  return {
    type: "available-commands",
    commands: commands.availableCommands.flatMap((command) => {
      const name = command.name.trim().replace(/^\/+/, "")

      if (!name) {
        return []
      }

      const descriptor: SlashCommandDescriptor = {
        name,
        description: command.description,
        source: "runtime",
      }

      const inputHint = command.input?.hint?.trim()

      if (inputHint) {
        descriptor.inputHint = inputHint
      }

      return [descriptor]
    }),
  }
}

function mapAcpSessionUpdate(
  update: SessionUpdate,
  state: AcpMapperReplayState
): AgentEvent[] {
  if (update.sessionUpdate === "user_message_chunk") {
    return [
      {
        type: "run_meta",
        metadata: {
          acp: {
            userMessageChunk: update.content,
          },
        },
      },
    ]
  }

  if (update.sessionUpdate === "agent_message_chunk") {
    const delta = getContentText(update.content)

    return delta ? [{ type: "text_delta", delta }] : []
  }

  if (update.sessionUpdate === "agent_thought_chunk") {
    const delta = getContentText(update.content)

    return delta ? [{ type: "reasoning_delta", delta }] : []
  }

  if (update.sessionUpdate === "tool_call") {
    const name = getToolName(update, state)
    const fileChanges = getStructuredDiffFileChanges(update, state)
    const call = {
      type: "tool_call",
      id: update.toolCallId,
      name,
      input: toolInputToString(update),
    } satisfies AgentEvent

    state.toolCallIds.add(update.toolCallId)

    if (update.status === "completed" || update.status === "failed") {
      const output = toolOutputToString(update)

      state.toolOutputs.delete(update.toolCallId)

      return [call, ...fileChanges, createAcpToolResult(update, name, output)]
    }

    linkAcpTerminalsToToolCall(update, name)

    return [call, ...fileChanges]
  }

  if (update.sessionUpdate === "tool_call_update") {
    const name = getToolName(update, state)
    const fileChanges = getStructuredDiffFileChanges(update, state)
    const hasToolCall = state.toolCallIds.has(update.toolCallId)
    const terminalOutputUpdate = getAcpTerminalOutputUpdate(update._meta)
    const streamedOutput = terminalOutputUpdate
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
        return [...fileChanges, result]
      }

      state.toolCallIds.add(update.toolCallId)

      return [
        synthesizeToolCallFromUpdate(update, name),
        ...fileChanges,
        result,
      ]
    }

    // A still-running update may attach the terminal that carries the
    // command's live output; link it so stdout chunks stream to the UI.
    linkAcpTerminalsToToolCall(update, name)

    if (streamedOutput !== null) {
      const outputEvent = {
        type: "tool_output",
        id: update.toolCallId,
        name,
        output: streamedOutput,
      } satisfies AgentEvent

      if (hasToolCall) {
        return [...fileChanges, outputEvent]
      }

      state.toolCallIds.add(update.toolCallId)

      return [
        synthesizeToolCallFromUpdate(update, name),
        ...fileChanges,
        outputEvent,
      ]
    }

    if (!hasToolCall && (update.rawInput !== undefined || update.status)) {
      state.toolCallIds.add(update.toolCallId)

      return [synthesizeToolCallFromUpdate(update, name), ...fileChanges]
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
    return [{ type: "run_meta", usage: update }]
  }

  if (update.sessionUpdate === "plan") {
    const event = planEntriesToEvent(update.entries)

    return event ? [event] : []
  }

  if (update.sessionUpdate === "plan_update") {
    const event = planUpdateToEvent(update)

    return event ? [event] : []
  }

  if (update.sessionUpdate === "plan_removed") {
    return [{ type: "plan_update", todos: [] }]
  }

  if (update.sessionUpdate === "available_commands_update") {
    return [availableCommandsToEvent(update)]
  }

  if (update.sessionUpdate === "current_mode_update") {
    return [
      {
        type: "run_meta",
        metadata: {
          acp: {
            currentModeId: update.currentModeId,
          },
        },
      },
    ]
  }

  if (update.sessionUpdate === "config_option_update") {
    return [
      {
        type: "run_meta",
        metadata: {
          acp: {
            configOptions: update.configOptions,
          },
        },
      },
    ]
  }

  if (update.sessionUpdate === "session_info_update") {
    return [
      {
        type: "run_meta",
        metadata: {
          acp: {
            sessionInfo: update,
          },
        },
        ...(update.title !== undefined ? { sessionTitle: update.title } : {}),
      },
    ]
  }

  debugAcp("unknown_session_update_ignored", {
    keys: Object.keys(update).sort(),
    sessionUpdate: (update as { sessionUpdate?: unknown }).sessionUpdate,
  })

  return []
}

export function createAcpMapperReplayState(): AcpMapperReplayState {
  return {
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
  reason: string
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

  debugAcp("session_dispose", {
    key,
    reason,
    acpSessionId: state.acpSessionId,
    stale: !isCurrentSession,
  })

  state.activeSession.dispose()
  state.connection.close(new Error(reason))

  terminateAcpChild(state)
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

function terminateChild(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = ACP_TERMINATE_KILL_TIMEOUT_MS
) {
  if (child.exitCode !== null || child.killed) {
    return
  }

  child.kill("SIGTERM")

  if (timeoutMs <= 0) {
    return
  }

  const killTimer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
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
  for (const [key, state] of [...acpSessions]) {
    disposeAcpSession(key, state, reason)
  }

  for (const child of [...acpChildren]) {
    terminateChild(child)
  }
}

export function resetAcpSessionsForStudioSession(sessionId: string) {
  for (const [key, state] of [...acpSessions]) {
    if (state.studioSessionId === sessionId) {
      disposeAcpSession(key, state, "Studio workspace history restored")
    }
  }
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
  if (bridge?.size && getAcpMcpBridgeSupport(initializeResponse)) {
    return bridge.toAcpMcpServers() as AcpMcpServer[]
  }

  return directServers
}

async function startAcpSession({
  connection,
  initializeResponse,
  mcpServers,
  sessionMeta,
  storedSessionRef,
  workspace,
}: {
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

  const activeSession = await connection.agent
    .buildSession({
      cwd: workspace,
      mcpServers,
      ...(sessionMeta ? { _meta: sessionMeta } : {}),
    })
    .start()

  return {
    activeSession,
    resumed: false,
  }
}

async function createAcpSession({
  authentication,
  command,
  info,
  key,
  mcpBridgeServers,
  mcpServers,
  onInitializeResponse,
  sessionId,
  sessionKey,
  sessionMeta,
  storedSessionRef,
  workspace,
}: {
  authentication: AcpAuthenticationSpec | null
  command: AcpCommandSpec
  info: AgentRuntimeInfo
  key: string
  mcpBridgeServers: AcpMcpBridgeServer[]
  mcpServers: AcpMcpServer[]
  onInitializeResponse?: (response: InitializeResponse) => void
  sessionId: string
  sessionKey: string | null
  sessionMeta: Record<string, unknown> | null
  storedSessionRef: string | null
  workspace: string
}) {
  const { child, spawnError, stream } = createAcpCommandStream(
    command,
    workspace
  )
  let state: AcpSessionState | null = null
  let capturedStderr = ""
  const fallbackAbortController = new AbortController()
  const mcpBridge = mcpBridgeServers.length
    ? new AcpMcpBridge(mcpBridgeServers)
    : null
  const app = createAcpClientApp({
    debugLabel: info.id,
    getSignal: () => state?.runSignal ?? fallbackAbortController.signal,
    mcpBridge,
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
          remoteWorkspace: command.transport === "websocket",
        }),
        spawnError,
      ]),
      ACP_STARTUP_TIMEOUT_MS,
      `${info.label} ACP initialize`
    )
    onInitializeResponse?.(initializeResponse)
    const sessionMcpServers = selectAcpMcpServers({
      bridge: mcpBridge,
      directServers: mcpServers,
      initializeResponse,
    })

    if (authentication) {
      await withTimeout(
        Promise.race([
          connection.agent.request(methods.agent.authenticate, authentication),
          spawnError,
        ]),
        ACP_STARTUP_TIMEOUT_MS,
        `${info.label} ACP authenticate`
      )
    }

    let activeSession: ActiveSession
    let resumed = false

    try {
      const session = await withTimeout(
        Promise.race([
          startAcpSession({
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
      if (!storedSessionRef) {
        throw error
      }

      debugAcp("session_resume_failed", {
        error: errorMessage(error),
        runtimeId: info.id,
        storedSessionRef,
      })

      const session = await withTimeout(
        Promise.race([
          startAcpSession({
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
      child,
      command,
      connection,
      disposed: false,
      idleTimer: null,
      initializeResponse,
      key,
      mcpBridge,
      mcpServers: sessionMcpServers,
      queue: null,
      restoredFromProvider: resumed,
      runTail: Promise.resolve(),
      runSignal: null,
      sessionKey: sessionKey ?? "",
      sessionMeta,
      stderr: capturedStderr,
      studioSessionId: sessionId,
      toolCallIds: new Set(),
      toolFileChangeSignatures: new Map(),
      toolNames: new Map(),
      toolOutputs: new Map(),
      workspace,
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
    connection.close(error)
    void mcpBridge?.closeAll()

    if (child) {
      terminateChild(child)
    }

    throw new AcpStartupError(error, capturedStderr)
  }
}

async function getOrCreateAcpSession({
  authentication,
  command,
  info,
  mcpBridgeServers,
  mcpServers,
  modelKey,
  onInitializeResponse,
  pluginKey,
  sessionId,
  sessionMeta,
  storedSessionRef,
  workspace,
}: {
  authentication: AcpAuthenticationSpec | null
  command: AcpCommandSpec
  info: AgentRuntimeInfo
  mcpBridgeServers: AcpMcpBridgeServer[]
  mcpServers: AcpMcpServer[]
  modelKey: string | null
  onInitializeResponse?: (response: InitializeResponse) => void
  pluginKey: string | null
  sessionId: string
  sessionMeta: Record<string, unknown> | null
  storedSessionRef: string | null
  workspace: string
}) {
  const key = getSessionKey(info.id, sessionId, workspace, modelKey, pluginKey)
  const existing = acpSessions.get(key)

  for (const [candidateKey, candidate] of acpSessions) {
    if (
      candidateKey !== key &&
      isRuntimeSessionKey(candidateKey, info.id, sessionId)
    ) {
      disposeAcpSession(candidateKey, candidate, "ACP cwd changed")
    }
  }

  if (existing && !existing.connection.signal.aborted) {
    clearAcpSessionIdleCleanup(existing)

    return {
      state: existing,
      shouldIncludeRecap: false,
    }
  }

  if (existing) {
    disposeAcpSession(key, existing, "ACP session stale")
  }

  const pendingStartup = acpSessionStartups.get(key)

  if (pendingStartup) {
    const state = await pendingStartup

    if (!state.connection.signal.aborted) {
      clearAcpSessionIdleCleanup(state)

      return {
        state,
        shouldIncludeRecap: false,
      }
    }

    disposeAcpSession(key, state, "ACP session stale")
  }

  const startup = createAcpSession({
    authentication,
    command,
    info,
    key,
    mcpBridgeServers,
    mcpServers,
    onInitializeResponse,
    sessionId,
    sessionKey: [modelKey ?? "", pluginKey ?? ""].join(":"),
    sessionMeta,
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
  void state.connection.agent
    .notify(methods.agent.session.cancel, {
      sessionId: state.acpSessionId,
    })
    .catch((error) => {
      debugAcp("cancel_failed", {
        acpSessionId: state.acpSessionId,
        error: errorMessage(error),
      })
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

    notifyAcpCancel(state)
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

async function handleAcpManagementCommand({
  input,
  queue,
  state,
}: {
  input: AgentRunInput
  queue: AgentEventQueue
  state: AcpSessionState
}) {
  const slashCommand = normalizeSlashCommand(
    getLatestUserMessageText(input.messages)
  )

  if (!slashCommand) {
    return false
  }

  if (
    slashCommand.command === "logout" &&
    getAcpLogoutSupport(state.initializeResponse)
  ) {
    await state.connection.agent.request(methods.agent.logout, {})
    queue.push({
      type: "text_delta",
      delta: `${getAcpAgentDisplayName(state.initializeResponse)} logout completed.`,
    })
    queue.push({
      type: "run_meta",
      metadata: {
        acp: {
          auth: {
            logout: "completed",
          },
        },
      },
    })

    return true
  }

  if (
    slashCommand.command === "providers" &&
    getAcpProvidersSupport(state.initializeResponse)
  ) {
    const response = await state.connection.agent.request(
      methods.agent.providers.list,
      {}
    )
    const output = formatAcpProviderList(response)

    queue.push({
      type: "text_delta",
      delta: output,
    })
    queue.push({
      type: "run_meta",
      metadata: {
        acp: {
          providers: response,
        },
      },
    })

    return true
  }

  return false
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
    if (
      await handleAcpManagementCommand({
        input,
        queue,
        state,
      })
    ) {
      completedNormally = true
      return
    }

    const promptResponse = state.activeSession.prompt(
      await createPromptBlocks(
        input.messages,
        state.initializeResponse.agentCapabilities?.promptCapabilities,
        shouldIncludeRecap,
        promptPreamble,
        state.workspace
      )
    )

    promptResponse.catch(() => undefined)

    for (;;) {
      const message = await state.activeSession.nextUpdate()

      if (message.kind === "stop") {
        const stopReason = message.response.stopReason

        queue.push({
          type: "run_meta",
          sessionRef: state.acpSessionId,
          ...(message.response.usage ? { usage: message.response.usage } : {}),
          metadata: { acp: { stopReason } },
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
    queue.close()
  }
}

async function* streamAcpRun(
  options: AcpRuntimeOptions,
  input: AgentRunInput
): AsyncGenerator<AgentEvent> {
  let command: AcpCommandSpec | null = null
  let authentication: AcpAuthenticationSpec | null = null
  let modelKey: string | null = null
  let pluginKey: string | null = null
  let storedSessionRef: string | null = null
  let sessionPlugins: AcpSessionPlugins = {
    mcpBridgeServers: [],
    mcpServers: [],
    promptPreamble: null,
  }
  let sessionMeta: Record<string, unknown> | null = null

  try {
    command = await options.resolveCommand(input)
    authentication = options.resolveAuthentication?.(input) ?? null
    modelKey = options.resolveSessionKey?.(input) ?? null
    storedSessionRef = input.runtimeSessionRef ?? null
    sessionPlugins = options.resolveSessionPlugins?.(input) ?? sessionPlugins
    pluginKey = fingerprintSessionPlugins(sessionPlugins)
    sessionMeta = options.resolveSessionMeta?.(input) ?? null
  } catch (error) {
    yield {
      type: "error",
      message: errorMessage(error),
    }
    return
  }

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
      authentication,
      command,
      info: options.info,
      mcpBridgeServers: sessionPlugins.mcpBridgeServers ?? [],
      mcpServers: sessionPlugins.mcpServers,
      modelKey,
      onInitializeResponse: options.onInitializeResponse,
      pluginKey,
      sessionId: input.sessionId,
      sessionMeta,
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
