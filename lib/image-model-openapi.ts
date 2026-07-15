import { MODELVERSE_BASE_URL } from "@/lib/modelverse-config"
import type {
  StudioImageAdapter,
  StudioImageDisabledReason,
} from "@/lib/studio-types"

export type ImageOpenapiRegistryEntry = {
  file: string
  operationId: string
  method: "POST" | "GET"
  path: string
  contentType: "application/json" | "multipart/form-data"
  adapter: StudioImageAdapter
  modelConstant?: string
  endpointUrl?: string
}

export type ImageModelRegistryEntry = {
  supported: boolean
  openapi?: ImageOpenapiRegistryEntry
  editOpenapi?: ImageOpenapiRegistryEntry
  disabledReason?: StudioImageDisabledReason
}


const IMAGE_MODEL_DISPLAY_NAMES: Record<string, string> = {
  "doubao-seedream-4.5": "Doubao Seedream 4.5",
  "doubao-seedream-5-0-260128": "Doubao Seedream 5.0",
  "Qwen/Qwen-Image": "Qwen Image",
  "Qwen/Qwen-Image-Edit": "Qwen Image Edit",
  "stepfun-ai/step1x-edit": "Stepfun Step1X Edit",
  "wan2.7-image": "WAN 2.7 Image",
  "wan2.7-image-pro": "WAN 2.7 Image Pro",
}

const doubaoSeedream: ImageOpenapiRegistryEntry = {
  file: "openapi/image/doubao-seedream.yaml",
  operationId: "createDoubaoSeedreamImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
}

const qwenImage: ImageOpenapiRegistryEntry = {
  file: "openapi/image/Qwen-Qwen-Image.yaml",
  operationId: "createQwenQwenImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
  modelConstant: "Qwen/Qwen-Image",
}

const qwenImageEdit: ImageOpenapiRegistryEntry = {
  file: "openapi/image/Qwen-Qwen-Image-Edit.yaml",
  operationId: "createQwenQwenImageEditImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
  modelConstant: "Qwen/Qwen-Image-Edit",
}

const stepfunEdit: ImageOpenapiRegistryEntry = {
  file: "openapi/image/stepfun-ai-step1x-edit.yaml",
  operationId: "createStepfunStep1xEditImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
  modelConstant: "stepfun-ai/step1x-edit",
}

const wan27: ImageOpenapiRegistryEntry = {
  file: "openapi/image/Wan-AI-Wan2.7-Image.yaml",
  operationId: "createWanAIWan27ImageGeneration",
  method: "POST",
  path: "/v1/images/generations",
  contentType: "application/json",
  adapter: "openai-images",
}

// Review special-client: domestic image models only (Doubao / Qwen / WAN / Stepfun).
export const IMAGE_MODEL_REGISTRY: Record<string, ImageModelRegistryEntry> = {
  "doubao-seedream-4.5": { supported: true, openapi: doubaoSeedream },
  "doubao-seedream-5-0-260128": { supported: true, openapi: doubaoSeedream },
  "Qwen/Qwen-Image": { supported: true, openapi: qwenImage },
  "Qwen/Qwen-Image-Edit": {
    supported: false,
    disabledReason: "edit-only",
    openapi: qwenImageEdit,
  },
  "stepfun-ai/step1x-edit": {
    supported: false,
    disabledReason: "edit-only",
    openapi: stepfunEdit,
  },
  "wan2.7-image": { supported: true, openapi: wan27 },
  "wan2.7-image-pro": { supported: true, openapi: wan27 },
  "mimo-v2.5": { supported: false, disabledReason: "missing-openapi" },
}

export function normalizeImageModelKey(modelId: string) {
  return modelId.trim()
}

export function getImageModelRegistryEntry(modelId: string) {
  const normalized = normalizeImageModelKey(modelId)

  if (IMAGE_MODEL_REGISTRY[normalized]) {
    return IMAGE_MODEL_REGISTRY[normalized]
  }

  const fallback = normalized.replace(/^publishers\/google\/models\//, "")

  return IMAGE_MODEL_REGISTRY[fallback]
}

export function getImageModelDisplayName(modelId: string, fallback = modelId) {
  const normalized = normalizeImageModelKey(modelId)
  const publisherFallback = normalized.replace(/^publishers\/google\/models\//, "")

  return (
    IMAGE_MODEL_DISPLAY_NAMES[normalized] ??
    IMAGE_MODEL_DISPLAY_NAMES[publisherFallback] ??
    fallback.trim() ??
    modelId
  )
}

export function getImageModelEndpoint(
  entry: ImageOpenapiRegistryEntry,
  modelId: string
) {
  if (entry.adapter === "gemini-generate-content") {
    const modelSlug = entry.modelConstant ?? modelId
    return `${MODELVERSE_BASE_URL}/v1beta/models/${modelSlug}:generateContent`
  }

  return `${MODELVERSE_BASE_URL}${entry.path}`
}

export function getImageModelConstantForRequest(
  entry: ImageOpenapiRegistryEntry,
  modelId: string
) {
  return entry.modelConstant ?? modelId
}
