import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"
import { createHash } from "node:crypto"

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
import type { AgentModelProtocol } from "@/lib/agent-model-settings-shared"
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

type NativeHighMaxReasoningEffort = Extract<ChatReasoningEffort, "high" | "max">

type ModelverseChatModelOptions = {
  promptCacheKey?: string
}

export function createModelversePromptCacheKey({
  model,
  sessionId,
}: {
  model: string
  sessionId: string
}) {
  const digest = createHash("sha256")
    .update(`astraflow\0${sessionId}\0${model}`)
    .digest("hex")
    .slice(0, 48)

  return `astraflow:${digest}`
}

export function resolveModelversePromptCacheOptions(
  protocol: AgentModelProtocol,
  promptCacheKey: string | undefined
) {
  if (!promptCacheKey || protocol === "anthropic-messages") {
    return {}
  }

  return protocol === "openai-responses"
    ? { promptCacheKey, promptCacheRetention: "24h" as const }
    : {}
}

function toHighMaxReasoningEffort(
  effort: ChatReasoningEffort
): NativeHighMaxReasoningEffort {
  return effort === "max" ? "max" : "high"
}

export function createModelverseChatModel(
  model: SupportedChatModel,
  requestedReasoningEffort: ChatReasoningEffort,
  options: ModelverseChatModelOptions = {}
) {
  const apiKey = getLangChainApiKey()
  const agentModel = getAgentModelById(model)
  const config = isBuiltInChatModel(model) ? getChatModelConfig(model) : null
  const protocol = agentModel?.protocol ?? config?.protocol ?? "openai-chat"
  const promptCacheOptions = resolveModelversePromptCacheOptions(
    protocol,
    options.promptCacheKey
  )
  const reasoningEffort = agentModel
    ? agentModel.reasoningEfforts.includes(requestedReasoningEffort)
      ? requestedReasoningEffort
      : agentModel.defaultReasoningEffort
    : resolveChatReasoningEffort(
        config?.value ?? model,
        requestedReasoningEffort
      )

  if (protocol === "anthropic-messages") {
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
      ...promptCacheOptions,
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
      ...promptCacheOptions,
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
      ...promptCacheOptions,
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
      ...promptCacheOptions,
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
    useResponsesApi: protocol === "openai-responses",
    ...promptCacheOptions,
    reasoning: { effort: openAIReasoningEffort },
    modelKwargs:
      protocol === "openai-responses"
        ? undefined
        : { reasoning_effort: openAIReasoningEffort },
    configuration: {
      baseURL:
        agentModel?.baseUrl ??
        MODELVERSE_OPENAI_BASE_URL ??
        MODELVERSE_BASE_URL,
    },
  })
}
