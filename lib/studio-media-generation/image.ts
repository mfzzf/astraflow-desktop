import { randomUUID } from "node:crypto"

import {
  getImageModelConstantForRequest,
  getImageModelEndpoint,
  getImageModelRegistryEntry,
  type ImageOpenapiRegistryEntry,
} from "@/lib/image-model-openapi"
import { loadImageModelOperationFields } from "@/lib/image-openapi"
import { withAstraflowClientHeaders } from "@/lib/review-client"
import {
  coerceFieldValue,
  getAsyncTaskId,
  getAsyncTaskStatus,
  getProviderErrorMessage,
  isTaskFailure,
  isTaskSuccess,
  mergeOutputMetadata,
  sleep,
} from "@/lib/studio-generation-shared"
import {
  createStudioImageGeneration,
  createStudioImageOutput,
  getStudioSession,
  updateStudioImageGeneration,
} from "@/lib/studio-db"
import {
  downloadUrlToStudioMediaFile,
  writeDataUrlToStudioMediaFile,
} from "@/lib/studio-media-storage"
import type {
  StudioImageGeneration,
  StudioImageOutput,
  StudioImageParameterField,
  StudioImageStatus,
} from "@/lib/studio-types"
import {
  StudioMediaAttachment,
  StudioMediaOutputResult,
  GenerateStudioImageInput,
  createMediaJobLeaseOwner,
  extensionFromMimeType,
  getTaskRawStatus,
  isoAfter,
  mediaJobLeaseExpiresAt,
  mergeFieldDefaultParams,
  mergeReferenceAttachments,
  outputSessionFileId,
} from "@/lib/studio-media-generation/shared"
import type { StudioVideoGenerationResult } from "@/lib/studio-media-generation/video"

export type StudioImageGenerationResult = {
  kind: "image"
  generationId: string
  status: StudioImageStatus
  model: {
    id: string
    name: string
    openapiFile: string | null
    operationId: string | null
  }
  prompt: string
  phase: string | null
  progress: number | null
  rawStatus: string | null
  attempt: number
  lastPolledAt: string | null
  nextPollAt: string | null
  outputs: StudioMediaOutputResult[]
  errorMessage: string | null
}


type ProviderResponse = {
  ok: boolean
  status: number
  body: unknown
}


type NormalizedImageOutput = {
  url?: string | null
  dataUrl?: string | null
  storagePath?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  metadata?: unknown
}


const IMAGE_ASYNC_TASK_MAX_POLLS = 45

const IMAGE_ASYNC_TASK_POLL_INTERVAL_MS = 2_000

function dataUrlFromBase64(value: string, fallbackMime: string) {
  if (value.startsWith("data:")) {
    return value
  }

  return `data:${fallbackMime};base64,${value}`
}


function parseImageDataUrl(value: string) {
  const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/)

  if (!match) {
    return null
  }

  const mimeType = match[1] || "image/png"
  const isBase64 = Boolean(match[2])
  const raw = match[3] ?? ""
  const bytes = isBase64
    ? Buffer.from(raw, "base64")
    : Buffer.from(decodeURIComponent(raw), "utf8")

  return { bytes, mimeType }
}


function attachmentFileName(
  attachment: StudioMediaAttachment,
  index: number,
  mimeType: string
) {
  const normalized = attachment.name?.trim()

  if (normalized) {
    return normalized
  }

  return `reference-${index + 1}.${extensionFromMimeType(mimeType)}`
}


