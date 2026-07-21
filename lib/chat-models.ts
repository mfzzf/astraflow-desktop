import type {
  AgentModelProtocol,
  AgentRuntimeId,
} from "@/lib/agent-model-settings-shared"

// Review special-client: domestic open-source text models only.
export const SUPPORTED_CHAT_MODELS = [
  "glm-5.1",
  "glm-5.2",
  "zai-org/glm-5",
  "deepseek-v4-pro",
  "qwen3.7-max",
  "kimi-k2.6",
] as const

export type BuiltInChatModel = (typeof SUPPORTED_CHAT_MODELS)[number]
export type SupportedChatModel = string

// Review special-client default: domestic open-source model.
export const DEFAULT_CHAT_MODEL: SupportedChatModel = "qwen3.7-max"

export const SUPPORTED_CHAT_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "enabled",
] as const

export type ChatReasoningEffort =
  (typeof SUPPORTED_CHAT_REASONING_EFFORTS)[number]

// Default reasoning for domestic models that support thinking toggles.
export const DEFAULT_CHAT_REASONING_EFFORT: ChatReasoningEffort = "enabled"

export type ChatReasoningMode =
  | "openai_reasoning_effort"
  | "anthropic_output_effort"
  | "glm_reasoning_effort"
  | "glm_thinking"
  | "deepseek_reasoning_effort"
  | "qwen_thinking"
  | "kimi_thinking"

export type ChatModelConfig = {
  value: BuiltInChatModel
  label: string
  providerModel: string
  protocol: AgentModelProtocol
  supportedRuntimeIds: readonly AgentRuntimeId[]
  reasoningMode: ChatReasoningMode
  reasoningEfforts: readonly ChatReasoningEffort[]
  defaultReasoningEffort: ChatReasoningEffort
  contextWindow: number
}

const OPENAI_COMPAT_RUNTIME_IDS = [
  "astraflow",
  "opencode",
] as const satisfies readonly AgentRuntimeId[]

const GLM_THINKING_EFFORTS = ["none", "enabled"] as const

const GLM_REASONING_EFFORTS = ["none", "high", "max"] as const

const DEEPSEEK_REASONING_EFFORTS = ["none", "high", "max"] as const

const QWEN_THINKING_EFFORTS = ["none", "enabled"] as const

const KIMI_REASONING_EFFORTS = ["none", "enabled"] as const

// Review special-client: only domestic open-source text models (no GPT/Claude/Grok).
export const CHAT_MODEL_OPTIONS: ReadonlyArray<ChatModelConfig> = [
  {
    value: "qwen3.7-max",
    label: "Qwen 3.7 Max",
    providerModel: "qwen3.7-max",
    protocol: "openai-chat",
    supportedRuntimeIds: OPENAI_COMPAT_RUNTIME_IDS,
    reasoningMode: "qwen_thinking",
    reasoningEfforts: QWEN_THINKING_EFFORTS,
    defaultReasoningEffort: "enabled",
    contextWindow: 1_000_000,
  },
  {
    value: "glm-5.1",
    label: "GLM 5.1",
    providerModel: "glm-5.1",
    protocol: "openai-chat",
    supportedRuntimeIds: OPENAI_COMPAT_RUNTIME_IDS,
    reasoningMode: "glm_thinking",
    reasoningEfforts: GLM_THINKING_EFFORTS,
    defaultReasoningEffort: "enabled",
    contextWindow: 200_000,
  },
  {
    value: "glm-5.2",
    label: "GLM 5.2",
    providerModel: "glm-5.2",
    protocol: "openai-chat",
    supportedRuntimeIds: OPENAI_COMPAT_RUNTIME_IDS,
    reasoningMode: "glm_reasoning_effort",
    reasoningEfforts: GLM_REASONING_EFFORTS,
    defaultReasoningEffort: "max",
    contextWindow: 1_000_000,
  },
  {
    value: "zai-org/glm-5",
    label: "GLM 5",
    providerModel: "zai-org/glm-5",
    protocol: "openai-chat",
    supportedRuntimeIds: OPENAI_COMPAT_RUNTIME_IDS,
    reasoningMode: "glm_thinking",
    reasoningEfforts: GLM_THINKING_EFFORTS,
    defaultReasoningEffort: "enabled",
    contextWindow: 200_000,
  },
  {
    value: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    providerModel: "deepseek-v4-pro",
    protocol: "openai-chat",
    supportedRuntimeIds: OPENAI_COMPAT_RUNTIME_IDS,
    reasoningMode: "deepseek_reasoning_effort",
    reasoningEfforts: DEEPSEEK_REASONING_EFFORTS,
    defaultReasoningEffort: "high",
    contextWindow: 1_000_000,
  },
  {
    value: "kimi-k2.6",
    label: "Kimi K2.6",
    providerModel: "kimi-k2.6",
    protocol: "openai-chat",
    supportedRuntimeIds: OPENAI_COMPAT_RUNTIME_IDS,
    reasoningMode: "kimi_thinking",
    reasoningEfforts: KIMI_REASONING_EFFORTS,
    defaultReasoningEffort: "enabled",
    contextWindow: 256_000,
  },
]

export function isBuiltInChatModel(value: string): value is BuiltInChatModel {
  return SUPPORTED_CHAT_MODELS.some((model) => model === value)
}

export function getChatModelConfig(model: SupportedChatModel) {
  return (
    CHAT_MODEL_OPTIONS.find((option) => option.value === model) ??
    CHAT_MODEL_OPTIONS[0]
  )
}

export function isChatReasoningEffort(
  value: string
): value is ChatReasoningEffort {
  return SUPPORTED_CHAT_REASONING_EFFORTS.some((effort) => effort === value)
}

export function getChatReasoningEfforts(model: SupportedChatModel) {
  return getChatModelConfig(model).reasoningEfforts
}

export function getDefaultChatReasoningEffort(model: SupportedChatModel) {
  return getChatModelConfig(model).defaultReasoningEffort
}

export function isChatReasoningEffortSupported(
  model: SupportedChatModel,
  effort: ChatReasoningEffort
) {
  return getChatReasoningEfforts(model).some((option) => option === effort)
}

export function resolveChatReasoningEffort(
  model: SupportedChatModel,
  effort: ChatReasoningEffort | undefined
) {
  if (effort && isChatReasoningEffortSupported(model, effort)) {
    return effort
  }

  return getDefaultChatReasoningEffort(model)
}
