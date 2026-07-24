import { createHash } from "node:crypto"
import { accessSync, constants, realpathSync } from "node:fs"
import { delimiter, join, sep } from "node:path"

import {
  AcpRuntime,
  type AcpCommandSpec,
  type AcpStdioCommandSpec,
} from "@/lib/agent/acp/acp-runtime"
import { createStudioAcpSessionPlugins } from "@/lib/agent/acp/studio-plugins"
import {
  getRuntimeModelSetting,
} from "@/lib/agent-model-settings"
import {
  configureClaudeCodeAcpCommand,
  configureCodexAcpCommand,
  configureOpenCodeAcpCommand,
  getExternalAcpModelverseRunConfig,
  mergeExternalAcpCommandEnv,
} from "@/lib/agent/adapters/external-acp-run-config"
import { resolveCompShareEntitledModel } from "@/lib/compshare/entitlements"
import {
  registerAgentRuntime,
  type AgentRuntimeInfo,
  type AgentRunInput,
} from "@/lib/agent/runtime"
import { getCodexAcpInitialMode } from "@/lib/agent/permission-policy"
import { createStudioRemoteAgentConnection } from "@/lib/studio-remote-workspace"

type CommandProbe =
  | { available: true; command: AcpCommandSpec; detail: string }
  | { available: false; detail: string }

const ACP_RUNTIME_CAPABILITIES = {
  hitl: true,
  resume: true,
  subagents: true,
  plan: true,
  sandbox: true,
  mcp: true,
  skills: true,
  compact: true,
}
const CLAUDE_CODE_RUNTIME_CAPABILITIES = {
  ...ACP_RUNTIME_CAPABILITIES,
  resume: true,
  subagents: true,
  sandbox: true,
  mcp: true,
  skills: true,
}
const ACP_COMPOSER_CAPABILITIES = {
  slashCommands: "dynamic",
  fileMentions: "structured",
  sessionMentions: true,
} as const
const ACP_RUNTIME_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"

let codexProbe: CommandProbe | null = null
let claudeCodeProbe: CommandProbe | null = null
let openCodeProbe: CommandProbe | null = null

export function getSandboxLocalSettingsError({
  environment,
  label,
  useLocalSettings,
}: {
  environment: AgentRunInput["environment"]
  label: string
  useLocalSettings: boolean
}) {
  return environment === "remote" && useLocalSettings
    ? `${label} cannot use this Mac's local CLI settings inside a Sandbox. Select Modelverse in Agent model settings, or use a local workspace.`
    : null
}

function bundledOpenCodeEnv() {
  const explicitDb = process.env.OPENCODE_DB?.trim()

  if (explicitDb) {
    return undefined
  }

  // Keep the bundled CLI off a user's legacy opencode.db; older schemas can
  // fail during ACP startup before OpenCode can create a session.
  return {
    OPENCODE_DB:
      process.env.ASTRAFLOW_OPENCODE_DB?.trim() || "astraflow-opencode.db",
  }
}

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function isReadable(path: string) {
  try {
    accessSync(path, constants.R_OK)
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

function resolveNodeModulesBin(name: string) {
  for (const executableName of executableNames(name)) {
    const candidate = join(
      process.cwd(),
      "node_modules",
      ".bin",
      executableName
    )

    if (isExecutable(candidate)) {
      return realpathSync(candidate)
    }
  }

  return null
}

function resolveNodePackageScript(
  packageName: string,
  relativeScriptPath: string
): AcpStdioCommandSpec | null {
  const nodeModulesRoot =
    process.env.ASTRAFLOW_BUNDLED_NODE_MODULES?.trim() ||
    join(process.cwd(), "node_modules")
  const scriptPath = join(
    /* turbopackIgnore: true */ nodeModulesRoot,
    ...packageName.split("/"),
    relativeScriptPath
  )

  if (!isReadable(scriptPath)) {
    return null
  }

  return {
    command: process.execPath,
    args: [scriptPath],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
    },
  }
}

function resolveNodePackageExecutable(
  packageName: string,
  relativeExecutablePath: string
) {
  const nodeModulesRoot =
    process.env.ASTRAFLOW_BUNDLED_NODE_MODULES?.trim() ||
    join(process.cwd(), "node_modules")
  const archiveMarker = `${sep}app.asar${sep}`
  const unpackedNodeModulesRoot = nodeModulesRoot.includes(archiveMarker)
    ? nodeModulesRoot.replace(archiveMarker, `${sep}app.asar.unpacked${sep}`)
    : nodeModulesRoot
  const executablePath = join(
    /* turbopackIgnore: true */ unpackedNodeModulesRoot,
    ...packageName.split("/"),
    relativeExecutablePath
  )

  return isExecutable(executablePath) ? realpathSync(executablePath) : null
}

function fingerprintSecret(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12)
}

