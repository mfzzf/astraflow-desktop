import {
  MODELVERSE_ANTHROPIC_BASE_URL,
  MODELVERSE_OPENAI_BASE_URL,
  MODELVERSE_PROVIDER_ID,
  getRuntimeModelSetting,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import type { AcpCommandSpec } from "@/lib/agent/acp/acp-runtime"
import { applyClaudeCodeLocalProcessSandbox } from "@/lib/agent/adapters/claude-code-local-sandbox"
import {
  applyOpenCodeLocalProcessSandbox,
  createOpenCodePermissionConfig,
} from "@/lib/agent/adapters/opencode-local-sandbox"
import { createAgentProviderProxyCredential } from "@/lib/agent/provider-proxy"
import type { AgentRunInput } from "@/lib/agent/runtime"
import { getStudioModelverseApiKey } from "@/lib/studio-db"

type ExternalAcpModelverseRunConfig = {
  apiKey: string
  model: AgentModelDefinition
}

export type ExternalAcpRunConfigDependencies = {
  resolveModelverseRunConfig?: (
    runtimeId: string,
    input: AgentRunInput
  ) => ExternalAcpModelverseRunConfig | null
}

export function mergeExternalAcpCommandEnv(
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

function bindProviderProxyToken(
  command: AcpCommandSpec,
  token: string | null,
  transport: "environment" | "fd3" = "environment"
): AcpCommandSpec {
  if (!token) {
    return command
  }

  if (command.transport === "http" || command.transport === "websocket") {
    throw new Error(
      "A Desktop provider credential can only be bound to a local stdio Agent process."
    )
  }

  return {
    ...command,
    providerProxyToken: token,
    providerProxyTokenTransport: transport,
  }
}

function createLocalProviderProxy({
  apiKey,
  baseUrl,
  input,
  protocol,
  runtimeId,
}: {
  apiKey: string
  baseUrl: string
  input: AgentRunInput
  protocol: AgentModelDefinition["protocol"]
  runtimeId: string
}) {
  return input.environment === "remote"
    ? null
    : createAgentProviderProxyCredential({
        sessionId: input.sessionId,
        apiKey,
        authMode: "bearer",
        baseUrl,
        protocol,
        scopeId: `${runtimeId}:${input.permissionMode}`,
      })
}

export function getExternalAcpModelverseRunConfig(
  runtimeId: string,
  input: AgentRunInput
) {
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
  return {
    model: model.providerModel,
    model_provider: MODELVERSE_PROVIDER_ID,
    model_providers: {
      [MODELVERSE_PROVIDER_ID]: {
        name: "Modelverse",
        base_url: model.baseUrl ?? MODELVERSE_OPENAI_BASE_URL,
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

function createOpenCodeConfig(
  model: AgentModelDefinition | null,
  permissionMode: AgentRunInput["permissionMode"],
  apiKeyReference = "{file:/dev/fd/3}"
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

  return {
    model: `${providerId}/${model.providerModel}`,
    permission,
    small_model: `${providerId}/${model.providerModel}`,
    provider: {
      [providerId]: {
        npm: providerPackage,
        name: isAnthropic ? "Modelverse Anthropic" : "Modelverse OpenAI",
        options: {
          apiKey: apiKeyReference,
          baseURL: getOpenCodeBaseUrl(model),
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

export function configureCodexAcpCommand(
  command: AcpCommandSpec,
  input: AgentRunInput,
  dependencies: ExternalAcpRunConfigDependencies = {}
) {
  const config = dependencies.resolveModelverseRunConfig
    ? dependencies.resolveModelverseRunConfig("codex", input)
    : getExternalAcpModelverseRunConfig("codex", input)

  if (!config) {
    return command
  }

  requireProtocol(config.model, ["openai-chat", "openai-responses"])
  const providerProxy = createLocalProviderProxy({
    apiKey: config.apiKey,
    baseUrl: config.model.baseUrl ?? MODELVERSE_OPENAI_BASE_URL,
    input,
    protocol: config.model.protocol,
    runtimeId: "codex",
  })
  const apiKey = providerProxy?.apiKey ?? config.apiKey
  const model = providerProxy
    ? { ...config.model, baseUrl: providerProxy.baseUrl }
    : config.model

  return bindProviderProxyToken(
    mergeExternalAcpCommandEnv(command, {
      ASTRAFLOW_MODELVERSE_API_KEY: apiKey,
      CODEX_API_KEY: apiKey,
      CODEX_CONFIG: JSON.stringify(createCodexConfig(model)),
      DEFAULT_AUTH_REQUEST: JSON.stringify({ methodId: "api-key" }),
      MODEL_PROVIDER: MODELVERSE_PROVIDER_ID,
      NO_BROWSER: "1",
      OPENAI_API_KEY: apiKey,
    }),
    providerProxy?.apiKey ?? null
  )
}

export function configureClaudeCodeAcpCommand(
  command: AcpCommandSpec,
  input: AgentRunInput,
  dependencies: ExternalAcpRunConfigDependencies = {}
) {
  const config = dependencies.resolveModelverseRunConfig
    ? dependencies.resolveModelverseRunConfig("claude-code", input)
    : getExternalAcpModelverseRunConfig("claude-code", input)
  let configured = command
  let providerEndpoint: { host: string; port: number } | null = null

  if (config) {
    requireProtocol(config.model, ["anthropic-messages"])
    const baseUrl = getModelBaseUrl(config.model)
    const providerProxy = createLocalProviderProxy({
      apiKey: config.apiKey,
      baseUrl,
      input,
      protocol: config.model.protocol,
      runtimeId: "claude-code",
    })
    const apiKey = providerProxy?.apiKey ?? config.apiKey

    configured = bindProviderProxyToken(
      mergeExternalAcpCommandEnv(command, {
        ANTHROPIC_API_KEY: undefined,
        ANTHROPIC_AUTH_TOKEN: apiKey,
        ANTHROPIC_BASE_URL: providerProxy?.baseUrl ?? baseUrl,
        ANTHROPIC_CUSTOM_HEADERS: undefined,
        CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1",
        ASTRAFLOW_MODELVERSE_API_KEY: apiKey,
        ANTHROPIC_MODEL: config.model.providerModel,
        CLAUDE_CODE_REMOTE: "1",
        CLAUDE_MODEL_CONFIG: JSON.stringify({
          availableModels: [config.model.providerModel],
        }),
        NO_BROWSER: "1",
      }),
      providerProxy?.apiKey ?? null
    )
    providerEndpoint =
      providerProxy?.providerEndpoint ??
      (input.environment === "remote"
        ? null
        : {
            host: new URL(baseUrl).hostname.toLocaleLowerCase("en-US"),
            port: new URL(baseUrl).protocol === "https:" ? 443 : 80,
          })
  }

  return applyClaudeCodeLocalProcessSandbox({
    command: configured,
    input,
    providerEndpoint,
  })
}

export function configureOpenCodeAcpCommand(
  command: AcpCommandSpec,
  input: AgentRunInput,
  dependencies: ExternalAcpRunConfigDependencies = {}
) {
  const config = dependencies.resolveModelverseRunConfig
    ? dependencies.resolveModelverseRunConfig("opencode", input)
    : getExternalAcpModelverseRunConfig("opencode", input)
  const providerProxy = config
    ? createLocalProviderProxy({
        apiKey: config.apiKey,
        baseUrl:
          config.model.protocol === "anthropic-messages"
            ? getModelBaseUrl(config.model)
            : getOpenCodeBaseUrl(config.model),
        input,
        protocol: config.model.protocol,
        runtimeId: "opencode",
      })
    : null
  const model =
    config && providerProxy
      ? { ...config.model, baseUrl: providerProxy.baseUrl }
      : (config?.model ?? null)
  if (
    config &&
    input.environment !== "remote" &&
    process.platform === "win32"
  ) {
    throw new Error(
      "Managed OpenCode is blocked on Windows because secure anonymous provider credential transport is unavailable. Use local OpenCode settings or run OpenCode in a remote Sandbox."
    )
  }
  const configured = bindProviderProxyToken(
    mergeExternalAcpCommandEnv(command, {
      ...(config && input.environment === "remote"
        ? {
            // The remote Workspace Gateway consumes this bootstrap credential
            // before spawn and passes only a scoped proxy token over an
            // anonymous descriptor. It never reaches the OpenCode environment.
            ASTRAFLOW_MODELVERSE_API_KEY: config.apiKey,
          }
        : {}),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(
        createOpenCodeConfig(model, input.permissionMode)
      ),
    }),
    providerProxy?.apiKey ?? null,
    config ? "fd3" : "environment"
  )

  return applyOpenCodeLocalProcessSandbox({
    command: configured,
    input,
    providerEndpoint: providerProxy?.providerEndpoint ?? null,
  })
}