async function imageAttachmentToBlob(
  attachment: StudioMediaAttachment,
  index: number
) {
  if (attachment.dataUrl) {
    const parsed = parseImageDataUrl(attachment.dataUrl)

    if (!parsed) {
      throw new Error("Invalid reference image data.")
    }

    return {
      blob: new Blob([parsed.bytes], { type: parsed.mimeType }),
      name: attachmentFileName(attachment, index, parsed.mimeType),
    }
  }

  if (attachment.url) {
    const response = await fetch(attachment.url)

    if (!response.ok) {
      throw new Error("Failed to fetch reference image URL.")
    }

    const responseMimeType = response.headers.get("content-type")?.split(";")[0]
    const attachmentMimeType =
      attachment.mimeType && attachment.mimeType !== "image/url"
        ? attachment.mimeType
        : null
    const mimeType = responseMimeType || attachmentMimeType || "image/png"
    const bytes = await response.arrayBuffer()

    return {
      blob: new Blob([bytes], { type: mimeType }),
      name: attachmentFileName(attachment, index, mimeType),
    }
  }

  throw new Error("Reference image is missing data.")
}


function fieldByName(fields: StudioImageParameterField[], name: string) {
  return fields.find((field) => field.name === name)
}


function buildOpenaiImagePayload({
  modelId,
  prompt,
  fields,
  params,
  attachments,
}: {
  modelId: string
  prompt: string
  fields: StudioImageParameterField[]
  params: Record<string, unknown>
  attachments: StudioMediaAttachment[]
}) {
  const payload: Record<string, unknown> = {
    model: modelId,
    prompt,
  }

  for (const field of fields) {
    if (field.name === "prompt" || field.name === "model") {
      continue
    }

    if (field.constantValue !== undefined) {
      payload[field.name] = field.constantValue
      continue
    }

    const value = coerceFieldValue(field, params[field.name])

    if (value === undefined) {
      continue
    }

    if (
      field.options &&
      field.options.length > 0 &&
      field.arrayItemKey !== undefined
    ) {
      const stringValue = String(value)
      payload[field.name] = [
        field.arrayItemKey
          ? { [field.arrayItemKey]: stringValue }
          : stringValue,
      ]
      continue
    }

    payload[field.name] = value
  }

  if (attachments.length > 0) {
    const imageField = fieldByName(fields, "image")
    const imagesField = fieldByName(fields, "images")

    if (imagesField) {
      payload.images = attachments
        .map((attachment) => attachment.url ?? attachment.dataUrl ?? null)
        .filter(Boolean)
    } else if (imageField) {
      const first = attachments[0]
      payload.image = first.url ?? first.dataUrl
    }
  }

  return payload
}


async function buildOpenaiImageEditPayload({
  modelId,
  prompt,
  fields,
  params,
  attachments,
}: {
  modelId: string
  prompt: string
  fields: StudioImageParameterField[]
  params: Record<string, unknown>
  attachments: StudioMediaAttachment[]
}) {
  const form = new FormData()
  form.append("model", modelId)
  form.append("prompt", prompt)

  for (const field of fields) {
    if (
      field.name === "prompt" ||
      field.name === "model" ||
      field.name === "image" ||
      field.name === "image[]" ||
      field.name === "mask"
    ) {
      continue
    }

    if (field.constantValue !== undefined) {
      form.append(field.name, String(field.constantValue))
      continue
    }

    const value = coerceFieldValue(field, params[field.name])

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      form.append(field.name, String(value))
    }
  }

  const files = await Promise.all(attachments.map(imageAttachmentToBlob))
  const imageFieldName = files.length > 1 ? "image[]" : "image"

  for (const file of files) {
    form.append(imageFieldName, file.blob, file.name)
  }

  return form
}


