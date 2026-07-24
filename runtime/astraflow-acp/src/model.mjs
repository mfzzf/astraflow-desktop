import { clampThinkingLevel } from "@earendil-works/pi-ai"
import { fetch as undiciFetch, ProxyAgent } from "undici"

import { getRecord } from "./constants.mjs"

const MODEL_CONFIG_ENV = "ASTRAFLOW_ACP_MODEL_CONFIG"
const MODEL_API_KEY_ENV = "ASTRAFLOW_MODELVERSE_API_KEY"
const PERMISSION_MODE_ENV = "ASTRAFLOW_PERMISSION_MODE"
const EXECUTION_ENV = "ASTRAFLOW_ACP_EXECUTION"
const DEFAULT_OPENAI_BASE_URL = "https://api.modelverse.cn/v1"
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.modelverse.cn"
const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 32_000
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
  "workspace_auto",
])
const VALID_EXECUTION_MODES = new Set(["local", "sandbox"])
const VALID_REASONING_LEVELS = new Set([
  "enabled",
  "none",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
])
const ORIGINAL_GLOBAL_FETCH = globalThis.fetch

let activeProxyFetchState = null

function firstProxyEnvironmentValue(env, names) {
  for (const name of names) {
    const value = env[name]

    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return null
}

function validatedProxyUrl(value) {
  if (!value) {
    return null
  }

  let url

  try {
    url = new URL(value)
  } catch {
    throw new Error("AstraFlow sandbox proxy configuration is invalid.")
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    !url.hostname
  ) {
    throw new Error(
      "AstraFlow sandbox proxy must use the HTTP or HTTPS protocol."
    )
  }

  return url.toString()
}

function requestProtocol(input) {
  try {
    if (typeof input === "string" || input instanceof URL) {
      return new URL(input).protocol
    }

    if (input && typeof input === "object" && typeof input.url === "string") {
      return new URL(input.url).protocol
    }
  } catch {
    // Let the underlying fetch implementation report malformed request URLs.
  }

  return null
}

/**
 * Install a global fetch wrapper before Pi constructs its OpenAI or Anthropic
 * clients. Node's built-in fetch does not honor HTTP(S)_PROXY by itself, so
 * local SRT runs must provide an explicit Undici ProxyAgent.
 */
export function configureAstraflowProxyFetch(
  env = process.env,
  dependencies = {}
) {
  const allProxy = firstProxyEnvironmentValue(env, ["ALL_PROXY", "all_proxy"])
  const rawHttpProxy =
    firstProxyEnvironmentValue(env, ["HTTP_PROXY", "http_proxy"]) ||
    allProxy ||
    firstProxyEnvironmentValue(env, ["HTTPS_PROXY", "https_proxy"])
  const rawHttpsProxy =
    firstProxyEnvironmentValue(env, ["HTTPS_PROXY", "https_proxy"]) ||
    allProxy ||
    firstProxyEnvironmentValue(env, ["HTTP_PROXY", "http_proxy"])

  if (!rawHttpProxy && !rawHttpsProxy) {
    return false
  }

  if (activeProxyFetchState) {
    return true
  }

  const httpProxy = validatedProxyUrl(rawHttpProxy)
  const httpsProxy = validatedProxyUrl(rawHttpsProxy)
  const fetchImpl = dependencies.fetchImpl || undiciFetch
  const createProxyAgent =
    dependencies.createProxyAgent || ((proxyUrl) => new ProxyAgent(proxyUrl))
  const agentsByProxy = new Map()

  const dispatcherFor = (proxyUrl) => {
    if (!proxyUrl) {
      return null
    }

    let dispatcher = agentsByProxy.get(proxyUrl)

    if (!dispatcher) {
      dispatcher = createProxyAgent(proxyUrl)
      agentsByProxy.set(proxyUrl, dispatcher)
    }

    return dispatcher
  }

  const httpDispatcher = dispatcherFor(httpProxy)
  const httpsDispatcher = dispatcherFor(httpsProxy)
  const proxiedFetch = (input, init) => {
    const protocol = requestProtocol(input)
    const dispatcher =
      protocol === "http:"
        ? httpDispatcher
        : protocol === "https:"
          ? httpsDispatcher
          : null

    return fetchImpl(
      input,
      dispatcher
        ? {
            ...init,
            // Never allow a caller-supplied dispatcher to bypass the SRT
            // network proxy.
            dispatcher,
          }
        : init
    )
  }

  activeProxyFetchState = {
    agents: [...agentsByProxy.values()],
    fetch: proxiedFetch,
  }
  globalThis.fetch = proxiedFetch

  return true
}

export async function resetAstraflowProxyFetchForTests() {
  const state = activeProxyFetchState

  if (!state) {
    return
  }

  activeProxyFetchState = null

  if (globalThis.fetch === state.fetch) {
    globalThis.fetch = ORIGINAL_GLOBAL_FETCH
  }

  await Promise.all(
    state.agents.map(async (agent) => {
      if (typeof agent?.close === "function") {
        await agent.close()
      }
    })
  )
}

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

function optionalPositiveInteger(record, name) {
  const value = record?.[name]

  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function optionalBoolean(record, name) {
  const value = record?.[name]

  return typeof value === "boolean" ? value : null
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
    contextWindow:
      optionalPositiveInteger(record, "contextWindow") ||
      DEFAULT_CONTEXT_WINDOW,
    maxTokens:
      optionalPositiveInteger(record, "maxTokens") || DEFAULT_MAX_TOKENS,
    reasoning: optionalBoolean(record, "reasoning") ?? true,
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
  const execution = env[EXECUTION_ENV]?.trim() || "sandbox"

  if (!apiKey) {
    throw new Error("Modelverse API key was not injected into AstraFlow ACP.")
  }

  if (!rawModelConfig) {
    throw new Error("AstraFlow ACP model configuration was not injected.")
  }

  if (!VALID_PERMISSION_MODES.has(permissionMode)) {
    throw new Error(`Unsupported AstraFlow permission mode: ${permissionMode}`)
  }

  if (!VALID_EXECUTION_MODES.has(execution)) {
    throw new Error(`Unsupported AstraFlow execution mode: ${execution}`)
  }

  const model = parseModelConfig(rawModelConfig)

  configureAstraflowProxyFetch(env)

  // Pi receives the key through Agent.getApiKey(). Remove credentials before
  // any coding tool can spawn a child process.
  purgeSecretEnvironment(env)

  return { apiKey, execution, model, permissionMode }
}

function normalizeAnthropicBaseUrl(baseUrl) {
  return baseUrl.replace(/\/v1\/?$/i, "")
}

function thinkingFormat(reasoningMode) {
  if (
    reasoningMode === "glm_reasoning_effort" ||
    reasoningMode === "glm_thinking" ||
    reasoningMode === "kimi_thinking"
  ) {
    return "zai"
  }

  if (
    reasoningMode === "deepseek_reasoning_effort" ||
    reasoningMode === "qwen_thinking"
  ) {
    return "qwen"
  }

  return "openai"
}

function reasoningLevel(value) {
  if (!VALID_REASONING_LEVELS.has(value)) {
    return "medium"
  }

  if (value === "none") {
    return "off"
  }

  return value === "enabled" ? "medium" : value
}

function modelThinkingLevelMap(model) {
  if (
    model.reasoningMode === "glm_reasoning_effort" ||
    model.reasoningMode === "deepseek_reasoning_effort"
  ) {
    return {
      off: "none",
      minimal: "high",
      low: "high",
      medium: "high",
      high: "high",
      xhigh: "high",
      max: "max",
    }
  }

  return {
    off: "none",
    minimal: "minimal",
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "xhigh",
    max: "max",
  }
}

function supportsReasoningEffort(reasoningMode) {
  return [
    "deepseek_reasoning_effort",
    "glm_reasoning_effort",
    "openai_reasoning_effort",
  ].includes(reasoningMode)
}

function isKimiK3Model(model) {
  return model.providerModel.toLowerCase().split("/").at(-1) === "kimi-k3"
}

function openAICompletionsCompat(model) {
  const compat = {
    thinkingFormat: thinkingFormat(model.reasoningMode),
    supportsReasoningEffort: supportsReasoningEffort(model.reasoningMode),
    supportsUsageInStreaming: true,
    // ModelVerse's Chat Completions gateway only accepts the classic roles
    // (system/assistant/user/tool/function). Pi would otherwise send the
    // system prompt as `developer` for reasoning models, which the gateway
    // rejects (and `developer` is deprecated regardless). Force `system`.
    supportsDeveloperRole: false,
  }

  if (!isKimiK3Model(model)) {
    return compat
  }

  // ModelVerse currently routes kimi-k3 to PPIO's Moonshot-compatible Chat
  // Completions backend. It rejects OpenAI-only request fields even though the
  // public endpoint itself is OpenAI-compatible.
  return {
    ...compat,
    maxTokensField: "max_tokens",
    supportsReasoningEffort: false,
    supportsStore: false,
    supportsStrictMode: false,
  }
}

function payloadTransform(model) {
  if (model.reasoningMode !== "deepseek_reasoning_effort") {
    return undefined
  }

  const enabled = reasoningLevel(model.reasoningEffort) !== "off"
  const effort = model.reasoningEffort === "max" ? "max" : "high"

  return (payload) => {
    const record = getRecord(payload)

    if (!record || !enabled) {
      return undefined
    }

    // ModelVerse DeepSeek uses Qwen's boolean thinking switch together with
    // the high/max effort field.
    return { ...record, reasoning_effort: effort }
  }
}

/**
 * Build the Pi model descriptor and run settings from AstraFlow's generated
 * model contract. The API key intentionally stays separate from the descriptor.
 */
export function createAstraflowPiModel({ model }) {
  const api =
    model.protocol === "openai-chat" ? "openai-completions" : model.protocol
  const baseUrl =
    model.protocol === "anthropic-messages"
      ? normalizeAnthropicBaseUrl(model.baseUrl || DEFAULT_ANTHROPIC_BASE_URL)
      : model.baseUrl || DEFAULT_OPENAI_BASE_URL
  const requestedThinkingLevel = reasoningLevel(model.reasoningEffort)
  const onPayload = payloadTransform(model)
  const compat =
    api === "anthropic-messages"
      ? { forceAdaptiveThinking: requestedThinkingLevel !== "off" }
      : api === "openai-completions"
        ? openAICompletionsCompat(model)
        : undefined
  const descriptor = {
    id: model.providerModel,
    name: model.label,
    api,
    provider: "astraflow-modelverse",
    baseUrl,
    reasoning: model.reasoning !== false,
    thinkingLevelMap: modelThinkingLevelMap(model),
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: model.contextWindow || DEFAULT_CONTEXT_WINDOW,
    maxTokens: model.maxTokens || DEFAULT_MAX_TOKENS,
    ...(model.headers ? { headers: { ...model.headers } } : {}),
    ...(compat ? { compat } : {}),
  }

  return {
    model: descriptor,
    thinkingLevel: clampThinkingLevel(descriptor, requestedThinkingLevel),
    ...(onPayload ? { onPayload } : {}),
  }
}

// Keep the previous export name for callers embedding this runtime.
export const createAstraflowChatModel = createAstraflowPiModel
