import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import type { Api, Model, ThinkingLevelMap } from "@earendil-works/pi-ai"
import {
  AuthStorage,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent"

import {
  getAgentModelById,
  MODELVERSE_ANTHROPIC_BASE_URL,
  MODELVERSE_OPENAI_BASE_URL,
} from "@/lib/agent-model-settings"
import type { AgentModelProtocol } from "@/lib/agent-model-settings-shared"
import {
  getChatModelConfig,
  isBuiltInChatModel,
  resolveChatReasoningEffort,
  type ChatReasoningEffort,
  type ChatReasoningMode,
  type SupportedChatModel,
} from "@/lib/chat-models"
import { ASTRAFLOW_CLIENT_HEADERS } from "@/lib/review-client"

const PI_MODELVERSE_PROVIDER_ID = "astraflow-modelverse"
const FALLBACK_CONTEXT_WINDOW = 200_000
const DEFAULT_MAX_OUTPUT_TOKENS = 32_768

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function normalizeAnthropicBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/v1\/?$/i, "")
}

export function mapModelverseProtocolToPiApi(
  protocol: AgentModelProtocol
): Api {
  if (protocol === "anthropic-messages") {
    return "anthropic-messages"
  }

  return protocol === "openai-responses"
    ? "openai-responses"
    : "openai-completions"
}

function resolveThinkingFormat(reasoningMode: ChatReasoningMode | null) {
  switch (reasoningMode) {
    case "glm_reasoning_effort":
    case "glm_thinking":
    case "kimi_thinking":
      return "zai" as const
    case "deepseek_reasoning_effort":
    case "qwen_thinking":
      return "qwen" as const
    default:
      return "openai" as const
  }
}

function isKimiK3ProviderModel(providerModel: string) {
  return providerModel.toLowerCase().split("/").at(-1) === "kimi-k3"
}

export function createModelverseOpenAICompat(
  reasoningMode: ChatReasoningMode | null,
  providerModel: string
) {
  const compat = {
    thinkingFormat: resolveThinkingFormat(reasoningMode),
    supportsReasoningEffort:
      reasoningMode === "glm_reasoning_effort" ||
      reasoningMode === "deepseek_reasoning_effort" ||
      reasoningMode === "openai_reasoning_effort",
    supportsUsageInStreaming: true,
  }

  if (!isKimiK3ProviderModel(providerModel)) {
    return compat
  }

  return {
    ...compat,
    maxTokensField: "max_tokens" as const,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsStore: false,
    supportsStrictMode: false,
  }
}

const PI_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly ThinkingLevel[]

function createThinkingLevelMap(
  efforts: readonly ChatReasoningEffort[]
): ThinkingLevelMap | undefined {
  if (efforts.every((effort) => effort === "none")) {
    return undefined
  }

  const supported = new Map<ThinkingLevel, string>()

  if (efforts.includes("none")) {
    supported.set("off", "none")
  }

  for (const level of [
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ] as const) {
    if (efforts.includes(level)) {
      supported.set(level, level)
    }
  }

  // AstraFlow's boolean `enabled` setting has no strength. Pi's medium level
  // is the neutral representation; qwen/zai compatibility turns it into the
  // provider's boolean thinking switch.
  if (efforts.includes("enabled")) {
    supported.set("medium", "medium")
  }

  return Object.fromEntries(
    PI_THINKING_LEVELS.map((level) => [level, supported.get(level) ?? null])
  )
}

export function mapAstraFlowReasoningEffortToPi(
  effort: ChatReasoningEffort
): ThinkingLevel {
  if (effort === "none") {
    return "off"
  }

  return effort === "enabled" ? "medium" : effort
}

export function createModelversePiPayloadTransform(
  reasoningMode: ChatReasoningMode | null,
  reasoningEffort: ChatReasoningEffort
) {
  if (
    reasoningMode !== "deepseek_reasoning_effort" ||
    reasoningEffort === "none"
  ) {
    return undefined
  }

  const effort = reasoningEffort === "max" ? "max" : "high"

  return (payload: unknown) => {
    const record = getRecord(payload)

    return record ? { ...record, reasoning_effort: effort } : payload
  }
}

