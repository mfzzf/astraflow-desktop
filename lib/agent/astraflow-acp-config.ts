import { createHash } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import {
  getAgentModelById,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import type { AgentRunInput } from "@/lib/agent/runtime"
import {
  DEFAULT_CHAT_REASONING_EFFORT,
  getChatModelConfig,
  isBuiltInChatModel,
} from "@/lib/chat-models"
import { AcpStateBroker } from "@/lib/agent/acp/state-broker"
import { ensureAcpAttachmentDirectory } from "@/lib/agent/acp/attachments"
import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"
import { createAgentProviderProxyCredential } from "@/lib/agent/provider-proxy"
import {
  resolveModelProviderDataPlane,
  resolveModelProviderEndpoint,
} from "@/lib/model-provider-config"
import { getLatestStudioAcpSessionSelection } from "@/lib/studio-db"

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
  providerChannel: string
  endpointFingerprint: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  reasoningEffort: string
  reasoningMode: string
}

function resolveRuntimePermissionMode(
  permissionMode: AgentRunInput["permissionMode"]
) {
  if (permissionMode === "legacy_readonly") {
    return "readonly"
  }

  return permissionMode === "full_access" ? "full_access" : "workspace_auto"
}

function resolveProviderHostname(baseUrl: string) {
  let url: URL

  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error(`AstraFlow Agent model base URL is invalid: ${baseUrl}`)
  }

  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
    throw new Error(
      `AstraFlow Agent model base URL must use HTTP or HTTPS: ${baseUrl}`
    )
  }

  return url.hostname.toLocaleLowerCase("en-US")
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
  const endpoint = resolveModelProviderEndpoint({
    protocol: model.protocol,
    baseUrl: model.baseUrl,
  })

  return {
    id: model.id,
    label: model.label,
    providerModel: model.providerModel,
    protocol: model.protocol,
    baseUrl: endpoint.baseUrl,
    providerChannel: endpoint.channel,
    endpointFingerprint: endpoint.fingerprint,
    contextWindow,
    maxTokens: Math.min(contextWindow, DEFAULT_MAX_OUTPUT_TOKENS),
    reasoning: model.reasoningEfforts.some((effort) => effort !== "none"),
    reasoningEffort: resolveReasoningEffort(model, input.reasoningEffort),
    reasoningMode: getReasoningMode(model),
  }
}

export function resolveAstraflowAcpConfiguration(input: AgentRunInput) {
  const dataPlane = resolveModelProviderDataPlane()
  const apiKey = dataPlane.apiKey
  const execution = input.environment === "remote" ? "sandbox" : "local"

  if (!apiKey) {
    throw new Error(`${dataPlane.providerName} API key is not configured locally.`)
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
  const providerProxy =
    input.environment === "local"
      ? createAgentProviderProxyCredential({
          sessionId: input.sessionId,
          apiKey,
          baseUrl: modelConfig.baseUrl,
          protocol: modelConfig.protocol,
          scopeId: `astraflow:${input.permissionMode}`,
        })
      : null
  const runtimeModelConfig = providerProxy
    ? { ...modelConfig, baseUrl: providerProxy.baseUrl }
    : modelConfig
  const runtimePermissionMode = resolveRuntimePermissionMode(
    input.permissionMode
  )
  const secretFingerprint = createHash("sha256")
    .update(apiKey)
    .digest("hex")
    .slice(0, 12)

  return {
    env: {
      ASTRAFLOW_ACP_MODEL_CONFIG: JSON.stringify(runtimeModelConfig),
      ASTRAFLOW_ACP_EXECUTION: execution,
      ASTRAFLOW_MODELVERSE_API_KEY: providerProxy?.apiKey ?? apiKey,
      ASTRAFLOW_PERMISSION_MODE: runtimePermissionMode,
    },
    providerHostname:
      providerProxy?.providerHostname ??
      resolveProviderHostname(modelConfig.baseUrl),
    providerEndpoint: providerProxy?.providerEndpoint ?? null,
    providerProxyToken: providerProxy?.apiKey ?? null,
    sessionKey: [
      ASTRAFLOW_ACP_RUNTIME_VERSION,
      execution,
      modelConfig.id,
      modelConfig.providerModel,
      modelConfig.protocol,
      modelConfig.providerChannel,
      modelConfig.endpointFingerprint,
      modelConfig.baseUrl,
      modelConfig.contextWindow,
      modelConfig.maxTokens,
      modelConfig.reasoning,
      modelConfig.reasoningEffort,
      runtimePermissionMode,
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
  const stateBroker = resolveAstraflowAcpStateBroker(input)
  const runtimeStateRoot = join(
    ensureLocalSandboxWorkspace(input.sessionId),
    ".astraflow-acp-runtime"
  )
  const attachmentRoot = ensureAcpAttachmentDirectory(input.sessionId)
  mkdirSync(runtimeStateRoot, { recursive: true, mode: 0o700 })
  const processSandboxed =
    input.environment === "local" && input.permissionMode !== "full_access"

  return {
    command: process.env.ASTRAFLOW_NODE_EXECUTABLE?.trim() || process.execPath,
    args: [join(runtimeRoot, ASTRAFLOW_ACP_ENTRY_PATH)],
    env: {
      ...configuration.env,
      ASTRAFLOW_ACP_RUNTIME_STATE_ROOT: runtimeStateRoot,
      ASTRAFLOW_ACP_READ_ONLY_ROOTS: JSON.stringify([attachmentRoot]),
      ELECTRON_RUN_AS_NODE: "1",
    },
    ...(configuration.providerProxyToken
      ? { providerProxyToken: configuration.providerProxyToken }
      : {}),
    stateBroker,
    ...(processSandboxed
      ? {
          sandbox: {
            additionalReadRoots: [runtimeRoot, attachmentRoot],
            allowedNetworkDomains: [],
            allowedNetworkEndpoints: configuration.providerEndpoint
              ? [configuration.providerEndpoint]
              : [],
            kind: "astraflow-local" as const,
            runtimeStateRoot,
            sessionId: input.sessionId,
          },
        }
      : {}),
  }
}

export function resolveAstraflowAcpStateBroker(input: AgentRunInput) {
  const selectedSession = getLatestStudioAcpSessionSelection(
    input.sessionId,
    "astraflow"
  )
  const stateOwnerId =
    selectedSession?.stateOwnerStudioSessionId ?? input.sessionId

  return new AcpStateBroker({
    desktopSessionId: input.sessionId,
    stateOwnerId,
  })
}
