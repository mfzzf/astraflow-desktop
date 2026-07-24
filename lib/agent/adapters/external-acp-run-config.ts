import {
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
import type { ProviderProxyTokenTransport } from "@/lib/agent/provider-credential-transport"
import type { AgentRunInput } from "@/lib/agent/runtime"
import {
  resolveModelProviderDataPlane,
  resolveModelProviderEndpoint,
  resolveModelProviderOpenCodeBaseUrl,
  type ModelProviderEndpoint,
} from "@/lib/model-provider-config"

type ExternalAcpModelverseRunConfig = {
  apiKey: string
  endpoint?: ModelProviderEndpoint
  model: AgentModelDefinition
}

export type ExternalAcpRunConfigDependencies = {
  platform?: NodeJS.Platform
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
  transport: ProviderProxyTokenTransport = "environment",
  path?: string
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
    ...(path ? { providerProxyTokenPath: path } : {}),
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

  const dataPlane = resolveModelProviderDataPlane()
  const apiKey = dataPlane.apiKey

  if (!apiKey) {
    throw new Error(
      `${dataPlane.providerName} API key is not configured locally.`
    )
  }

  const model = resolveAgentModelForRuntime({
    modelId: input.model,
    runtimeId,
  })

  if (!model) {
    throw new Error(
      `No ${dataPlane.providerName} model is configured for ${runtimeId}.`
    )
  }

  return {
    apiKey,
    endpoint: resolveModelProviderEndpoint({
      protocol: model.protocol,
      baseUrl: model.baseUrl,
    }),
    model,
  }
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

function resolveConfigEndpoint(config: ExternalAcpModelverseRunConfig) {
  return (
    config.endpoint ??
    resolveModelProviderEndpoint({
      protocol: config.model.protocol,
      baseUrl: config.model.baseUrl,
      channel: "modelverse",
    })
  )
}

function createCodexConfig(
  model: AgentModelDefinition,
  endpoint: ModelProviderEndpoint,
  baseUrl = endpoint.baseUrl
) {
  return {
    model: model.providerModel,
    model_provider: endpoint.providerId,
    model_providers: {
      [endpoint.providerId]: {
        name: endpoint.providerName,
        base_url: baseUrl,
        env_key: "ASTRAFLOW_MODELVERSE_API_KEY",
        wire_api: "responses",
      },
    },
  }
}

function createOpenCodeConfig(
  model: AgentModelDefinition | null,
  permissionMode: AgentRunInput["permissionMode"],
  apiKeyReference = "{file:/dev/fd/3}",
  configuredEndpoint?: ModelProviderEndpoint
) {
  const permission = createOpenCodePermissionConfig(permissionMode)

  if (!model) {
    return { permission }
  }

  const isAnthropic = model.protocol === "anthropic-messages"
  const isOpenAIResponses = model.protocol === "openai-responses"
  const endpoint = resolveModelProviderEndpoint({
    protocol: model.protocol,
    baseUrl: model.baseUrl,
    channel: configuredEndpoint?.channel,
  })
  const providerId = `${endpoint.providerId}-${isAnthropic ? "anthropic" : "openai"}`
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
        name: `${endpoint.providerName} ${isAnthropic ? "Anthropic" : "OpenAI"}`,
        options: {
          apiKey: apiKeyReference,
          baseURL: resolveModelProviderOpenCodeBaseUrl(endpoint),
          ...(isAnthropic
            ? {
                headers: {
                  Authorization: `Bearer ${apiKeyReference}`,
                },
              }
            : {}),
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
  const endpoint = resolveConfigEndpoint(config)
  const providerProxy = createLocalProviderProxy({
    apiKey: config.apiKey,
    baseUrl: endpoint.baseUrl,
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
      CODEX_CONFIG: JSON.stringify(
        createCodexConfig(
          model,
          endpoint,
          providerProxy?.baseUrl ?? endpoint.baseUrl
        )
      ),
      DEFAULT_AUTH_REQUEST: JSON.stringify({ methodId: "api-key" }),
      MODEL_PROVIDER: endpoint.providerId,
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
    const endpoint = resolveConfigEndpoint(config)
    const baseUrl = endpoint.baseUrl
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
    ? (() => {
        const endpoint = resolveConfigEndpoint(config)

        return createLocalProviderProxy({
          apiKey: config.apiKey,
          baseUrl:
            endpoint.protocol === "anthropic-messages"
              ? endpoint.baseUrl
              : resolveModelProviderOpenCodeBaseUrl(endpoint),
          input,
          protocol: config.model.protocol,
          runtimeId: "opencode",
        })
      })()
    : null
  const model =
    config && providerProxy
      ? { ...config.model, baseUrl: providerProxy.baseUrl }
      : (config?.model ?? null)
  const endpoint = config ? resolveConfigEndpoint(config) : undefined
  const useMaskedLocalCredential = Boolean(config && providerProxy)
  const providerCredentialReference = useMaskedLocalCredential
    ? "{env:ASTRAFLOW_MODELVERSE_API_KEY}"
    : "{file:/dev/fd/3}"
  const configured = bindProviderProxyToken(
    mergeExternalAcpCommandEnv(command, {
      ...(config && (input.environment === "remote" || providerProxy)
        ? {
            // Local sandboxing replaces the scoped token with a sentinel and
            // injects the real value only on provider-proxy egress. The remote
            // Workspace Gateway consumes the bootstrap credential before spawn.
            ASTRAFLOW_MODELVERSE_API_KEY:
              providerProxy?.apiKey ?? config.apiKey,
          }
        : {}),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(
        createOpenCodeConfig(
          model,
          input.permissionMode,
          providerCredentialReference,
          endpoint
        )
      ),
    }),
    providerProxy?.apiKey ?? null,
    useMaskedLocalCredential ? "environment" : "fd3"
  )

  return applyOpenCodeLocalProcessSandbox({
    command: configured,
    input,
    providerEndpoint: providerProxy?.providerEndpoint ?? null,
  })
}