function withCodexPermissionModeEnv(
  command: AcpCommandSpec,
  input: AgentRunInput
) {
  return mergeExternalAcpCommandEnv(command, {
    INITIAL_AGENT_MODE: getCodexAcpInitialMode(input.permissionMode),
  })
}

function resolveAcpSessionKey(runtimeId: string, input: AgentRunInput) {
  const runtimeSetting = getRuntimeModelSetting(runtimeId)
  const config = getExternalAcpModelverseRunConfig(runtimeId, input)

  if (!runtimeSetting || runtimeSetting.useLocalSettings || !config) {
    return ["local-settings", input.permissionMode].join(":")
  }

  return [
    config.endpoint.providerId,
    config.endpoint.channel,
    config.endpoint.fingerprint,
    config.model.id,
    config.model.providerModel,
    config.model.protocol,
    fingerprintSecret(config.apiKey),
    input.permissionMode,
  ].join(":")
}

function resolveStudioSessionPlugins(
  runtimeId: AgentRuntimeInfo["id"],
  input: AgentRunInput
) {
  return createStudioAcpSessionPlugins({
    environment: input.environment === "remote" ? "remote" : "local",
    runtimeId,
    sessionId: input.sessionId,
  })
}

export function resolveClaudeCodeAcpSessionMeta() {
  return {
    claudeCode: {
      emitRawSDKMessages: [
        { type: "active_goal" },
        { type: "auth_status" },
        { type: "conversation_reset" },
        { type: "prompt_suggestion" },
        { type: "tool_use_summary" },
        { type: "system", subtype: "api_retry" },
        { type: "system", subtype: "background_tasks_changed" },
        { type: "system", subtype: "files_persisted" },
        { type: "system", subtype: "hook_progress" },
        { type: "system", subtype: "hook_response" },
        { type: "system", subtype: "hook_started" },
        { type: "system", subtype: "mirror_error" },
        { type: "system", subtype: "notification" },
        { type: "system", subtype: "plugin_install" },
        { type: "system", subtype: "task_progress" },
        { type: "system", subtype: "task_updated" },
      ],
      options: {
        agentProgressSummaries: true,
        enableFileCheckpointing: true,
        forwardSubagentText: true,
        includeHookEvents: true,
        promptSuggestions: true,
      },
    },
  }
}

function resolveCodexAcpAdapterCommand(): AcpStdioCommandSpec | null {
  const codexAcpPath = resolveNodeModulesBin("codex-acp")

  if (codexAcpPath) {
    return { command: codexAcpPath }
  }

  return resolveNodePackageScript(
    "@agentclientprotocol/codex-acp",
    "dist/index.js"
  )
}

export function probeCodexAcpCommand(): CommandProbe {
  if (codexProbe) {
    return codexProbe
  }

  const command = resolveCodexAcpAdapterCommand()

  if (command) {
    const scriptPath = command.args?.[0] ?? command.command
    codexProbe = {
      available: true,
      command,
      detail: `using pinned @agentclientprotocol/codex-acp adapter at ${scriptPath}`,
    }
    return codexProbe
  }

  codexProbe = {
    available: false,
    detail: "the pinned @agentclientprotocol/codex-acp adapter is unavailable",
  }

  return codexProbe
}

export function resolveCodexAcpCommand() {
  const probe = probeCodexAcpCommand()

  return probe.available ? probe.command : null
}

export function resolveCodexAcpCommandForRun(input: AgentRunInput) {
  const command = resolveCodexAcpCommand()

  return command
    ? withCodexPermissionModeEnv(
        configureCodexAcpCommand(command, input),
        input
      )
    : null
}

export function probeClaudeCodeAcpCommand(): CommandProbe {
  if (claudeCodeProbe) {
    return claudeCodeProbe
  }

  const claudeAgentAcpBin = resolveNodeModulesBin("claude-agent-acp")
  const claudeAgentAcpScript =
    resolveNodePackageScript(
      "@agentclientprotocol/claude-agent-acp",
      "dist/index.js"
    ) ?? (claudeAgentAcpBin ? { command: claudeAgentAcpBin } : null)

  if (!claudeAgentAcpScript) {
    claudeCodeProbe = {
      available: false,
      detail: "@agentclientprotocol/claude-agent-acp is not available",
    }
    return claudeCodeProbe
  }

  const scriptPath =
    claudeAgentAcpScript.args?.[0] ?? claudeAgentAcpScript.command
  claudeCodeProbe = {
    available: true,
    command: claudeAgentAcpScript,
    detail: `using ${scriptPath}`,
  }

  return claudeCodeProbe
}

export function resolveClaudeCodeAcpCommand() {
  const probe = probeClaudeCodeAcpCommand()

  return probe.available ? probe.command : null
}

