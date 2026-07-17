import { spawnSync } from "node:child_process"
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
  MODELVERSE_ANTHROPIC_BASE_URL,
  MODELVERSE_OPENAI_BASE_URL,
  MODELVERSE_PROVIDER_ID,
  getRuntimeModelSetting,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import {
  registerAgentRuntime,
  type AgentRuntimeInfo,
  type AgentRunInput,
} from "@/lib/agent/runtime"
import { getCodexAcpInitialMode } from "@/lib/agent/permission-policy"
import { getStudioModelverseApiKey } from "@/lib/studio-db"
import { createStudioRemoteAgentConnection } from "@/lib/studio-remote-workspace"

type CommandProbe =
  | { available: true; command: AcpCommandSpec; detail: string }
  | { available: false; detail: string }

const ACP_RUNTIME_CAPABILITIES = {
  hitl: true,
  resume: true,
  subagents: false,
  plan: true,
  sandbox: false,
  mcp: true,
  skills: true,
  compact: true,
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
    ? nodeModulesRoot.replace(
        archiveMarker,
        `${sep}app.asar.unpacked${sep}`
      )
    : nodeModulesRoot
  const executablePath = join(
    /* turbopackIgnore: true */ unpackedNodeModulesRoot,
    ...packageName.split("/"),
    relativeExecutablePath
  )

  return isExecutable(executablePath) ? realpathSync(executablePath) : null
}

function mergeCommandEnv(
  command: AcpCommandSpec,
  env: Record<string, string | undefined>
): AcpCommandSpec {
  if (command.transport === "http" || command.transport === "websocket") {
    return command
  }

  return {
    ...command,
    args: command.args ? [...command.args] : undefined,
    env: {
      ...(command.env ?? {}),
      ...env,
    },
  }
}

function getModelverseRunConfig(runtimeId: string, input: AgentRunInput) {
  const runtimeSetting = getRuntimeModelSetting(runtimeId)

  if (!runtimeSetting || runtimeSetting.useLocalSettings) {
    return null
  }

  const apiKey = getStudioModelverseApiKey()?.key

  if (!apiKey) {
    throw new Error("Modelverse API key is not configured locally.")
  }

  const model = resolveAgentModelForRuntime({
    modelId: input.model,
    runtimeId,
  })

  if (!model) {
    throw new Error(`No Modelverse model is configured for ${runtimeId}.`)
  }

  return { apiKey, model }
}

function requireProtocol(
  model: AgentModelDefinition,
  protocols: AgentModelDefinition["protocol"][]
) {
  if (!protocols.includes(model.protocol)) {
    throw new Error(
      `${model.label} does not support the selected agent protocol.`
    )
  }
}

function createCodexConfig(model: AgentModelDefinition) {
  const baseUrl = model.baseUrl ?? MODELVERSE_OPENAI_BASE_URL

  return {
    model: model.providerModel,
    model_provider: MODELVERSE_PROVIDER_ID,
    model_providers: {
      [MODELVERSE_PROVIDER_ID]: {
        name: "Modelverse",
        base_url: baseUrl,
        env_key: "ASTRAFLOW_MODELVERSE_API_KEY",
        wire_api: "responses",
      },
    },
  }
}

function getModelBaseUrl(model: AgentModelDefinition) {
  const baseUrl =
    model.baseUrl ??
    (model.protocol === "anthropic-messages"
      ? MODELVERSE_ANTHROPIC_BASE_URL
      : MODELVERSE_OPENAI_BASE_URL)

  return model.protocol === "anthropic-messages"
    ? baseUrl.replace(/\/v1\/?$/i, "")
    : baseUrl
}

function getOpenCodeBaseUrl(model: AgentModelDefinition) {
  const baseUrl = getModelBaseUrl(model)

  return model.protocol === "anthropic-messages"
    ? `${baseUrl.replace(/\/+$/, "")}/v1`
    : baseUrl
}

