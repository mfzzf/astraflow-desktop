import { ChatAnthropic } from "@langchain/anthropic"
import { ChatOpenAI } from "@langchain/openai"

import { getRecord } from "./constants.mjs"

const MODEL_CONFIG_ENV = "ASTRAFLOW_ACP_MODEL_CONFIG"
const MODEL_API_KEY_ENV = "ASTRAFLOW_MODELVERSE_API_KEY"
const PERMISSION_MODE_ENV = "ASTRAFLOW_PERMISSION_MODE"
const DEFAULT_OPENAI_BASE_URL = "https://api.modelverse.cn/v1"
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.modelverse.cn"
const VALID_PROTOCOLS = new Set([
  "openai-chat",
  "openai-responses",
  "anthropic-messages",
])
const VALID_PERMISSION_MODES = new Set([
  "ask",
  "auto",
  "full_access",
  "readonly",
])
const OPENAI_REASONING_EFFORTS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])
const ANTHROPIC_REASONING_EFFORTS = new Set([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])

function requiredString(record, name) {
  const value = record?.[name]

  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`AstraFlow ACP model config requires ${name}.`)
  }

  return value.trim()
}

function optionalString(record, name) {
  const value = record?.[name]

  return typeof value === "string" && value.trim() ? value.trim() : null
}

function parseModelConfig(raw) {
  let value

  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error("ASTRAFLOW_ACP_MODEL_CONFIG must be valid JSON.")
  }

  const record = getRecord(value)

  if (!record) {
    throw new Error("ASTRAFLOW_ACP_MODEL_CONFIG must be a JSON object.")
  }

  const protocol = requiredString(record, "protocol")

  if (!VALID_PROTOCOLS.has(protocol)) {
    throw new Error(`Unsupported AstraFlow ACP model protocol: ${protocol}`)
  }

  return {
    id: requiredString(record, "id"),
    label: optionalString(record, "label") || requiredString(record, "id"),
    providerModel: requiredString(record, "providerModel"),
    protocol,
    baseUrl: optionalString(record, "baseUrl"),
    reasoningEffort: optionalString(record, "reasoningEffort") || "medium",
    reasoningMode:
      optionalString(record, "reasoningMode") ||
      (protocol === "anthropic-messages"
        ? "anthropic_output_effort"
        : "openai_reasoning_effort"),
  }
}

function purgeSecretEnvironment(env) {
  delete env[MODEL_API_KEY_ENV]
  delete env[MODEL_CONFIG_ENV]
  delete env[PERMISSION_MODE_ENV]
  delete env.OPENAI_API_KEY
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
}

export function readAstraflowRuntimeConfiguration(env = process.env) {
  const apiKey = env[MODEL_API_KEY_ENV]?.trim()
  const rawModelConfig = env[MODEL_CONFIG_ENV]?.trim()
  const permissionMode = env[PERMISSION_MODE_ENV]?.trim() || "ask"

  if (!apiKey) {
    throw new Error("Modelverse API key was not injected into AstraFlow ACP.")
  }

  if (!rawModelConfig) {
    throw new Error("AstraFlow ACP model configuration was not injected.")
  }

  if (!VALID_PERMISSION_MODES.has(permissionMode)) {
    throw new Error(`Unsupported AstraFlow permission mode: ${permissionMode}`)
  }

  const model = parseModelConfig(rawModelConfig)

  // The model client receives the secret as a constructor value. Remove all
  // model credentials from process.env before any shell backend can spawn a
  // child process, so Agent commands cannot print or inherit the API key.
  purgeSecretEnvironment(env)

  return { apiKey, model, permissionMode }
}

function normalizeAnthropicBaseUrl(baseUrl) {
  return baseUrl.replace(/\/v1\/?$/i, "")
}

function normalizeOpenAIReasoningEffort(value) {
  return OPENAI_REASONING_EFFORTS.has(value) ? value : "medium"
}

function normalizeAnthropicReasoningEffort(value) {
  if (value === "none") {
    return null
  }

  return ANTHROPIC_REASONING_EFFORTS.has(value) ? value : "medium"
}

function highMaxReasoningEffort(value) {
  return value === "max" ? "max" : "high"
}

export function createAstraflowChatModel({ apiKey, model }) {
  if (model.protocol === "anthropic-messages") {
    const effort = normalizeAnthropicReasoningEffort(model.reasoningEffort)

    return new ChatAnthropic({
      apiKey,
      model: model.providerModel,
      anthropicApiUrl: normalizeAnthropicBaseUrl(
        model.baseUrl || DEFAULT_ANTHROPIC_BASE_URL
      ),
      streaming: true,
      thinking: effort
        ? { type: "adaptive", display: "summarized" }
        : { type: "disabled" },
      outputConfig: effort ? { effort } : undefined,
    })
  }

  const effort = normalizeOpenAIReasoningEffort(model.reasoningEffort)
  const shared = {
    apiKey,
    model: model.providerModel,
    streaming: true,
    useResponsesApi: model.protocol === "openai-responses",
    configuration: {
      baseURL: model.baseUrl || DEFAULT_OPENAI_BASE_URL,
    },
  }

  if (model.reasoningMode === "glm_reasoning_effort") {
    return new ChatOpenAI({
      ...shared,
      useResponsesApi: false,
      modelKwargs: {
        thinking: { type: effort === "none" ? "disabled" : "enabled" },
        ...(effort === "none"
          ? {}
          : { reasoning_effort: highMaxReasoningEffort(model.reasoningEffort) }),
      },
    })
  }

  if (
    model.reasoningMode === "glm_thinking" ||
    model.reasoningMode === "kimi_thinking"
  ) {
    return new ChatOpenAI({
      ...shared,
      useResponsesApi: false,
      modelKwargs: {
        thinking: { type: effort === "none" ? "disabled" : "enabled" },
      },
    })
  }

  if (model.reasoningMode === "deepseek_reasoning_effort") {
    return new ChatOpenAI({
      ...shared,
      useResponsesApi: false,
      modelKwargs: {
        enable_thinking: effort !== "none",
        ...(effort === "none"
          ? {}
          : { reasoning_effort: highMaxReasoningEffort(model.reasoningEffort) }),
      },
    })
  }

  if (model.reasoningMode === "qwen_thinking") {
    return new ChatOpenAI({
      ...shared,
      useResponsesApi: false,
      modelKwargs: { enable_thinking: effort !== "none" },
    })
  }

  return new ChatOpenAI({
    ...shared,
    reasoning: { effort },
    modelKwargs:
      model.protocol === "openai-responses"
        ? undefined
        : { reasoning_effort: effort },
  })
}
