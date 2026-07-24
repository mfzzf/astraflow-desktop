import { createServer } from "node:net"
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SessionUpdate } from "@agentclientprotocol/sdk"
// @ts-expect-error Bun provides this module at script runtime; the app tsconfig does not load Bun's ambient types.
import { mock } from "bun:test"

import { configureSmokeNodeExecutable } from "./smoke-runtime-node.mjs"

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
  { probeOpenCodeAcpCommand },
  { applyOpenCodeLocalProcessSandbox },
  { spawnLocalSandboxedAcpProcess },
] = await Promise.all([
  import("@/lib/agent/acp/acp-runtime"),
  import("@/lib/agent/adapters/acp-runtimes"),
  import("@/lib/agent/adapters/opencode-local-sandbox"),
  import("@/lib/agent/sandbox/local-command"),
])

const TIMEOUT_MS = process.platform === "win32" ? 90_000 : 30_000
const root = mkdtempSync(join(tmpdir(), "astraflow-opencode-acp-smoke-"))
const workspacePath = join(root, "workspace")
const providerToken = "a".repeat(43)
const providerCredentialReference = "{env:ASTRAFLOW_MODELVERSE_API_KEY}"

mkdirSync(workspacePath, { recursive: true })
const workspace = realpathSync.native(workspacePath)
process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH ||= join(root, "attachments")
process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH ||= join(root, "managed")
process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH ||= join(root, "sandboxes")
process.env.ASTRAFLOW_SECRET_KEY ||= "66".repeat(32)
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
    throw new Error("OpenCode ACP smoke provider did not bind to TCP.")
  }

  const probe = probeOpenCodeAcpCommand()

  if (!probe.available) {
    throw new Error(`OpenCode ACP is unavailable: ${probe.detail}`)
  }
  if (
    probe.command.transport === "http" ||
    probe.command.transport === "websocket"
  ) {
    throw new Error("OpenCode ACP smoke requires a stdio command.")
  }

  const command = applyOpenCodeLocalProcessSandbox({
    command: {
      ...probe.command,
      args: [
        ...(probe.command.args ?? []),
        "--pure",
        "--print-logs",
        "--log-level",
        "DEBUG",
      ],
      env: {
        ...(probe.command.env ?? {}),
        ASTRAFLOW_MODELVERSE_API_KEY: providerToken,
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          model: "modelverse-openai/smoke",
          small_model: "modelverse-openai/smoke",
          permission: "allow",
          provider: {
            "modelverse-openai": {
              npm: "@ai-sdk/openai-compatible",
              name: "AstraFlow ACP smoke",
              options: {
                apiKey: providerCredentialReference,
                baseURL: `http://127.0.0.1:${address.port}/v1`,
              },
              models: {
                smoke: {
                  name: "Smoke",
                },
              },
            },
          },
        }),
      },
      providerProxyToken: providerToken,
      providerProxyTokenTransport: "environment",
    },
    input: {
      environment: "local",
      messages: [],
      model: "smoke",
      permissionMode: "default",
      sessionId: "opencode-sandbox-acp-smoke",
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
    throw new Error("OpenCode ACP smoke command was not process-sandboxed.")
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
    debugLabel: "smoke:opencode-sandbox",
    getSignal: () => abortController.signal,
    onSessionUpdate: ({ update }: { update: SessionUpdate }) => {
      if (update.sessionUpdate === "available_commands_update") {
        resolveCommands?.(
          update.availableCommands.map((command) => command.name)
        )
        resolveCommands = undefined
      }
    },
    sessionId: "smoke:opencode-sandbox",
    workspace,
  })
  const connection = app.connect(createAcpProcessStream(child))
  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      reject(
        new Error(
          `Sandboxed OpenCode ACP exited before completion: code=${code ?? "null"} signal=${signal ?? "null"}${stderr ? `\n${stderr}` : ""}`
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
      "Sandboxed OpenCode ACP initialize"
    )
    await withTimeout(
      Promise.race([
        connection.agent
          .buildSession({
            cwd: workspace,
            mcpServers: [],
          })
          .start(),
        spawnError,
      ]),
      "Sandboxed OpenCode ACP session/new"
    )
    const commands = await withTimeout(
      Promise.race([commandsReady, spawnError]),
      "Sandboxed OpenCode ACP available commands"
    )

    if (commands.length === 0) {
      throw new Error("Sandboxed OpenCode ACP advertised no commands.")
    }

    console.log(
      `opencode-sandbox: protocol/session/commands ok (${commands.length} commands)`
    )
  } catch (error) {
    throw new Error(
      `Sandboxed OpenCode ACP smoke failed: ${
        error instanceof Error ? error.message : String(error)
      }${stderr ? `\n${stderr}` : ""}`
    )
  } finally {
    connection.close()
    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM")
    }
  }
} finally {
  provider.close()
  rmSync(root, { force: true, recursive: true })
}