function buildGeminiImagePayload({
  prompt,
  fields,
  params,
  attachments,
}: {
  prompt: string
  fields: StudioImageParameterField[]
  params: Record<string, unknown>
  attachments: StudioMediaAttachment[]
}) {
  const parts: Array<Record<string, unknown>> = [{ text: prompt }]

  for (const attachment of attachments) {
    if (attachment.dataUrl) {
      const match = attachment.dataUrl.match(/^data:([^;]+);base64,(.+)$/)

      if (match) {
        parts.push({
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        })
        continue
      }
    }

    if (attachment.url) {
      parts.push({
        fileData: {
          mimeType: attachment.mimeType ?? "image/png",
          fileUri: attachment.url,
        },
      })
    }
  }

  const aspectRatio = params.aspectRatio
  const imageSize = params.imageSize
  const generationConfig: Record<string, unknown> = {
    responseModalities: ["TEXT", "IMAGE"],
  }

  if (typeof aspectRatio === "string" || typeof imageSize === "string") {
    const imageConfig: Record<string, unknown> = {}

    if (typeof aspectRatio === "string" && aspectRatio) {
      imageConfig.aspectRatio = aspectRatio
    }
    if (typeof imageSize === "string" && imageSize) {
      imageConfig.imageSize = imageSize
    }

    generationConfig.imageConfig = imageConfig
  }

  for (const field of fields) {
    if (
      field.name === "prompt" ||
      field.name === "image" ||
      field.name === "aspectRatio" ||
      field.name === "imageSize" ||
      field.name === "responseModalities"
    ) {
      continue
    }

    const value = coerceFieldValue(field, params[field.name])

    if (value !== undefined) {
      generationConfig[field.name] = value
    }
  }

  return {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig,
  }
}


function buildAsyncImageTaskPayload(modelId: string, prompt: string) {
  if (modelId === "midjourney-fast-imagine") {
    return {
      model: modelId,
      input: {
        prompt,
      },
    }
  }

  return {
    model: modelId,
    input: {},
  }
}


async function callImageProvider({
  url,
  payload,
  apiKey,
  adapter,
}: {
  url: string
  payload: unknown
  apiKey: string
  adapter: string
}): Promise<ProviderResponse> {
  const isMultipart = payload instanceof FormData
  const headers: Record<string, string> = withAstraflowClientHeaders()

  if (!isMultipart) {
    headers["Content-Type"] = "application/json"
  }

  if (adapter === "gemini-generate-content") {
    headers["x-goog-api-key"] = apiKey
  } else {
    headers.Authorization = `Bearer ${apiKey}`
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: isMultipart ? payload : JSON.stringify(payload),
  })
  const text = await response.text()
  let parsed: unknown = null

  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }

  return { ok: response.ok, status: response.status, body: parsed }
}


async function pollImageAsyncTask({
  submitUrl,
  taskId,
  apiKey,
}: {
  submitUrl: string
  taskId: string
  apiKey: string
}): Promise<ProviderResponse> {
  const statusUrl = new URL("/v1/tasks/status", submitUrl)
  statusUrl.searchParams.set("task_id", taskId)

  for (let attempt = 0; attempt < IMAGE_ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(IMAGE_ASYNC_TASK_POLL_INTERVAL_MS)
    }

    const response = await fetch(statusUrl, {
      headers: withAstraflowClientHeaders({
        Authorization: `Bearer ${apiKey}`,
      }),
    })
    const text = await response.text()
    let parsed: unknown = null

    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!response.ok) {
      return { ok: false, status: response.status, body: parsed }
    }

    const taskStatus = getAsyncTaskStatus(parsed)

    if (isTaskSuccess(taskStatus)) {
      return { ok: true, status: response.status, body: parsed }
    }

    if (isTaskFailure(taskStatus)) {
      return { ok: false, status: response.status, body: parsed }
    }
  }

  return {
    ok: false,
    status: 504,
    body: {
      error: {
        message: "Async image task timed out.",
      },
    },
  }
}


function extractOpenaiImageOutputs(payload: unknown): NormalizedImageOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const data = (payload as { data?: Array<Record<string, unknown>> }).data

  if (!Array.isArray(data)) {
    return []
  }

  const outputs: NormalizedImageOutput[] = []

  for (const item of data) {
    const sizeRaw = typeof item.size === "string" ? item.size : null
    let width: number | null = null
    let height: number | null = null

    if (sizeRaw) {
      const match = sizeRaw.match(/^(\d+)[x*](\d+)$/)
      if (match) {
        width = Number(match[1])
        height = Number(match[2])
      }
    }

    const b64 = item.b64_json
    const url = item.url

    outputs.push({
      url: typeof url === "string" ? url : null,
      dataUrl:
        typeof b64 === "string" ? dataUrlFromBase64(b64, "image/png") : null,
      mimeType: null,
      width,
      height,
    })
  }

  return outputs
}


