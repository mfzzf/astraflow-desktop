import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

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
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"
import {
  getLatestStudioAcpSessionSelection,
  getStudioModelverseApiKey,
} from "@/lib/studio-db"

export const ASTRAFLOW_ACP_RUNTIME_VERSION = "0.1.0"
const ASTRAFLOW_ACP_ROOT_ENV = "ASTRAFLOW_ASTRAFLOW_ACP_ROOT"
const ASTRAFLOW_ACP_ENTRY_PATH = join("src", "index.mjs")
const FALLBACK_CONTEXT_WINDOW = 200_000
const DEFAULT_MAX_OUTPUT_TOKENS = 32_768

type AstraflowAcpModelConfig = {
  id: string
  label: string
  providerModel: string
  protocol: AgentModelDefinition["protocol"]
  baseUrl: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
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
  const builtInConfig = isBuiltInChatModel(model.id)
    ? getChatModelConfig(model.id)
    : null
  const contextWindow =
    builtInConfig && builtInConfig.contextWindow > 0
      ? builtInConfig.contextWindow
      : FALLBACK_CONTEXT_WINDOW

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
    contextWindow,
    maxTokens: Math.min(contextWindow, DEFAULT_MAX_OUTPUT_TOKENS),
    reasoning: model.reasoningEfforts.some((effort) => effort !== "none"),
    reasoningEffort: resolveReasoningEffort(model, input.reasoningEffort),
    reasoningMode: getReasoningMode(model),
  }
}

export function resolveAstraflowAcpConfiguration(input: AgentRunInput) {
  const apiKey = getStudioModelverseApiKey()?.key
  const execution = input.environment === "remote" ? "sandbox" : "local"

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
      ASTRAFLOW_ACP_EXECUTION: execution,
      ASTRAFLOW_MODELVERSE_API_KEY: apiKey,
      ASTRAFLOW_PERMISSION_MODE: input.permissionMode,
    },
    sessionKey: [
      ASTRAFLOW_ACP_RUNTIME_VERSION,
      execution,
      modelConfig.id,
      modelConfig.providerModel,
      modelConfig.protocol,
      modelConfig.baseUrl,
      modelConfig.contextWindow,
      modelConfig.maxTokens,
      modelConfig.reasoning,
      modelConfig.reasoningEffort,
      input.permissionMode,
      secretFingerprint,
    ].join(":"),
    sessionMeta: {
      astraflow: {
        desktopSessionId: input.sessionId,
        execution,
      },
    },
  }
}

function resolveAstraflowAcpRoot() {
  const configuredRoot = process.env[ASTRAFLOW_ACP_ROOT_ENV]?.trim()
  const bundledNodeModules = process.env.ASTRAFLOW_BUNDLED_NODE_MODULES?.trim()
  const candidates = [
    configuredRoot ? resolve(configuredRoot) : null,
    bundledNodeModules
      ? join(dirname(resolve(bundledNodeModules)), "runtime", "astraflow-acp")
      : null,
    join(process.cwd(), "runtime", "astraflow-acp"),
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    if (existsSync(join(candidate, ASTRAFLOW_ACP_ENTRY_PATH))) {
      return candidate
    }
  }

  throw new Error(
    `AstraFlow ACP runtime is missing. Expected ${ASTRAFLOW_ACP_ENTRY_PATH} under ${candidates.join(", ")}.`
  )
}

export function resolveAstraflowAcpLocalCommand(input: AgentRunInput) {
  const configuration = resolveAstraflowAcpConfiguration(input)
  const runtimeRoot = resolveAstraflowAcpRoot()
  const selectedSession = getLatestStudioAcpSessionSelection(
    input.sessionId,
    "astraflow"
  )
  const stateRoot = join(
    ensureAcpWorkspace(
      selectedSession?.stateOwnerStudioSessionId ?? input.sessionId
    ),
    ".astraflow-acp-state"
  )

  return {
    command:
      process.env.ASTRAFLOW_NODE_EXECUTABLE?.trim() || process.execPath,
    args: [join(runtimeRoot, ASTRAFLOW_ACP_ENTRY_PATH)],
    env: {
      ...configuration.env,
      ASTRAFLOW_ACP_STATE_ROOT: stateRoot,
      ELECTRON_RUN_AS_NODE: "1",
    },
  }
}
