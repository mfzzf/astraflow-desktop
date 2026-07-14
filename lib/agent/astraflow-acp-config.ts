import { createHash } from "node:crypto"

import {
  getAgentModelById,
  MODELVERSE_ANTHROPIC_BASE_URL,
  MODELVERSE_OPENAI_BASE_URL,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import type { AgentRunInput } from "@/lib/agent/runtime"
import {
  DEFAULT_CHAT_REASONING_EFFORT,
  getChatModelConfig,
  isBuiltInChatModel,
} from "@/lib/chat-models"
import { getStudioModelverseApiKey } from "@/lib/studio-db"

export const ASTRAFLOW_ACP_RUNTIME_VERSION = "0.1.0"

type AstraflowAcpModelConfig = {
  id: string
  label: string
  providerModel: string
  protocol: AgentModelDefinition["protocol"]
  baseUrl: string
  reasoningEffort: string
  reasoningMode: string
}

function resolveReasoningEffort(
  model: AgentModelDefinition,
  requested: AgentRunInput["reasoningEffort"]
) {
  return requested && model.reasoningEfforts.includes(requested)
    ? requested
    : model.defaultReasoningEffort || DEFAULT_CHAT_REASONING_EFFORT
}

function getReasoningMode(model: AgentModelDefinition) {
  return isBuiltInChatModel(model.id)
    ? getChatModelConfig(model.id).reasoningMode
    : model.protocol === "anthropic-messages"
      ? "anthropic_output_effort"
      : "openai_reasoning_effort"
}

function createModelConfig(
  model: AgentModelDefinition,
  input: AgentRunInput
): AstraflowAcpModelConfig {
  return {
    id: model.id,
    label: model.label,
    providerModel: model.providerModel,
    protocol: model.protocol,
    baseUrl:
      model.baseUrl ||
      (model.protocol === "anthropic-messages"
        ? MODELVERSE_ANTHROPIC_BASE_URL
        : MODELVERSE_OPENAI_BASE_URL),
    reasoningEffort: resolveReasoningEffort(model, input.reasoningEffort),
    reasoningMode: getReasoningMode(model),
  }
}

export function resolveAstraflowAcpConfiguration(input: AgentRunInput) {
  const apiKey = getStudioModelverseApiKey()?.key

  if (!apiKey) {
    throw new Error("Modelverse API key is not configured locally.")
  }

  const model =
    resolveAgentModelForRuntime({
      modelId: input.model,
      runtimeId: "astraflow",
    }) ?? getAgentModelById(input.model)

  if (!model || !model.supportedRuntimeIds.includes("astraflow")) {
    throw new Error(
      `No AstraFlow Agent model configuration is available for ${input.model}.`
    )
  }

  const modelConfig = createModelConfig(model, input)
  const secretFingerprint = createHash("sha256")
    .update(apiKey)
    .digest("hex")
    .slice(0, 12)

  return {
    env: {
      ASTRAFLOW_ACP_MODEL_CONFIG: JSON.stringify(modelConfig),
      ASTRAFLOW_MODELVERSE_API_KEY: apiKey,
      ASTRAFLOW_PERMISSION_MODE: input.permissionMode,
    },
    sessionKey: [
      ASTRAFLOW_ACP_RUNTIME_VERSION,
      modelConfig.id,
      modelConfig.providerModel,
      modelConfig.protocol,
      modelConfig.baseUrl,
      modelConfig.reasoningEffort,
      input.permissionMode,
      secretFingerprint,
    ].join(":"),
    sessionMeta: {
      astraflow: {
        desktopSessionId: input.sessionId,
        expectedRuntimeVersion: ASTRAFLOW_ACP_RUNTIME_VERSION,
        execution: "sandbox",
      },
    },
  }
}