export type ModelversePiRuntime = {
  authStorage: AuthStorage
  model: Model<Api>
  modelRegistry: ModelRegistry
  payloadTransform?: (payload: unknown) => unknown
  thinkingLevel: ThinkingLevel
}

export function createModelversePiRuntime({
  apiKey,
  model,
  requestedReasoningEffort,
}: {
  apiKey: string
  model: SupportedChatModel
  requestedReasoningEffort: ChatReasoningEffort
}): ModelversePiRuntime {
  const agentModel = getAgentModelById(model)
  const builtInConfig = isBuiltInChatModel(model)
    ? getChatModelConfig(model)
    : null

  if (!agentModel && !builtInConfig) {
    throw new Error(`AstraFlow model is not configured: ${model}`)
  }

  const protocol =
    agentModel?.protocol ?? builtInConfig?.protocol ?? "openai-chat"
  const api = mapModelverseProtocolToPiApi(protocol)
  const reasoningEfforts =
    agentModel?.reasoningEfforts ?? builtInConfig?.reasoningEfforts ?? ["none"]
  const defaultReasoningEffort =
    agentModel?.defaultReasoningEffort ??
    builtInConfig?.defaultReasoningEffort ??
    "none"
  const reasoningEffort = reasoningEfforts.includes(requestedReasoningEffort)
    ? requestedReasoningEffort
    : builtInConfig
      ? resolveChatReasoningEffort(model, requestedReasoningEffort)
      : defaultReasoningEffort
  const contextWindow =
    builtInConfig && builtInConfig.contextWindow > 0
      ? builtInConfig.contextWindow
      : FALLBACK_CONTEXT_WINDOW
  const reasoningMode = builtInConfig?.reasoningMode ?? null
  const providerModel =
    agentModel?.providerModel ?? builtInConfig?.providerModel ?? model
  const configuredBaseUrl =
    agentModel?.baseUrl ??
    (protocol === "anthropic-messages"
      ? MODELVERSE_ANTHROPIC_BASE_URL
      : MODELVERSE_OPENAI_BASE_URL)
  const baseUrl =
    protocol === "anthropic-messages"
      ? normalizeAnthropicBaseUrl(configuredBaseUrl)
      : configuredBaseUrl
  const compat =
    api === "anthropic-messages"
      ? {
          forceAdaptiveThinking: reasoningEffort !== "none",
        }
      : api === "openai-completions"
        ? createModelverseOpenAICompat(reasoningMode, providerModel)
        : undefined
  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(PI_MODELVERSE_PROVIDER_ID, apiKey)
  const modelRegistry = ModelRegistry.inMemory(authStorage)

  modelRegistry.registerProvider(PI_MODELVERSE_PROVIDER_ID, {
    api,
    apiKey,
    baseUrl,
    headers: {
      ...ASTRAFLOW_CLIENT_HEADERS,
    },
    models: [
      {
        id: agentModel?.providerModel ?? builtInConfig?.providerModel ?? model,
        name: agentModel?.label ?? builtInConfig?.label ?? model,
        api,
        baseUrl,
        reasoning: reasoningEfforts.some((effort) => effort !== "none"),
        thinkingLevelMap: createThinkingLevelMap(reasoningEfforts),
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow,
        maxTokens: Math.min(contextWindow, DEFAULT_MAX_OUTPUT_TOKENS),
        compat,
        headers: {
          ...ASTRAFLOW_CLIENT_HEADERS,
        },
      },
    ],
  })

  const piModel = modelRegistry.find(PI_MODELVERSE_PROVIDER_ID, providerModel)

  if (!piModel) {
    throw new Error(`Pi could not register AstraFlow model: ${model}`)
  }

  const payloadTransform = createModelversePiPayloadTransform(
    reasoningMode,
    reasoningEffort
  )

  return {
    authStorage,
    model: piModel,
    modelRegistry,
    ...(payloadTransform ? { payloadTransform } : {}),
    thinkingLevel: mapAstraFlowReasoningEffortToPi(reasoningEffort),
  }
}
