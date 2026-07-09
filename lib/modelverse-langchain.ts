import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"

import {
  getChatModelConfig,
  isBuiltInChatModel,
  resolveChatReasoningEffort,
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"
import {
  getAgentModelById,
  MODELVERSE_ANTHROPIC_BASE_URL,
  MODELVERSE_OPENAI_BASE_URL,
} from "@/lib/agent-model-settings"
import {
  getStoredModelverseApiKey,
  MODELVERSE_BASE_URL,
} from "@/lib/modelverse-openai"

function getLangChainApiKey() {
  const apiKey = getStoredModelverseApiKey()

  if (!apiKey) {
    throw new Error("Modelverse API key is not configured locally.")
  }

  return apiKey
}

function normalizeAnthropicBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/v1\/?$/i, "")
}

type OpenAIReasoningEffort = Extract<
  ChatReasoningEffort,
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh"
>

type AnthropicReasoningEffort = Extract<
  ChatReasoningEffort,
  "low" | "medium" | "high" | "xhigh" | "max"
>

type NativeHighMaxReasoningEffort = Extract<
  ChatReasoningEffort,
  "high" | "max"
>

function toHighMaxReasoningEffort(
  effort: ChatReasoningEffort
): NativeHighMaxReasoningEffort {
  return effort === "max" ? "max" : "high"
}

export function createModelverseChatModel(
  model: SupportedChatModel,
  requestedReasoningEffort: ChatReasoningEffort
) {
  const apiKey = getLangChainApiKey()
  const agentModel = getAgentModelById(model)
  const config = isBuiltInChatModel(model) ? getChatModelConfig(model) : null
  const reasoningEffort = agentModel
    ? agentModel.reasoningEfforts.includes(requestedReasoningEffort)
      ? requestedReasoningEffort
      : agentModel.defaultReasoningEffort
    : resolveChatReasoningEffort(config?.value ?? model, requestedReasoningEffort)

  if ((agentModel?.protocol ?? config?.protocol) === "anthropic-messages") {
    const outputEffort = reasoningEffort as AnthropicReasoningEffort

    return new ChatAnthropic({
      apiKey,
      model: agentModel?.providerModel ?? config?.providerModel ?? model,
      anthropicApiUrl: normalizeAnthropicBaseUrl(
        agentModel?.baseUrl ?? MODELVERSE_ANTHROPIC_BASE_URL
      ),
      streaming: true,
      thinking:
        reasoningEffort === "none"
          ? { type: "disabled" }
          : { type: "adaptive", display: "summarized" },
      outputConfig:
        reasoningEffort === "none" ? undefined : { effort: outputEffort },
    })
  }

  if (config?.reasoningMode === "glm_reasoning_effort") {
    return new ChatOpenAI({
      apiKey,
      model: config.providerModel,
      streaming: true,
      useResponsesApi: false,
      modelKwargs: {
        thinking: {
          type: reasoningEffort === "none" ? "disabled" : "enabled",
        },
        ...(reasoningEffort === "none"
          ? {}
          : { reasoning_effort: toHighMaxReasoningEffort(reasoningEffort) }),
      },
      configuration: {
        baseURL: MODELVERSE_BASE_URL,
      },
    })
  }

  if (
    config?.reasoningMode === "glm_thinking" ||
    config?.reasoningMode === "kimi_thinking"
  ) {
    return new ChatOpenAI({
      apiKey,
      model: config.providerModel,
      streaming: true,
      useResponsesApi: false,
      modelKwargs: {
        thinking: {
          type: reasoningEffort === "none" ? "disabled" : "enabled",
        },
      },
      configuration: {
        baseURL: MODELVERSE_BASE_URL,
      },
    })
  }

  if (config?.reasoningMode === "deepseek_reasoning_effort") {
    return new ChatOpenAI({
      apiKey,
      model: config.providerModel,
      streaming: true,
      useResponsesApi: false,
      modelKwargs: {
        enable_thinking: reasoningEffort !== "none",
        ...(reasoningEffort === "none"
          ? {}
          : {
              reasoning_effort: toHighMaxReasoningEffort(reasoningEffort),
            }),
      },
      configuration: {
        baseURL: MODELVERSE_BASE_URL,
      },
    })
  }

  if (config?.reasoningMode === "qwen_thinking") {
    return new ChatOpenAI({
      apiKey,
      model: config.providerModel,
      streaming: true,
      useResponsesApi: false,
      modelKwargs: {
        enable_thinking: reasoningEffort !== "none",
      },
      configuration: {
        baseURL: MODELVERSE_BASE_URL,
      },
    })
  }

  const openAIReasoningEffort = reasoningEffort as OpenAIReasoningEffort

  return new ChatOpenAI({
    apiKey,
    model: agentModel?.providerModel ?? config?.providerModel ?? model,
    streaming: true,
    useResponsesApi: agentModel?.protocol === "openai-responses",
    reasoning: { effort: openAIReasoningEffort },
    modelKwargs: {
      reasoning_effort: openAIReasoningEffort,
    },
    configuration: {
      baseURL:
        agentModel?.baseUrl ?? MODELVERSE_OPENAI_BASE_URL ?? MODELVERSE_BASE_URL,
    },
  })
}