function extractGeminiImageOutputs(payload: unknown): NormalizedImageOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const candidates = (
    payload as {
      candidates?: Array<Record<string, unknown>>
    }
  ).candidates

  if (!Array.isArray(candidates)) {
    return []
  }

  const outputs: NormalizedImageOutput[] = []

  for (const candidate of candidates) {
    const content = candidate.content as Record<string, unknown> | undefined
    const parts = Array.isArray(content?.parts)
      ? (content?.parts as Array<Record<string, unknown>>)
      : []

    for (const part of parts) {
      const inline = part.inlineData as
        { data?: string; mimeType?: string } | undefined

      if (inline?.data) {
        const mime = inline.mimeType ?? "image/png"
        outputs.push({
          url: null,
          dataUrl: dataUrlFromBase64(inline.data, mime),
          mimeType: mime,
          width: null,
          height: null,
        })
      }
    }
  }

  return outputs
}


function extractAsyncImageTaskOutputs(
  payload: unknown
): NormalizedImageOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const finalPayload =
    "status" in payload ? (payload as { status?: unknown }).status : payload

  if (!finalPayload || typeof finalPayload !== "object") {
    return []
  }

  const output = (finalPayload as { output?: Record<string, unknown> }).output
  const urls = Array.isArray(output?.urls) ? output.urls : []

  return urls
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => ({
      url,
      dataUrl: null,
      mimeType: null,
      width: null,
      height: null,
    }))
}


function extractImageOutputs(
  adapter: string,
  payload: unknown
): NormalizedImageOutput[] {
  if (adapter === "gemini-generate-content") {
    return extractGeminiImageOutputs(payload)
  }

  if (adapter === "async-task") {
    return extractAsyncImageTaskOutputs(payload)
  }

  return extractOpenaiImageOutputs(payload)
}


async function prepareAutoSavedImageOutput({
  output,
  generationId,
  outputId,
}: {
  output: NormalizedImageOutput
  generationId: string
  outputId: string
}): Promise<NormalizedImageOutput> {
  if (output.storagePath) {
    return output
  }

  try {
    const saved = output.dataUrl
      ? writeDataUrlToStudioMediaFile({
          kind: "image",
          generationId,
          outputId,
          dataUrl: output.dataUrl,
          fallbackMimeType: output.mimeType,
        })
      : output.url
        ? await downloadUrlToStudioMediaFile({
            kind: "image",
            generationId,
            outputId,
            url: output.url,
            fallbackMimeType: output.mimeType,
          })
        : null

    if (!saved) {
      return output
    }

    return {
      ...output,
      dataUrl: null,
      storagePath: saved.storagePath,
      mimeType: output.mimeType ?? saved.mimeType,
      metadata: mergeOutputMetadata(output.metadata, {
        sourceUrl: output.url ?? null,
        autoSaved: true,
      }),
    }
  } catch (error) {
    return {
      ...output,
      dataUrl: output.url ? null : (output.dataUrl ?? null),
      metadata: mergeOutputMetadata(output.metadata, {
        autoSaved: true,
        autoSaveDownloadError:
          error instanceof Error ? error.message : "Failed to save image.",
      }),
    }
  }
}


function getOpenapiImageOperation(
  registry: {
    openapi?: ImageOpenapiRegistryEntry
    editOpenapi?: ImageOpenapiRegistryEntry
  },
  operationId?: string
) {
  const operations = [registry.openapi, registry.editOpenapi].filter(
    (operation): operation is ImageOpenapiRegistryEntry => Boolean(operation)
  )

  if (!operationId) {
    return registry.openapi ?? null
  }

  return (
    operations.find((operation) => operation.operationId === operationId) ??
    null
  )
}