function createOpenCodePermissionConfig(mode: AgentRunInput["permissionMode"]) {
  if (mode === "full_access") {
    return "allow"
  }

  if (mode === "readonly") {
    return {
      "*": "deny",
      grep: "allow",
      glob: "allow",
      read: "allow",
      question: "allow",
      skill: "allow",
      webfetch: "allow",
      websearch: "allow",
    }
  }

  if (mode === "auto") {
    return {
      "*": "allow",
      bash: {
        "*": "allow",
        "chmod *": "ask",
        "chown *": "ask",
        "curl * | *": "ask",
        "dd *": "ask",
        "docker *": "ask",
        "fdisk *": "ask",
        "git clean *": "ask",
        "git push *": "ask",
        "git rebase *": "ask",
        "git reset --hard *": "ask",
        "helm *": "ask",
        "kubectl *": "ask",
        "launchctl *": "ask",
        "mkfs *": "ask",
        "mount *": "ask",
        "npm publish *": "ask",
        "parted *": "ask",
        "pkill *": "ask",
        "podman *": "ask",
        "rm -rf *": "ask",
        "rm -fr *": "ask",
        "sudo *": "ask",
        "systemctl *": "ask",
        "terraform *": "ask",
        "tofu *": "ask",
        "umount *": "ask",
        "wget * | *": "ask",
      },
      doom_loop: "ask",
      edit: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "**/.aws/**": "ask",
        "**/.docker/config.json": "ask",
        "**/.gnupg/**": "ask",
        "**/.ssh/**": "ask",
        "/etc/**": "ask",
      },
      external_directory: "ask",
      read: {
        "*": "allow",
        "*.env": "ask",
        "*.env.*": "ask",
        "*.env.example": "allow",
        "**/.aws/**": "ask",
        "**/.docker/config.json": "ask",
        "**/.gnupg/**": "ask",
        "**/.ssh/**": "ask",
      },
    }
  }

  return {
    "*": "ask",
    grep: "allow",
    glob: "allow",
    read: "allow",
  }
}

function createOpenCodeConfig(
  model: AgentModelDefinition | null,
  permissionMode: AgentRunInput["permissionMode"]
) {
  const permission = createOpenCodePermissionConfig(permissionMode)

  if (!model) {
    return { permission }
  }

  const isAnthropic = model.protocol === "anthropic-messages"
  const isOpenAIResponses = model.protocol === "openai-responses"
  const providerId = isAnthropic ? "modelverse-anthropic" : "modelverse-openai"
  const providerPackage = isAnthropic
    ? "@ai-sdk/anthropic"
    : isOpenAIResponses
      ? "@ai-sdk/openai"
      : "@ai-sdk/openai-compatible"
  const baseURL = getOpenCodeBaseUrl(model)

  return {
    model: `${providerId}/${model.providerModel}`,
    permission,
    small_model: `${providerId}/${model.providerModel}`,
    provider: {
      [providerId]: {
        npm: providerPackage,
        name: isAnthropic ? "Modelverse Anthropic" : "Modelverse OpenAI",
        options: {
          apiKey: "{env:ASTRAFLOW_MODELVERSE_API_KEY}",
          baseURL,
        },
        models: {
          [model.providerModel]: {
            name: model.label,
          },
        },
      },
    },
  }
}

function fingerprintSecret(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12)
}

function withCodexModelverseConfig(
  command: AcpCommandSpec,
  input: AgentRunInput
) {
  const config = getModelverseRunConfig("codex", input)

  if (!config) {
    return command
  }

  requireProtocol(config.model, ["openai-chat", "openai-responses"])

  return mergeCommandEnv(command, {
    ASTRAFLOW_MODELVERSE_API_KEY: config.apiKey,
    CODEX_API_KEY: config.apiKey,
    CODEX_CONFIG: JSON.stringify(createCodexConfig(config.model)),
    DEFAULT_AUTH_REQUEST: JSON.stringify({ methodId: "api-key" }),
    MODEL_PROVIDER: MODELVERSE_PROVIDER_ID,
    NO_BROWSER: "1",
    OPENAI_API_KEY: config.apiKey,
  })
}

