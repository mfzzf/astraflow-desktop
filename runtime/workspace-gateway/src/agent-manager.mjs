import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { accessSync, constants } from "node:fs"
import readline from "node:readline"

import { WebSocket } from "ws"

import { createAnthropicCompatProxy } from "./anthropic-compat-proxy.mjs"

const DEFAULT_RUNTIME_PATH =
  "/usr/local/bin:/usr/bin:/bin"
const DEFAULT_AGENT_ROOT = "/opt/astraflow/workspace-gateway"
const DEFAULT_ASTRAFLOW_AGENT_ROOT = "/opt/astraflow/astraflow-acp"
const MAX_ENV_VALUE_BYTES = 32 * 1024
const MAX_ENV_TOTAL_BYTES = 48 * 1024
const MAX_CAPTURED_STDERR_BYTES = 8 * 1024
const MAX_PENDING_AGENT_INPUT_BYTES = 32 * 1024 * 1024
const INHERITED_ENV_NAMES = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "NO_PROXY",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
  "TZ",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]

const RUNTIME_ENV_NAMES = {
  astraflow: new Set([
    "ASTRAFLOW_ACP_EXECUTION",
    "ASTRAFLOW_ACP_MODEL_CONFIG",
    "ASTRAFLOW_MODELVERSE_API_KEY",
    "ASTRAFLOW_PERMISSION_MODE",
  ]),
  codex: new Set([
    "ASTRAFLOW_MODELVERSE_API_KEY",
    "CODEX_API_KEY",
    "CODEX_CONFIG",
    "DEFAULT_AUTH_REQUEST",
    "INITIAL_AGENT_MODE",
    "MODEL_PROVIDER",
    "NO_BROWSER",
    "OPENAI_API_KEY",
  ]),
  "claude-code": new Set([
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_REMOTE",
    "CLAUDE_MODEL_CONFIG",
    "NO_BROWSER",
  ]),
  opencode: new Set([
    "ASTRAFLOW_MODELVERSE_API_KEY",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_DB",
  ]),
}

const DEFAULT_AGENT_COMMANDS = {
  astraflow: {
    command: "/usr/local/bin/node",
    args: [`${DEFAULT_ASTRAFLOW_AGENT_ROOT}/src/index.mjs`],
    requiredPath: `${DEFAULT_ASTRAFLOW_AGENT_ROOT}/src/index.mjs`,
    version: "0.1.0",
    env: {
      ASTRAFLOW_ACP_EXECUTION: "sandbox",
      ASTRAFLOW_ACP_STATE_ROOT: "/root/.astraflow/acp-sessions",
    },
  },
  codex: {
    command: `${DEFAULT_AGENT_ROOT}/node_modules/.bin/codex-acp`,
    args: [],
    env: {
      CODEX_PATH: "/usr/local/bin/codex",
    },
  },
  "claude-code": {
    command: `${DEFAULT_AGENT_ROOT}/node_modules/.bin/claude-agent-acp`,
    args: [],
    env: {
      CLAUDE_CODE_EXECUTABLE: "/usr/local/bin/claude",
    },
  },
  opencode: {
    command: "/usr/local/bin/opencode",
    args: ["acp"],
    env: {
      OPENCODE_DB: "astraflow-opencode.db",
    },
  },
}

function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isReadable(file) {
  try {
    accessSync(file, constants.R_OK)
    return true
  } catch {
    return false
  }
}

function isCommandAvailable(command) {
  return (
    isExecutable(command.command) &&
    (!command.requiredPath || isReadable(command.requiredPath))
  )
}

function closeSocket(webSocket, code, reason) {
  if (webSocket.readyState === WebSocket.OPEN) {
    webSocket.close(code, reason.slice(0, 120))
  }
}

function terminateProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  try {
    if (process.platform !== "win32" && child.pid) {
      process.kill(-child.pid, "SIGTERM")
    } else {
      child.kill("SIGTERM")
    }
  } catch {
    child.kill("SIGTERM")
  }

  const timer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }

    try {
      if (process.platform !== "win32" && child.pid) {
        process.kill(-child.pid, "SIGKILL")
      } else {
        child.kill("SIGKILL")
      }
    } catch {
      child.kill("SIGKILL")
    }
  }, 2_000)

  timer.unref()
}

function normalizeAgentEnvironment(runtimeId, value) {
  const allowedNames = RUNTIME_ENV_NAMES[runtimeId]

  if (
    !allowedNames ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {}
  }

  const env = {}
  let totalBytes = 0

  for (const [name, entry] of Object.entries(value)) {
    if (!allowedNames.has(name) || typeof entry !== "string") {
      continue
    }

    const valueBytes = Buffer.byteLength(entry, "utf8")

    if (valueBytes > MAX_ENV_VALUE_BYTES) {
      throw new Error(`Agent environment value ${name} is too large.`)
    }

    totalBytes += Buffer.byteLength(name, "utf8") + valueBytes

    if (totalBytes > MAX_ENV_TOTAL_BYTES) {
      throw new Error("Agent environment exceeds the maximum size.")
    }

    env[name] = entry
  }

  return env
}

