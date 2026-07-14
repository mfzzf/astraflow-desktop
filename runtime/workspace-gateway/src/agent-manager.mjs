import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { accessSync, constants } from "node:fs"
import readline from "node:readline"

import { WebSocket } from "ws"

const DEFAULT_RUNTIME_PATH =
  "/usr/local/bin:/root/.nvm/versions/node/v20.9.0/bin:/usr/bin:/bin"
const DEFAULT_AGENT_ROOT = "/opt/astraflow/workspace-gateway"
const MAX_ENV_VALUE_BYTES = 32 * 1024
const MAX_ENV_TOTAL_BYTES = 48 * 1024
const MAX_CAPTURED_STDERR_BYTES = 8 * 1024
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
  codex: new Set([
    "ASTRAFLOW_MODELVERSE_API_KEY",
    "CODEX_API_KEY",
    "CODEX_CONFIG",
    "INITIAL_AGENT_MODE",
    "MODEL_PROVIDER",
    "OPENAI_API_KEY",
  ]),
  "claude-code": new Set([
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ASTRAFLOW_MODELVERSE_API_KEY",
    "CLAUDE_MODEL_CONFIG",
  ]),
  opencode: new Set([
    "ASTRAFLOW_MODELVERSE_API_KEY",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_DB",
  ]),
}

const DEFAULT_AGENT_COMMANDS = {
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
    // The base image launches background commands with Node.js 20 first on
    // PATH. The pinned ACP adapters require Node.js 22, so the child runtime
    // must not inherit the Gateway launcher's legacy PATH ordering.
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

export class AgentManager {
  constructor({ workspaceRoot, commands = DEFAULT_AGENT_COMMANDS } = {}) {
    this.workspaceRoot = workspaceRoot
    this.commands = commands
    this.processes = new Map()
  }

  listRuntimes() {
    return Object.entries(this.commands).map(([id, command]) => ({
      id,
      available: isExecutable(command.command),
    }))
  }

  prepare(runtimeId, env) {
    const command = this.commands[runtimeId]

    if (!command || !isExecutable(command.command)) {
      return null
    }

    return {
      runtimeId,
      env: normalizeAgentEnvironment(runtimeId, env),
    }
  }

  attach(prepared, webSocket) {
    const command = this.commands[prepared.runtimeId]

    if (!command) {
      closeSocket(webSocket, 1008, "Agent runtime is unavailable")
      return false
    }

    const environment = createAgentEnvironment(command.env, prepared.env)

    const child = spawn(command.command, command.args ?? [], {
      cwd: this.workspaceRoot,
      detached: process.platform !== "win32",
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
    })
    const processId = randomUUID()
    const stdout = readline.createInterface({ input: child.stdout })
    let capturedStderr = ""
    let inputChain = Promise.resolve()
    let closing = false

    this.processes.set(processId, child)

    const close = (code = 1000, reason = "Agent process ended") => {
      if (closing) {
        return
      }

      closing = true
      stdout.close()
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

    webSocket.on("message", (data, isBinary) => {
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
    })
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

    return true
  }

  closeAll() {
    for (const child of this.processes.values()) {
      terminateProcess(child)
    }

    this.processes.clear()
  }
}

export const AGENT_RUNTIME_IDS = Object.freeze(
  Object.keys(DEFAULT_AGENT_COMMANDS)
)