function withCodexPermissionModeEnv(
  command: AcpCommandSpec,
  input: AgentRunInput
) {
  return mergeCommandEnv(command, {
    INITIAL_AGENT_MODE: getCodexAcpInitialMode(input.permissionMode),
  })
}

function withClaudeCodeModelverseConfig(
  command: AcpCommandSpec,
  input: AgentRunInput
) {
  const config = getModelverseRunConfig("claude-code", input)

  if (!config) {
    return command
  }

  requireProtocol(config.model, ["anthropic-messages"])

  return mergeCommandEnv(command, {
    ANTHROPIC_AUTH_TOKEN: config.apiKey,
    ANTHROPIC_BASE_URL: getModelBaseUrl(config.model),
    ANTHROPIC_MODEL: config.model.providerModel,
    CLAUDE_CODE_REMOTE: "1",
    CLAUDE_MODEL_CONFIG: JSON.stringify({
      availableModels: [config.model.providerModel],
    }),
    NO_BROWSER: "1",
  })
}

function withOpenCodeRuntimeConfig(
  command: AcpCommandSpec,
  input: AgentRunInput
) {
  const config = getModelverseRunConfig("opencode", input)
  const openCodeConfig = JSON.stringify(
    createOpenCodeConfig(config?.model ?? null, input.permissionMode)
  )

  return mergeCommandEnv(command, {
    ...(config ? { ASTRAFLOW_MODELVERSE_API_KEY: config.apiKey } : {}),
    OPENCODE_CONFIG_CONTENT: openCodeConfig,
  })
}

function resolveAcpSessionKey(runtimeId: string, input: AgentRunInput) {
  const runtimeSetting = getRuntimeModelSetting(runtimeId)
  const config = getModelverseRunConfig(runtimeId, input)

  if (!runtimeSetting || runtimeSetting.useLocalSettings || !config) {
    return "local-settings"
  }

  return [
    MODELVERSE_PROVIDER_ID,
    config.model.id,
    config.model.providerModel,
    config.model.protocol,
    config.model.baseUrl ?? "",
    fingerprintSecret(config.apiKey),
  ].join(":")
}

function resolveModelverseSessionPlugins(
  runtimeId: AgentRuntimeInfo["id"],
  input: AgentRunInput
) {
  if (!getModelverseRunConfig(runtimeId, input)) {
    return null
  }

  return createStudioAcpSessionPlugins({
    environment: input.environment === "remote" ? "remote" : "local",
    runtimeId,
    sessionId: input.sessionId,
  })
}

function getCommandOutput(command: string, args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 3000,
  })
  const output = [result.stdout, result.stderr].join("\n").trim()

  return output || null
}

function codexCliSupportsAcp(codexPath: string) {
  const help = getCommandOutput(codexPath, ["--help"])

  return Boolean(help?.match(/^\s+acp\b/m))
}

function resolveCodexAcpAdapterCommand(): AcpCommandSpec | null {
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

  const codexPath = findExecutableOnPath("codex")

  if (codexPath && codexCliSupportsAcp(codexPath)) {
    codexProbe = {
      available: true,
      command: {
        command: codexPath,
        args: ["acp"],
      },
      detail: `using local codex ACP command at ${codexPath}`,
    }
    return codexProbe
  }

  const codexAcpPath = resolveNodeModulesBin("codex-acp")

  if (codexAcpPath) {
    codexProbe = {
      available: true,
      command: {
        command: codexAcpPath,
      },
      detail: codexPath
        ? `local codex at ${codexPath} does not advertise an acp subcommand; using ${codexAcpPath}`
        : `local codex CLI not found; using ${codexAcpPath}`,
    }
    return codexProbe
  }

  const codexAcpScript = resolveNodePackageScript(
    "@agentclientprotocol/codex-acp",
    "dist/index.js"
  )

  if (codexAcpScript) {
    const scriptPath = codexAcpScript.args?.[0] ?? "codex-acp"
    codexProbe = {
      available: true,
      command: codexAcpScript,
      detail: codexPath
        ? `local codex at ${codexPath} does not advertise an acp subcommand; using ${scriptPath}`
        : `local codex CLI not found; using ${scriptPath}`,
    }
    return codexProbe
  }

  codexProbe = {
    available: false,
    detail:
      "neither a local codex acp subcommand nor node_modules/.bin/codex-acp is available",
  }

  return codexProbe
}