export function probeOpenCodeAcpCommand(): CommandProbe {
  if (openCodeProbe?.available) {
    return openCodeProbe
  }

  const bundledOpenCodePath = resolveNodePackageExecutable(
    "opencode-ai",
    "bin/opencode.exe"
  )
  const configuredOpenCodePath =
    process.env.ASTRAFLOW_OPENCODE_EXECUTABLE?.trim()
  const openCodePath =
    (configuredOpenCodePath && isExecutable(configuredOpenCodePath)
      ? realpathSync(configuredOpenCodePath)
      : null) ??
    bundledOpenCodePath ??
    (isExecutable(`${process.env.HOME ?? ""}/.opencode/bin/opencode`)
      ? realpathSync(`${process.env.HOME}/.opencode/bin/opencode`)
      : null) ??
    findExecutableOnPath("opencode")

  if (!openCodePath) {
    return {
      available: false,
      detail: "OpenCode executable was not found",
    }
  }

  const openCodeEnv =
    openCodePath === bundledOpenCodePath ? bundledOpenCodeEnv() : undefined

  openCodeProbe = {
    available: true,
    command: {
      command: openCodePath,
      args: ["acp"],
      ...(openCodeEnv ? { env: openCodeEnv } : {}),
    },
    detail: `using local OpenCode ACP stdio command at ${openCodePath}`,
  }

  return openCodeProbe
}

export function resolveOpenCodeAcpCommand() {
  const probe = probeOpenCodeAcpCommand()

  return probe.available ? probe.command : null
}

export function resolveOpenCodeAcpCommandForRun(input: AgentRunInput) {
  const command = resolveOpenCodeAcpCommand()

  return command ? configureOpenCodeAcpCommand(command, input) : null
}

export function resolveClaudeCodeAcpCommandForRun(input: AgentRunInput) {
  const command = resolveClaudeCodeAcpCommand()

  if (!command) {
    return null
  }

  return configureClaudeCodeAcpCommand(command, input)
}

function registerAcpRuntime(info: AgentRuntimeInfo) {
  const resolveLocalCommand =
    info.id === "codex"
      ? resolveCodexAcpCommandForRun
      : info.id === "claude-code"
        ? resolveClaudeCodeAcpCommandForRun
        : (input: AgentRunInput) => {
            return resolveOpenCodeAcpCommandForRun(input)
          }
  const resolveCommand = async (input: AgentRunInput) => {
    const sandboxSettingsError = getSandboxLocalSettingsError({
      environment: input.environment,
      label: info.label,
      useLocalSettings:
        getRuntimeModelSetting(info.id)?.useLocalSettings === true,
    })

    if (sandboxSettingsError) {
      throw new Error(sandboxSettingsError)
    }

    if (getRuntimeModelSetting(info.id)?.useLocalSettings !== true) {
      await resolveCompShareEntitledModel(input.model)
    }

    const command = resolveLocalCommand(input)

    if (!command || input.environment !== "remote") {
      return command
    }

    if (command.transport === "http" || command.transport === "websocket") {
      throw new Error(
        `${info.label} cannot reuse a non-stdio ACP command inside the Sandbox.`
      )
    }

    const connection = await createStudioRemoteAgentConnection({
      sessionId: input.sessionId,
      runtimeId: info.id,
      env: command.env,
    })

    return {
      transport: "websocket" as const,
      url: connection.websocketUrl,
    }
  }
  const resolveSessionPlugins = (input: AgentRunInput) =>
    resolveStudioSessionPlugins(info.id, input)
  const resolveSessionKey = (input: AgentRunInput) =>
    resolveAcpSessionKey(info.id, input)
  const resolveSessionMeta =
    info.id === "claude-code"
      ? () => resolveClaudeCodeAcpSessionMeta()
      : undefined

  registerAgentRuntime(
    new AcpRuntime({
      info,
      resolveCommand,
      ...(resolveSessionMeta ? { resolveSessionMeta } : {}),
      resolveSessionPlugins,
      resolveSessionKey,
    })
  )

  if (ACP_RUNTIME_DEBUG) {
    const probe =
      info.id === "codex"
        ? probeCodexAcpCommand()
        : info.id === "claude-code"
          ? probeClaudeCodeAcpCommand()
          : probeOpenCodeAcpCommand()

    console.info("[studio-chat:acp] runtime_registered", {
      runtimeId: info.id,
      detail: probe.detail,
    })
  }
}

registerAcpRuntime({
  id: "codex",
  label: "Codex",
  description: "OpenAI Codex via Agent Client Protocol",
  capabilities: ACP_RUNTIME_CAPABILITIES,
  composer: ACP_COMPOSER_CAPABILITIES,
})

registerAcpRuntime({
  id: "claude-code",
  label: "Claude Code",
  description: "Claude Code via Agent Client Protocol",
  capabilities: CLAUDE_CODE_RUNTIME_CAPABILITIES,
  composer: ACP_COMPOSER_CAPABILITIES,
})

registerAcpRuntime({
  id: "opencode",
  label: "OpenCode",
  description: "OpenCode via Agent Client Protocol",
  capabilities: ACP_RUNTIME_CAPABILITIES,
  composer: ACP_COMPOSER_CAPABILITIES,
})
