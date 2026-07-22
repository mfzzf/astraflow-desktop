import type { AgentModelProtocol } from "@/lib/agent-model-settings-shared"
import {
  COMPSHARE_MODEL_API_BASE_URL,
  isCompShareChannel,
} from "@/lib/compshare/config"
import { MODELVERSE_BASE_URL, MODELVERSE_BASE_URL_V1 } from "@/lib/modelverse-config"
import { getCompShareSelectedApiKey } from "@/lib/studio-db/compshare"
import { getStudioModelverseApiKey } from "@/lib/studio-db"

export type ModelProviderChannel = "modelverse" | "compshare"

export type ModelProviderDataPlane = {
  channel: ModelProviderChannel
  providerId: ModelProviderChannel
  providerName: string
  baseUrl: string
  apiKey: string | null
  keyCode: string | null
}

export type ModelProviderEndpoint = {
  channel: ModelProviderChannel
  protocol: AgentModelProtocol
  providerId: ModelProviderChannel
  providerName: string
  baseUrl: string
  path: string
  url: string
  supportsStreaming: boolean
  supportsCancellation: boolean
  fingerprint: string
}

type ProviderDefinition = {
  providerName: string
  dataPlaneBaseUrl: string
  protocols: Record<
    AgentModelProtocol,
    {
      baseUrl: string
      path: string
      supportsStreaming: boolean
      supportsCancellation: boolean
    }
  >
}

function protocolTable(openAIBaseUrl: string) {
  const normalizedOpenAIBaseUrl = openAIBaseUrl.replace(/\/+$/, "")
  const anthropicBaseUrl = normalizedOpenAIBaseUrl.replace(/\/v1$/i, "")

  return {
    "openai-chat": {
      baseUrl: normalizedOpenAIBaseUrl,
      path: "chat/completions",
      supportsStreaming: true,
      supportsCancellation: true,
    },
    "openai-responses": {
      baseUrl: normalizedOpenAIBaseUrl,
      path: "responses",
      supportsStreaming: true,
      supportsCancellation: true,
    },
    "anthropic-messages": {
      baseUrl: anthropicBaseUrl,
      path: "v1/messages",
      supportsStreaming: true,
      supportsCancellation: true,
    },
  } satisfies ProviderDefinition["protocols"]
}

const MODEL_PROVIDER_TABLE: Record<ModelProviderChannel, ProviderDefinition> = {
  modelverse: {
    providerName: "ModelVerse",
    dataPlaneBaseUrl: MODELVERSE_BASE_URL_V1,
    protocols: protocolTable(MODELVERSE_BASE_URL_V1),
  },
  compshare: {
    providerName: "CompShare",
    dataPlaneBaseUrl: COMPSHARE_MODEL_API_BASE_URL,
    protocols: protocolTable(COMPSHARE_MODEL_API_BASE_URL),
  },
}

function normalizeBaseUrl(protocol: AgentModelProtocol, baseUrl: string) {
  const normalized = baseUrl.trim().replace(/\/+$/, "")

  return protocol === "anthropic-messages"
    ? normalized.replace(/\/v1$/i, "")
    : normalized
}

function getModelverseApiKey() {
  return (
    getStudioModelverseApiKey()?.key ??
    process.env.MODELVERSE_API_KEY?.trim() ??
    process.env.MODELVERSE_APIKEY?.trim() ??
    process.env.UCLOUD_MODELVERSE_API_KEY?.trim() ??
    null
  )
}

export function getActiveModelProviderChannel(): ModelProviderChannel {
  return isCompShareChannel() ? "compshare" : "modelverse"
}

export function resolveModelProviderDataPlane(
  channel = getActiveModelProviderChannel()
): ModelProviderDataPlane {
  const provider = MODEL_PROVIDER_TABLE[channel]

  if (channel === "compshare") {
    const selected = getCompShareSelectedApiKey()

    return {
      channel,
      providerId: channel,
      providerName: provider.providerName,
      baseUrl: provider.dataPlaneBaseUrl,
      apiKey: selected?.apiKey ?? null,
      keyCode: selected?.keyCode ?? null,
    }
  }

  return {
    channel,
    providerId: channel,
    providerName: provider.providerName,
    baseUrl: provider.dataPlaneBaseUrl,
    apiKey: getModelverseApiKey(),
    keyCode: null,
  }
}

export function resolveModelProviderEndpoint({
  protocol,
  baseUrl,
  channel = getActiveModelProviderChannel(),
}: {
  protocol: AgentModelProtocol
  baseUrl?: string | null
  channel?: ModelProviderChannel
}): ModelProviderEndpoint {
  const provider = MODEL_PROVIDER_TABLE[channel]
  const capability = provider.protocols[protocol]
  const resolvedBaseUrl = baseUrl
    ? normalizeBaseUrl(protocol, baseUrl)
    : capability.baseUrl
  const path = capability.path
  const url = new URL(path, `${resolvedBaseUrl}/`).toString()
  const fingerprint = [channel, protocol, resolvedBaseUrl, path].join("|")

  return {
    channel,
    protocol,
    providerId: channel,
    providerName: provider.providerName,
    baseUrl: resolvedBaseUrl,
    path,
    url,
    supportsStreaming: capability.supportsStreaming,
    supportsCancellation: capability.supportsCancellation,
    fingerprint,
  }
}

export function resolveModelProviderDataPlaneUrl(
  pathOrUrl: string,
  baseUrl = resolveModelProviderDataPlane().baseUrl
) {
  const targetOrigin = new URL(baseUrl).origin
  const modelverseOrigin = new URL(MODELVERSE_BASE_URL).origin
  let resolvedUrl: string

  try {
    const absoluteUrl = new URL(pathOrUrl)

    resolvedUrl =
      absoluteUrl.origin === modelverseOrigin
        ? new URL(
            `${absoluteUrl.pathname}${absoluteUrl.search}${absoluteUrl.hash}`,
            targetOrigin
          ).toString()
        : absoluteUrl.toString()
  } catch {
    resolvedUrl = new URL(
      pathOrUrl,
      `${baseUrl.replace(/\/+$/, "")}/`
    ).toString()
  }

  return resolvedUrl.replace(/%7B/gi, "{").replace(/%7D/gi, "}")
}

export function resolveModelProviderOpenCodeBaseUrl(
  endpoint: ModelProviderEndpoint
) {
  return endpoint.protocol === "anthropic-messages"
    ? `${endpoint.baseUrl}/v1`
    : endpoint.baseUrl
}