function toImageOutputResult(
  output: StudioImageOutput
): StudioMediaOutputResult {
  return {
    id: output.id,
    index: output.index,
    sessionFileId: outputSessionFileId({
      kind: "image",
      outputId: output.id,
      storagePath: output.storagePath,
    }),
    contentUrl: `/api/studio/image-outputs/${encodeURIComponent(
      output.id
    )}/content`,
    url: output.url,
    storagePath: output.storagePath,
    mimeType: output.mimeType,
    width: output.width,
    height: output.height,
  }
}


function toImageGenerationResult(
  generation: StudioImageGeneration
): StudioImageGenerationResult {
  return {
    kind: "image",
    generationId: generation.id,
    status: generation.status,
    model: {
      id: generation.modelSquareId,
      name: generation.modelName,
      openapiFile: generation.openapiFile,
      operationId: generation.operationId,
    },
    prompt: generation.prompt,
    phase: generation.phase,
    progress: generation.progress,
    rawStatus: generation.rawStatus,
    attempt: generation.attempt,
    lastPolledAt: generation.lastPolledAt,
    nextPollAt: generation.nextPollAt,
    outputs: generation.outputs.map(toImageOutputResult),
    errorMessage: generation.errorMessage,
  }
}


export async function generateStudioImage(
  input: GenerateStudioImageInput
): Promise<StudioImageGenerationResult> {
  const session = getStudioSession(input.sessionId)

  if (!session) {
    throw new Error("Session not found.")
  }

  const modelId = input.modelId?.trim() || input.modelName
  const modelName = input.modelName.trim()
  const prompt = input.prompt.trim()
  const rawParams = input.params ?? {}
  const attachments = mergeReferenceAttachments({
    attachments: input.attachments ?? [],
    references: input.references ?? [],
    sessionId: input.sessionId,
  })
  const registry =
    getImageModelRegistryEntry(modelName) ?? getImageModelRegistryEntry(modelId)

  if (!registry?.openapi || !registry.supported) {
    throw new Error("Image model is not supported.")
  }

  const openapi = getOpenapiImageOperation(registry, input.operationId)

  if (!openapi) {
    throw new Error("Image operation is not supported.")
  }

  if (openapi.adapter === "openai-images-edit" && attachments.length === 0) {
    throw new Error("Reference image is required for image editing.")
  }

  const fields = loadImageModelOperationFields(modelName, openapi.operationId)
  const params = mergeFieldDefaultParams(fields, rawParams)
  const leaseOwner = createMediaJobLeaseOwner()
  const generation = createStudioImageGeneration({
    sessionId: input.sessionId,
    modelSquareId: modelId,
    modelName,
    openapiFile: openapi.file,
    operationId: openapi.operationId,
    prompt,
    params,
    status: "running",
    phase: "submitting",
    progress: 0,
    attempt: 0,
    leaseOwner,
    leaseExpiresAt: mediaJobLeaseExpiresAt(),
  })
  const endpointUrl = getImageModelEndpoint(openapi, modelName)
  const modelConstant = getImageModelConstantForRequest(openapi, modelName)
  const payload =
    openapi.adapter === "gemini-generate-content"
      ? buildGeminiImagePayload({ prompt, fields, params, attachments })
      : openapi.adapter === "async-task"
        ? buildAsyncImageTaskPayload(modelConstant, prompt)
        : openapi.adapter === "openai-images-edit"
          ? await buildOpenaiImageEditPayload({
              modelId: modelConstant,
              prompt,
              fields,
              params,
              attachments,
            })
          : buildOpenaiImagePayload({
              modelId: modelConstant,
              prompt,
              fields,
              params,
              attachments,
            })

  try {
    let providerResponse = await callImageProvider({
      url: endpointUrl,
      payload,
      apiKey: input.apiKey,
      adapter: openapi.adapter,
    })

    if (providerResponse.ok && openapi.adapter === "async-task") {
      const taskId = getAsyncTaskId(providerResponse.body)

      if (!taskId) {
        providerResponse = {
          ok: false,
          status: 502,
          body: {
            submit: providerResponse.body,
            error: {
              message: "No async task id returned by the provider.",
            },
          },
        }
      } else {
        const pollingStartedAt = new Date().toISOString()

        updateStudioImageGeneration(generation.id, {
          status: "polling",
          phase: "polling",
          progress: 0.1,
          rawStatus: getAsyncTaskStatus(providerResponse.body) ?? "submitted",
          attempt: generation.attempt + 1,
          lastPolledAt: pollingStartedAt,
          nextPollAt: isoAfter(IMAGE_ASYNC_TASK_POLL_INTERVAL_MS),
          leaseOwner,
          leaseExpiresAt: mediaJobLeaseExpiresAt(),
          rawResponse: providerResponse.body,
        })

        const statusResponse = await pollImageAsyncTask({
          submitUrl: endpointUrl,
          taskId,
          apiKey: input.apiKey,
        })

        providerResponse = {
          ok: statusResponse.ok,
          status: statusResponse.status,
          body: {
            submit: providerResponse.body,
            status: statusResponse.body,
          },
        }
      }
    }

    if (!providerResponse.ok) {
      const message = getProviderErrorMessage(
        providerResponse.body,
        `Provider returned ${providerResponse.status}`
      )

      updateStudioImageGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus:
          getTaskRawStatus(providerResponse.body) ??
          getProviderErrorMessage(providerResponse.body, "error"),
        errorMessage: String(message),
        rawResponse: providerResponse.body,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toImageGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus:
          getTaskRawStatus(providerResponse.body) ??
          getProviderErrorMessage(providerResponse.body, "error"),
        errorMessage: String(message),
      }
    }

    const outputs = extractImageOutputs(openapi.adapter, providerResponse.body)

    if (outputs.length === 0) {
      const message = "No image returned by the provider."

      updateStudioImageGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "empty_output",
        errorMessage: message,
        rawResponse: providerResponse.body,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toImageGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "empty_output",
        errorMessage: message,
      }
    }

    const autoSavedOutputs = await Promise.all(
      outputs.map(async (output, index) => {
        const outputId = randomUUID()

        return {
          index,
          outputId,
          output: await prepareAutoSavedImageOutput({
            output,
            generationId: generation.id,
            outputId,
          }),
        }
      })
    )
    const stored: StudioImageOutput[] = []

    autoSavedOutputs.forEach(({ output, outputId, index }) => {
      stored.push(
        createStudioImageOutput({
          id: outputId,
          generationId: generation.id,
          index,
          url: output.url ?? null,
          dataUrl: output.dataUrl ?? null,
          storagePath: output.storagePath ?? null,
          mimeType: output.mimeType ?? null,
          width: output.width ?? null,
          height: output.height ?? null,
          metadata: output.metadata,
          autoSave: Boolean(output.storagePath || output.url || output.dataUrl),
        })
      )
    })

    updateStudioImageGeneration(generation.id, {
      status: "complete",
      phase: "complete",
      progress: 1,
      rawStatus: "complete",
      rawResponse: providerResponse.body,
      leaseOwner,
      leaseExpiresAt: new Date().toISOString(),
    })

    const completedAt = new Date().toISOString()

    return toImageGenerationResult({
      ...generation,
      status: "complete",
      phase: "complete",
      progress: 1,
      rawStatus: "complete",
      outputs: stored,
      completedAt,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image generation failed."

    updateStudioImageGeneration(generation.id, {
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
      leaseOwner,
      leaseExpiresAt: new Date().toISOString(),
    })

    return {
      ...toImageGenerationResult(generation),
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
    }
  }
}


export function formatMediaGenerationResult(
  result: StudioImageGenerationResult | StudioVideoGenerationResult
) {
  return JSON.stringify(result, null, 2)
}
