import { createServer } from "node:net"
import { mkdirSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"

import type { SessionUpdate } from "@agentclientprotocol/sdk"
// @ts-expect-error Bun provides this module at script runtime; the app tsconfig does not load Bun's ambient types.
import { mock } from "bun:test"

import { getAgentRuntimePackageSpecs } from "./agent-runtime-packages.mjs"
import {
  configureSmokeNodeExecutable,
  createSmokeSandboxRoot,
  removeSmokeSandboxRoot,
  stageSmokeRuntimeExecutable,
  stopSmokeChild,
} from "./smoke-runtime-node.mjs"

mock.module("server-only", () => ({}))
configureSmokeNodeExecutable()

if (process.platform === "win32" && process.env.CI) {
  process.env.SRT_DEBUG ||= "1"
}

const [
  {
    createAcpClientApp,
    createAcpProcessStream,
    initializeAcpConnection,
  },
  { probeClaudeCodeAcpCommand, resolveClaudeCodeAcpSessionMeta },
  { applyClaudeCodeLocalProcessSandbox },
  { spawnLocalSandboxedAcpProcess },
] = await Promise.all([
  import("@/lib/agent/acp/acp-runtime"),
  import("@/lib/agent/adapters/acp-runtimes"),
  import("@/lib/agent/adapters/claude-code-local-sandbox"),
  import("@/lib/agent/sandbox/local-command"),
])

const TIMEOUT_MS =
  process.platform === "win32"
    ? process.arch === "arm64"
      ? 180_000
      : 90_000
    : 30_000
const root = createSmokeSandboxRoot("astraflow-claude-acp-smoke-")
const workspacePath = join(root, "workspace")
const providerToken = "b".repeat(43)
const runtimeTarget = `${process.platform}-${process.arch}`
const claudeSpec = getAgentRuntimePackageSpecs({
  appRoot: process.cwd(),
  nodeModulesDir: join(process.cwd(), "node_modules"),
  runtimeTarget,
}).find((spec) => spec.id === "claude-code")

if (!claudeSpec) {
  throw new Error(`Claude Code runtime is unavailable for ${runtimeTarget}.`)
}

const resolvedClaudeExecutable =
  process.env.CLAUDE_CODE_EXECUTABLE?.trim() || claudeSpec.executablePath
const claudeExecutable =
  process.platform === "win32"
    ? stageSmokeRuntimeExecutable(
        resolvedClaudeExecutable,
        root,
        "claude.exe"
      )
    : resolvedClaudeExecutable
process.env.CLAUDE_CODE_EXECUTABLE = claudeExecutable
mkdirSync(workspacePath, { recursive: true })
const workspace = realpathSync.native(workspacePath)
process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH ||= join(root, "attachments")
process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH ||= join(root, "managed")
process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH ||= join(root, "sandboxes")
process.env.ASTRAFLOW_SECRET_KEY ||= "77".repeat(32)
process.env.ASTRAFLOW_USER_DATA_PATH ||= join(root, "user-data")

if (process.platform === "win32") {
  process.env.ASTRAFLOW_SRT_WIN_PATH ||= join(
    process.cwd(),
    "runtime",
    "sandbox",
    `${process.platform}-${process.arch}`,
    "bin",
    "srt-win.exe"
  )
}

function withTimeout<T>(promise: Promise<T>, label: string) {
  let timer: NodeJS.Timeout | undefined

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${TIMEOUT_MS}ms`)),
        TIMEOUT_MS
      )
      timer.unref()
    }),
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

const provider = createServer((socket) => {
  socket.end(
    "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n"
  )
})

try {
  await new Promise<void>((resolve, reject) => {
    provider.once("error", reject)
    provider.listen(0, "127.0.0.1", resolve)
  })
  const address = provider.address()

  if (!address || typeof address === "string") {
    throw new Error("Claude Code ACP smoke provider did not bind to TCP.")
  }

  const probe = probeClaudeCodeAcpCommand()

  if (!probe.available) {
    throw new Error(`Claude Code ACP is unavailable: ${probe.detail}`)
  }
  if (
    probe.command.transport === "http" ||
    probe.command.transport === "websocket"
  ) {
    throw new Error("Claude Code ACP smoke requires a stdio command.")
  }
  if (
    probe.command.env?.CLAUDE_CODE_EXECUTABLE !== claudeExecutable
  ) {
    throw new Error(
      "Claude Code ACP did not preserve the downloaded native executable path."
    )
  }

  const command = applyClaudeCodeLocalProcessSandbox({
    command: {
      ...probe.command,
      env: {
        ...(probe.command.env ?? {}),
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_AUTH_TOKEN: providerToken,
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}`,
        ANTHROPIC_MODEL: "smoke",
        ASTRAFLOW_MODELVERSE_API_KEY: providerToken,
        CLAUDE_CODE_REMOTE: "1",
        CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
        CLAUDE_MODEL_CONFIG: JSON.stringify({
          availableModels: ["smoke"],
        }),
        NO_BROWSER: "1",
      },
      providerProxyToken: providerToken,
      providerProxyTokenTransport: "environment",
    },
    input: {
      environment: "local",
      messages: [],
      model: "smoke",
      permissionMode: "default",
      sessionId: "claude-sandbox-acp-smoke",
      signal: new AbortController().signal,
    },
    providerEndpoint: {
      host: "127.0.0.1",
      port: address.port,
    },
  })

  if (
    command.transport === "http" ||
    command.transport === "websocket" ||
    !command.sandbox
  ) {
    throw new Error("Claude Code ACP smoke command was not process-sandboxed.")
  }
  if (
    !command.sandbox.additionalReadRoots?.includes(
      dirname(claudeExecutable)
    )
  ) {
    throw new Error(
      "Claude Code sandbox did not allow its downloaded native runtime."
    )
  }

  const child = spawnLocalSandboxedAcpProcess({
    additionalReadRoots: command.sandbox.additionalReadRoots,
    allowLocalBinding: command.sandbox.allowLocalBinding,
    allowMachLookup: command.sandbox.allowMachLookup,
    allowedNetworkDomains: command.sandbox.allowedNetworkDomains,
    allowedNetworkEndpoints: command.sandbox.allowedNetworkEndpoints,
    args: command.args,
    command: command.command,
    env: command.env,
    maskedEnvironmentVariables: command.sandbox.maskedEnvironmentVariables,
    providerProxyToken: command.providerProxyToken,
    providerProxyTokenPath: command.providerProxyTokenPath,
    providerProxyTokenTransport: command.providerProxyTokenTransport,
    rootDir: workspace,
    runtimeStateRoot: command.sandbox.runtimeStateRoot,
    sessionId: command.sandbox.sessionId,
    stateRoot: command.sandbox.stateRoot,
    terminateMaskedCredentialTls:
      command.sandbox.terminateMaskedCredentialTls,
  })
  let stderr = ""
  let resolveCommands: ((commands: string[]) => void) | undefined
  const commandsReady = new Promise<string[]>((resolve) => {
    resolveCommands = resolve
  })
  const abortController = new AbortController()
  const app = createAcpClientApp({
    debugLabel: "smoke:claude-sandbox",
    getSignal: () => abortController.signal,
    onSessionUpdate: ({ update }: { update: SessionUpdate }) => {
      if (update.sessionUpdate === "available_commands_update") {
        resolveCommands?.(
          update.availableCommands.map((command) => command.name)
        )
        resolveCommands = undefined
      }
    },
    sessionId: "smoke:claude-sandbox",
    workspace,
  })
  const connection = app.connect(createAcpProcessStream(child))
  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Sandboxed Claude Code ACP exited before completion: code=${code ?? "null"} signal=${signal ?? "null"}${stderr ? `\n${stderr}` : ""}`
        )
      )
    })
  })

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000)
  })

  try {
    await withTimeout(
      Promise.race([initializeAcpConnection(connection), spawnError]),
      "Sandboxed Claude Code ACP initialize"
    )
    await withTimeout(
      Promise.race([
        connection.agent
          .buildSession({
            cwd: workspace,
            mcpServers: [],
            _meta: resolveClaudeCodeAcpSessionMeta(),
          })
          .start(),
        spawnError,
      ]),
      "Sandboxed Claude Code ACP session/new"
    )
    const commands = await withTimeout(
      Promise.race([commandsReady, spawnError]),
      "Sandboxed Claude Code ACP available commands"
    )

    if (commands.length === 0) {
      throw new Error("Sandboxed Claude Code ACP advertised no commands.")
    }

    console.log(
      `claude-sandbox: protocol/session/commands ok (${commands.length} commands)`
    )
  } catch (error) {
    throw new Error(
      `Sandboxed Claude Code ACP smoke failed: ${
        error instanceof Error ? error.message : String(error)
      }${stderr ? `\n${stderr}` : ""}`
    )
  } finally {
    connection.close()
    await stopSmokeChild(child)
  }
} finally {
  provider.close()
  await removeSmokeSandboxRoot(root)
}
