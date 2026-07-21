/**
 * Special-client (app-store review) constraints for the domestic build:
 * - only surface domestic / China open-source model families
 * - only expose AstraFlow + OpenCode public agent runtimes
 */

import type { AgentRuntimeId } from "@/lib/agent-model-settings-shared"

/** Public agent runtimes allowed in the review client. */
export const REVIEW_PUBLIC_AGENT_RUNTIME_IDS = [
  "astraflow",
  "opencode",
] as const satisfies readonly AgentRuntimeId[]

export type ReviewPublicAgentRuntimeId =
  (typeof REVIEW_PUBLIC_AGENT_RUNTIME_IDS)[number]

export function isReviewPublicAgentRuntimeId(
  runtimeId: string
): runtimeId is ReviewPublicAgentRuntimeId {
  return REVIEW_PUBLIC_AGENT_RUNTIME_IDS.some(
    (publicId) => publicId === runtimeId
  )
}

/**
 * Built-in chat model ids that are domestic / China open-source oriented.
 * Foreign families (OpenAI, Anthropic, Grok) and Claude-Code-only aliases are
 * excluded from the review client catalog.
 */
export const REVIEW_DOMESTIC_CHAT_MODEL_IDS = [
  "glm-5.1",
  "glm-5.2",
  "zai-org/glm-5",
  "deepseek-v4-pro",
  "qwen3.7-max",
  "kimi-k2.6",
] as const

export const REVIEW_DEFAULT_CHAT_MODEL =
  "qwen3.7-max" as (typeof REVIEW_DOMESTIC_CHAT_MODEL_IDS)[number]

export function isReviewDomesticChatModelId(modelId: string) {
  return REVIEW_DOMESTIC_CHAT_MODEL_IDS.some((id) => id === modelId)
}

/** Domestic image model registry keys (and common Model Square aliases). */
export const REVIEW_DOMESTIC_IMAGE_MODEL_KEYS = [
  "doubao-seedream-4.5",
  "doubao-seedream-5-0-260128",
  "Qwen/Qwen-Image",
  "Qwen/Qwen-Image-Edit",
  "stepfun-ai/step1x-edit",
  "wan2.7-image",
  "wan2.7-image-pro",
] as const

const FOREIGN_MODEL_MARKERS = [
  "openai",
  "gpt-",
  "gpt ",
  "sora",
  "chatgpt",
  "anthropic",
  "claude",
  "google",
  "gemini",
  "veo",
  "imagen",
  "xai",
  "grok",
  "meta",
  "llama",
  "mistral",
  "cohere",
  "midjourney",
  "flux",
  "black forest",
  "stability",
  "stable-diffusion",
  "stable diffusion",
  "ideogram",
  "runway",
  "luma",
  "pika",
  "elevenlabs",
  "microsoft",
  "azure",
  "amazon",
  "aws",
  "bedrock",
  "nvidia",
  "perplexity",
] as const

const DOMESTIC_MODEL_MARKERS = [
  "qwen",
  "tongyi",
  "通义",
  "wan",
  "万相",
  "dashscope",
  "alibaba",
  "aliyun",
  "阿里",
  "deepseek",
  "深度求索",
  "glm",
  "zhipu",
  "智谱",
  "zai-org",
  "zai org",
  "kimi",
  "moonshot",
  "月之暗面",
  "doubao",
  "豆包",
  "seedream",
  "seedance",
  "bytedance",
  "字节",
  "kling",
  "可灵",
  "kuaishou",
  "快手",
  "minimax",
  "hailuo",
  "海螺",
  "vidu",
  "生数",
  "stepfun",
  "阶跃",
  "step1x",
  "baichuan",
  "百川",
  "yi-",
  "零一",
  "01-ai",
  "baidu",
  "ernie",
  "文心",
  "百度",
  "tencent",
  "hunyuan",
  "混元",
  "腾讯",
  "huawei",
  "pangu",
  "盘古",
  "华为",
  "sense",
  "商汤",
  "minicpm",
  "面壁",
  "modelbest",
  "skywork",
  "昆仑",
  "pixverse",
  "爱诗",
  "happyhorse",
  "happy-horse",
  "jimeng",
  "即梦",
  "volcengine",
  "火山",
  "infini",
  "无问",
  "siliconflow",
  "硅基",
  "internlm",
  "书生",
  "chatglm",
  "cogview",
  "cogvideo",
  "讯飞",
  "iflytek",
  "spark",
  "星火",
  "mimo",
] as const

function normalizeModelText(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s./\\-]+/g, " ")
}

function includesAnyMarker(text: string, markers: readonly string[]) {
  return markers.some((marker) => text.includes(marker.toLowerCase()))
}

/**
 * Whether a Model Square / Studio catalog entry should be shown in the
 * review client. Prefers explicit domestic markers; rejects known foreign
 * vendors. Unknown vendors without domestic markers are hidden.
 */
export function isReviewDomesticModel({
  id,
  name,
  manufacturer,
  chineseName,
}: {
  id?: string | null
  name?: string | null
  manufacturer?: string | null
  chineseName?: string | null
}) {
  const haystack = normalizeModelText(
    [id, name, manufacturer, chineseName].filter(Boolean).join(" ")
  )

  if (!haystack) {
    return false
  }

  if (includesAnyMarker(haystack, FOREIGN_MODEL_MARKERS)) {
    // Some domestic wrappers mention OpenAI-compatible APIs in descriptions —
    // only reject when the foreign marker is the primary identity.
    const identity = normalizeModelText(
      [id, name, manufacturer].filter(Boolean).join(" ")
    )
    if (includesAnyMarker(identity, FOREIGN_MODEL_MARKERS)) {
      return false
    }
  }

  if (includesAnyMarker(haystack, DOMESTIC_MODEL_MARKERS)) {
    return true
  }

  return false
}

export function isReviewDomesticImageModelKey(modelKey: string) {
  const normalized = modelKey.trim()
  if (
    REVIEW_DOMESTIC_IMAGE_MODEL_KEYS.some((key) => key === normalized)
  ) {
    return true
  }

  return isReviewDomesticModel({ id: modelKey, name: modelKey })
}

export const REVIEW_PRIVACY_PROTOCOL_URL =
  "https://astraflow.ucloud.cn/docs/modelverse/protocal/private"

/**
 * Client identity header for server-side green filtering on ModelVerse /
 * UCloud APIs. Every outbound request from this special-client build should
 * carry these headers (including ACP child processes).
 */
export const ASTRAFLOW_CLIENT_ID = "astraflow-desktop"
/** Outbound HTTP header name carrying {@link ASTRAFLOW_CLIENT_ID}. */
export const ASTRAFLOW_CLIENT_HEADER_NAME = "ASTRAFLOW_CLIENT_ID"

export const ASTRAFLOW_CLIENT_HEADERS: Readonly<Record<string, string>> = {
  [ASTRAFLOW_CLIENT_HEADER_NAME]: ASTRAFLOW_CLIENT_ID,
}

export function withAstraflowClientHeaders(
  headers?: Record<string, string> | null
): Record<string, string> {
  return {
    ...ASTRAFLOW_CLIENT_HEADERS,
    ...(headers ?? {}),
  }
}

/** Claude Code / Claude Agent SDK custom header env format: `Name: value`. */
export function formatAnthropicCustomHeaders(
  headers: Record<string, string>
): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join("\n")
}