function createAgentEnvironment(commandEnv, runtimeEnv) {
  const environment = {
    HOME: process.env.HOME || "/root",
    LOGNAME: process.env.LOGNAME || "root",
    // Keep the template-installed Node.js first and do not inherit the base
    // image's legacy NVM runtime in Agent child processes.
    PATH: DEFAULT_RUNTIME_PATH,
    SHELL: process.env.SHELL || "/bin/bash",
    USER: process.env.USER || "root",
  }

  for (const name of INHERITED_ENV_NAMES) {
    if (process.env[name]) {
      environment[name] = process.env[name]
    }
  }

  return {
    ...environment,
    ...commandEnv,
    ...runtimeEnv,
  }
}

function parseManagedOpenCodeConfig(value) {
  let config

  try {
    config = JSON.parse(value)
  } catch {
    throw new Error("OpenCode configuration must be valid JSON.")
  }

  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("OpenCode configuration must be a JSON object.")
  }

  const providers = Object.values(config.provider ?? {}).filter(
    (provider) =>
      provider &&
      typeof provider === "object" &&
      !Array.isArray(provider) &&
      provider.options &&
      typeof provider.options === "object" &&
      !Array.isArray(provider.options) &&
      typeof provider.options.baseURL === "string"
  )

  if (providers.length !== 1) {
    throw new Error(
      "Managed OpenCode configuration requires exactly one model provider."
    )
  }

  const provider = providers[0]
  const upstream = new URL(provider.options.baseURL)

  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error("OpenCode provider URL must use HTTP or HTTPS.")
  }

  if (upstream.username || upstream.password) {
    throw new Error("OpenCode provider URL must not contain credentials.")
  }

  return {
    config,
    provider,
    upstream,
  }
}

export class AgentManager {
  constructor({ workspaceRoot, commands = DEFAULT_AGENT_COMMANDS } = {}) {
    this.workspaceRoot = workspaceRoot
    this.commands = commands
    this.processes = new Map()
    this.proxies = new Map()
  }

  listRuntimes() {
    return Object.entries(this.commands).map(([id, command]) => ({
      id,
      available: isCommandAvailable(command),
      ...(command.version ? { version: command.version } : {}),
    }))
  }

  prepare(runtimeId, env) {
    const command = this.commands[runtimeId]

    if (!command || !isCommandAvailable(command)) {
      return null
    }

    return {
      runtimeId,
      runtimeVersion: command.version ?? null,
      env: normalizeAgentEnvironment(runtimeId, env),
    }
  }