export function resolveCodexAcpCommand() {
  const probe = probeCodexAcpCommand()

  return probe.available ? probe.command : null
}

function resolveCodexCommandForRun(input: AgentRunInput) {
  const runtimeSetting = getRuntimeModelSetting("codex")
  const command =
    runtimeSetting && !runtimeSetting.useLocalSettings
      ? (resolveCodexAcpAdapterCommand() ?? resolveCodexAcpCommand())
      : resolveCodexAcpCommand()

  return command
    ? withCodexPermissionModeEnv(
        withCodexModelverseConfig(command, input),
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
  if (openCodeProbe) {
    return openCodeProbe
  }

  const bundledOpenCodePath = resolveNodePackageExecutable(
    "opencode-ai",
    "bin/opencode.exe"
  )
  const openCodePath =
    (isExecutable(`${process.env.HOME ?? ""}/.opencode/bin/opencode`)
      ? realpathSync(`${process.env.HOME}/.opencode/bin/opencode`)
      : null) ??
    findExecutableOnPath("opencode") ??
    bundledOpenCodePath

  if (!openCodePath) {
    openCodeProbe = {
      available: false,
      detail: "OpenCode executable was not found",
    }
    return openCodeProbe
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

function registerAcpRuntime(info: AgentRuntimeInfo, probe: CommandProbe) {
  if (!probe.available) {
    if (ACP_RUNTIME_DEBUG) {
      console.info("[studio-chat:acp] runtime_unavailable", {
        runtimeId: info.id,
        detail: probe.detail,
      })
    }
    return
  }

  const resolveLocalCommand =
    info.id === "codex"
      ? resolveCodexCommandForRun
      : info.id === "claude-code"
        ? (input: AgentRunInput) => {
            const command = resolveClaudeCodeAcpCommand()
            return command
              ? withClaudeCodeModelverseConfig(command, input)
              : null
          }
        : (input: AgentRunInput) => {
            const command = resolveOpenCodeAcpCommand()
            return command ? withOpenCodeRuntimeConfig(command, input) : null
          }
  const resolveCommand = async (input: AgentRunInput) => {
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
    resolveModelverseSessionPlugins(info.id, input)
  const resolveSessionKey = (input: AgentRunInput) =>
    resolveAcpSessionKey(info.id, input)

  registerAgentRuntime(
    new AcpRuntime({
      info,
      resolveCommand,
      resolveSessionPlugins,
      resolveSessionKey,
    })
  )

  if (ACP_RUNTIME_DEBUG) {
    console.info("[studio-chat:acp] runtime_registered", {
      runtimeId: info.id,
      detail: probe.detail,
    })
  }
}

registerAcpRuntime(
  {
    id: "codex",
    label: "Codex",
    description: "OpenAI Codex via Agent Client Protocol",
    capabilities: ACP_RUNTIME_CAPABILITIES,
    composer: ACP_COMPOSER_CAPABILITIES,
  },
  probeCodexAcpCommand()
)

registerAcpRuntime(
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Claude Code via Agent Client Protocol",
    capabilities: ACP_RUNTIME_CAPABILITIES,
    composer: ACP_COMPOSER_CAPABILITIES,
  },
  probeClaudeCodeAcpCommand()
)

registerAcpRuntime(
  {
    id: "opencode",
    label: "OpenCode",
    description: "OpenCode via Agent Client Protocol",
    capabilities: ACP_RUNTIME_CAPABILITIES,
    composer: ACP_COMPOSER_CAPABILITIES,
  },
  probeOpenCodeAcpCommand()
)
