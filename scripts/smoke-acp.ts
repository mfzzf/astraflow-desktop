import {
  createAcpClientApp,
  createAcpProcessStream,
  initializeAcpConnection,
  spawnAcpChild,
  type AcpCommandSpec,
  type AcpStdioCommandSpec,
} from "@/lib/agent/acp/acp-runtime"
import { methods, type SessionUpdate } from "@agentclientprotocol/sdk"
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"
import {
  probeClaudeCodeAcpCommand,
  probeCodexAcpCommand,
  probeOpenCodeAcpCommand,
  resolveClaudeCodeAcpSessionMeta,
} from "@/lib/agent/adapters/acp-runtimes"

const SMOKE_TIMEOUT_MS = 20 * 1000

type SmokeTarget = {
  id: string
  label: string
  probe: () =>
    | { available: true; command: AcpCommandSpec; detail: string }
    | { available: false; detail: string }
}

const targets: SmokeTarget[] = [
  {
    id: "codex",
    label: "Codex",
    probe: probeCodexAcpCommand,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    probe: probeClaudeCodeAcpCommand,
  },
  {
    id: "opencode",
    label: "OpenCode",
    probe: probeOpenCodeAcpCommand,
  },
]

function commandToString(command: AcpCommandSpec) {
  if (command.transport === "http" || command.transport === "websocket") {
    return command.url
  }

  return [command.command, ...(command.args ?? [])].join(" ")
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function withTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = SMOKE_TIMEOUT_MS
) {
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

async function smokeTarget(target: SmokeTarget) {
  const probe = target.probe()

  if (!probe.available) {
    console.log(`${target.id}: unavailable - ${probe.detail}`)
    return
  }

  if (probe.command.transport === "http") {
    console.log(`${target.id}: skipped HTTP ACP target - ${probe.command.url}`)
    return
  }

  if (probe.command.transport === "websocket") {
    console.log(
      `${target.id}: skipped WebSocket ACP target - ${probe.command.url}`
    )
    return
  }

  const command: AcpStdioCommandSpec = probe.command
  const workspace = ensureAcpWorkspace(
    `smoke-${target.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  const child = spawnAcpChild(command, workspace)
  let stderr = ""
  let resolveCommands: ((commands: string[]) => void) | null = null
  const commandsReady = new Promise<string[]>((resolve) => {
    resolveCommands = resolve
  })
  const abortController = new AbortController()
  const app = createAcpClientApp({
    debugLabel: `smoke:${target.id}`,
    getSignal: () => abortController.signal,
    onSessionUpdate: ({ update }: { update: SessionUpdate }) => {
      if (update.sessionUpdate !== "available_commands_update") {
        return
      }

      const names = update.availableCommands
        .map((availableCommand) => availableCommand.name.trim())
        .filter(Boolean)

      resolveCommands?.(names)
      resolveCommands = null
    },
    sessionId: `smoke:${target.id}`,
    workspace,
  })
  const connection = app.connect(createAcpProcessStream(child))
  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", reject)
  })

  child.stderr.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2000)
  })

  try {
    const initialize = await withTimeout(
      Promise.race([initializeAcpConnection(connection), spawnError]),
      `${target.label} initialize`
    )
    const session = await withTimeout(
      Promise.race([
        connection.agent
          .buildSession({
            cwd: workspace,
            mcpServers: [],
            ...(target.id === "claude-code"
              ? { _meta: resolveClaudeCodeAcpSessionMeta() }
              : {}),
          })
          .start(),
        spawnError,
      ]),
      `${target.label} session/new`
    )
    const commandNames = await withTimeout(
      commandsReady,
      `${target.label} available commands`,
      8_000
    )

    if (commandNames.length === 0) {
      throw new Error(`${target.label} advertised an empty command list.`)
    }

    let claudePlanStatus = ""
    let openCodeFeatureStatus = ""

    if (target.id === "claude-code") {
      const modeOption = session.newSessionResponse.configOptions?.find(
        (option) => option.id === "mode"
      )
      const hasPlanMode = session.modes?.availableModes.some(
        (mode) => mode.id === "plan"
      )

      if (!hasPlanMode || !modeOption || modeOption.type !== "select") {
        throw new Error("Claude Code did not advertise its Plan mode control.")
      }
      if (!commandNames.includes("compact")) {
        throw new Error("Claude Code did not advertise /compact.")
      }

      const planResponse = await withTimeout(
        connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId: session.sessionId,
          configId: "mode",
          value: "plan",
        }),
        "Claude Code Plan mode activation"
      )
      const planCurrent = planResponse.configOptions.find(
        (option) => option.id === "mode"
      )?.currentValue

      if (planCurrent !== "plan") {
        throw new Error("Claude Code did not activate Plan mode.")
      }

      await withTimeout(
        connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId: session.sessionId,
          configId: "mode",
          value: "default",
        }),
        "Claude Code Plan mode reset"
      )
      claudePlanStatus = " plan=ok compact=ok"
    }

    if (target.id === "opencode") {
      const capabilities = initialize.agentCapabilities
      const sessionCapabilities = capabilities?.sessionCapabilities
      const configIds = new Set(
        (session.newSessionResponse.configOptions ?? []).map(
          (option) => option.id
        )
      )
      const modeOption = session.newSessionResponse.configOptions?.find(
        (option) => option.id === "mode"
      )
      const serializedModeOption = JSON.stringify(modeOption ?? null)

      if (
        capabilities?.loadSession !== true ||
        !sessionCapabilities?.close ||
        !sessionCapabilities.fork ||
        !sessionCapabilities.list ||
        !sessionCapabilities.resume
      ) {
        throw new Error(
          "OpenCode did not advertise its session load/list/resume/fork/close controls."
        )
      }
      if (!configIds.has("model") || !configIds.has("mode")) {
        throw new Error(
          "OpenCode did not advertise its model and agent mode controls."
        )
      }
      if (
        !serializedModeOption.includes('"value":"build"') ||
        !serializedModeOption.includes('"value":"plan"')
      ) {
        throw new Error(
          `OpenCode did not advertise Build and Plan modes (${serializedModeOption}).`
        )
      }
      if (
        capabilities.mcpCapabilities?.http !== true ||
        capabilities.mcpCapabilities?.sse !== true ||
        capabilities.promptCapabilities?.embeddedContext !== true ||
        capabilities.promptCapabilities?.image !== true
      ) {
        throw new Error(
          "OpenCode did not advertise MCP, embedded context, and image support."
        )
      }

      openCodeFeatureStatus =
        " sessions=ok modes=build,plan model=ok mcp=ok images=ok compact=synthetic"
    }

    console.log(
      `${target.id}: available - ${commandToString(command)} - ` +
        `protocol=${initialize.protocolVersion} ` +
        `agent=${initialize.agentInfo?.name ?? "unknown"} ` +
        `session=${session.sessionId} ` +
        `commands=${commandNames.map((name) => `/${name}`).join(",")}` +
        claudePlanStatus +
        openCodeFeatureStatus
    )

    session.dispose()
  } catch (error) {
    process.exitCode = 1
    console.log(
      `${target.id}: failed - ${commandToString(command)} - ${errorMessage(error)}`
    )

    if (stderr.trim()) {
      console.log(`${target.id}: stderr - ${stderr.trim()}`)
    }
  } finally {
    connection.close()

    if (child.exitCode === null && !child.killed) {
      child.kill("SIGTERM")
    }
  }
}

const requestedTargets = new Set(process.argv.slice(2))
const selectedTargets = requestedTargets.size
  ? targets.filter((target) => requestedTargets.has(target.id))
  : targets
const unknownTargets = [...requestedTargets].filter(
  (id) => !targets.some((target) => target.id === id)
)

if (unknownTargets.length > 0) {
  throw new Error(`Unknown ACP smoke target(s): ${unknownTargets.join(", ")}`)
}

for (const target of selectedTargets) {
  await smokeTarget(target)
}

export {}