  async attach(prepared, webSocket) {
    const command = this.commands[prepared.runtimeId]

    if (!command) {
      closeSocket(webSocket, 1008, "Agent runtime is unavailable")
      return false
    }

    const pendingMessages = []
    let pendingMessageBytes = 0
    let startupClosed = false
    let startupError = null
    const queuePendingMessage = (data, isBinary) => {
      pendingMessageBytes += data.length ?? data.byteLength ?? 0

      if (pendingMessageBytes > MAX_PENDING_AGENT_INPUT_BYTES) {
        startupError = new Error("Agent startup message queue is too large.")
        return
      }

      pendingMessages.push([data, isBinary])
    }
    const markStartupClosed = () => {
      startupClosed = true
    }

    webSocket.on("message", queuePendingMessage)
    webSocket.once("close", markStartupClosed)

    const runtimeEnv = { ...prepared.env }

    // The one-time ticket owns this object until the WebSocket upgrade. Clear
    // it before any asynchronous setup so request secrets do not remain
    // reachable from the Gateway's ticket/preparation state.
    for (const name of Object.keys(prepared.env)) {
      delete prepared.env[name]
    }

    let modelApiProxy = null
    let environment = null
    let child

    try {
      if (prepared.runtimeId === "claude-code") {
        const authToken = runtimeEnv.ANTHROPIC_AUTH_TOKEN?.trim()
        const upstreamBaseUrl = runtimeEnv.ANTHROPIC_BASE_URL?.trim()

        if (Boolean(authToken) !== Boolean(upstreamBaseUrl)) {
          throw new Error(
            "Claude runtime requires both an auth token and an upstream URL."
          )
        }

        if (authToken && upstreamBaseUrl) {
          delete runtimeEnv.ANTHROPIC_AUTH_TOKEN
          delete runtimeEnv.ANTHROPIC_BASE_URL
          const clientToken = randomUUID()

          modelApiProxy = await createAnthropicCompatProxy({
            authToken,
            clientToken,
            upstreamBaseUrl,
          })
          runtimeEnv.ANTHROPIC_AUTH_TOKEN = clientToken
          runtimeEnv.ANTHROPIC_BASE_URL = modelApiProxy.baseUrl
        }
      } else if (prepared.runtimeId === "opencode") {
        const authToken = runtimeEnv.ASTRAFLOW_MODELVERSE_API_KEY?.trim()
        const configContent = runtimeEnv.OPENCODE_CONFIG_CONTENT?.trim()

        if (authToken && !configContent) {
          throw new Error(
            "Managed OpenCode requires both a model key and configuration."
          )
        }

        if (authToken && configContent) {
          delete runtimeEnv.ASTRAFLOW_MODELVERSE_API_KEY
          delete runtimeEnv.OPENCODE_CONFIG_CONTENT
          const configured = parseManagedOpenCodeConfig(configContent)
          const clientToken = randomUUID()

          modelApiProxy = await createAnthropicCompatProxy({
            authToken,
            clientToken,
            upstreamBaseUrl: configured.upstream.origin,
          })
          configured.provider.options.apiKey =
            "{env:ASTRAFLOW_MODELVERSE_API_KEY}"
          configured.provider.options.baseURL = `${modelApiProxy.baseUrl}${
            configured.upstream.pathname === "/"
              ? ""
              : configured.upstream.pathname
          }${configured.upstream.search}`

          runtimeEnv.ASTRAFLOW_MODELVERSE_API_KEY = clientToken
          runtimeEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify(configured.config)
        }
      }

      if (startupClosed) {
        throw new Error("Agent WebSocket closed during startup.")
      }

      if (startupError) {
        throw startupError
      }

      environment = createAgentEnvironment(command.env, runtimeEnv)
      child = spawn(command.command, command.args ?? [], {
        cwd: this.workspaceRoot,
        detached: process.platform !== "win32",
        env: environment,
        stdio: ["pipe", "pipe", "pipe"],
      })
    } catch {
      webSocket.off("message", queuePendingMessage)
      webSocket.off("close", markStartupClosed)

      for (const name of Object.keys(runtimeEnv)) {
        delete runtimeEnv[name]
      }

      await modelApiProxy?.close()
      closeSocket(webSocket, 1011, "Agent runtime failed to start")
      return false
    }

    for (const name of Object.keys(runtimeEnv)) {
      delete runtimeEnv[name]
      delete environment[name]
    }
    const processId = randomUUID()
    const stdout = readline.createInterface({ input: child.stdout })
    let capturedStderr = ""
    let inputChain = Promise.resolve()
    let closing = false

    this.processes.set(processId, child)

    if (modelApiProxy) {
      this.proxies.set(processId, modelApiProxy)
    }

    const close = (code = 1000, reason = "Agent process ended") => {
      if (closing) {
        return
      }

      closing = true
      stdout.close()
      this.proxies.delete(processId)
      void modelApiProxy?.close()
      closeSocket(webSocket, code, reason)
      terminateProcess(child)
    }

    stdout.on("line", (line) => {
      const message = line.trim()

      if (!message || webSocket.readyState !== WebSocket.OPEN) {
        return
      }

      try {
        const parsed = JSON.parse(message)

        if (parsed && typeof parsed === "object") {
          webSocket.send(JSON.stringify(parsed))
        }
      } catch {
        console.warn("[workspace-gateway] ignored non-JSON ACP stdout", {
          runtimeId: prepared.runtimeId,
        })
      }
    })

    child.stderr.on("data", (chunk) => {
      capturedStderr = `${capturedStderr}${chunk.toString("utf8")}`

      if (
        Buffer.byteLength(capturedStderr, "utf8") > MAX_CAPTURED_STDERR_BYTES
      ) {
        capturedStderr = capturedStderr.slice(-MAX_CAPTURED_STDERR_BYTES)
      }
    })

    const handleMessage = (data, isBinary) => {
      inputChain = inputChain
        .then(() => {
          if (isBinary || child.stdin.destroyed) {
            throw new Error("ACP messages must be JSON text frames.")
          }

          const parsed = JSON.parse(data.toString("utf8"))

          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("ACP message must be a JSON object.")
          }

          child.stdin.write(`${JSON.stringify(parsed)}\n`)
        })
        .catch((error) => {
          close(
            1008,
            error instanceof Error ? error.message : "Invalid ACP message"
          )
        })
    }

    webSocket.off("message", queuePendingMessage)
    webSocket.off("close", markStartupClosed)
    webSocket.on("message", handleMessage)
    webSocket.once("close", () => close())
    webSocket.once("error", () => close(1011, "Agent WebSocket failed"))
    child.once("error", (error) => close(1011, error.message))
    child.once("exit", (code, signal) => {
      this.processes.delete(processId)

      if (closing) {
        return
      }

      const detail = capturedStderr.trim().split(/\r?\n/).at(-1)
      const reason = detail || `Agent exited (${signal || code || 0})`

      close(code === 0 ? 1000 : 1011, reason)
    })

    for (const [data, isBinary] of pendingMessages) {
      handleMessage(data, isBinary)
    }

    return true
  }

  closeAll() {
    for (const child of this.processes.values()) {
      terminateProcess(child)
    }

    for (const proxy of this.proxies.values()) {
      void proxy.close()
    }

    this.processes.clear()
    this.proxies.clear()
  }
}

export const AGENT_RUNTIME_IDS = Object.freeze(
  Object.keys(DEFAULT_AGENT_COMMANDS)
)
