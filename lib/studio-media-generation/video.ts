import { randomUUID } from "node:crypto"

import {
  coerceFieldValue,
  getFieldKey,
  getParamValue,
  appendFormDataValue,
  getAsyncTaskId,
  getAsyncTaskStatus,
  isTaskFailure,
  isTaskSuccess,
  mergeOutputMetadata,
  getProviderErrorMessage,
  parseDataUrl as parseStrictDataUrl,
  readNumber,
  setPayloadValue,
  sleep,
} from "@/lib/studio-generation-shared"
import {
  createStudioVideoGeneration,
  createStudioVideoOutput,
  listStudioVideoGenerations,
  recordStudioVideoGenerationTask,
  updateStudioVideoGeneration,
} from "@/lib/studio-video-db"
import { getStudioSession } from "@/lib/studio-db"
import {
  downloadUrlToStudioMediaFile,
  writeDataUrlToStudioMediaFile,
} from "@/lib/studio-media-storage"
import type {
  StudioVideoGeneration,
  StudioVideoModelOpenapi,
  StudioVideoOutput,
  StudioVideoParameterField,
  StudioVideoStatus,
} from "@/lib/studio-video-types"
import {
  getVideoOpenapiEntry,
  getVideoModelEndpoint,
  getVideoTaskStatusEndpoint,
  resolveVideoModelOperation,
} from "@/lib/video-openapi"
import {
  GenerateStudioVideoInput,
  StudioMediaAttachment,
  StudioMediaOutputResult,
  createMediaJobLeaseOwner,
  getOpenAiVideoTaskStatus,
  getTaskRawStatus,
  isoAfter,
  mediaJobLeaseExpiresAt,
  mergeMediaReferenceAttachments,
  mergeReferenceAttachments,
  mergeFieldDefaultParams,
  outputSessionFileId,
} from "@/lib/studio-media-generation/shared"

type ProviderResponse = {
  ok: boolean
  status: number
  body: unknown
}

const TRANSIENT_PROVIDER_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export type StudioVideoGenerationResult = {
  kind: "video"
  generationId: string
  status: StudioVideoStatus
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
  providerTaskId: string | null
  providerRequestId: string | null
  outputs: StudioMediaOutputResult[]
  errorMessage: string | null
}


type NormalizedVideoOutput = {
  url?: string | null
  dataUrl?: string | null
  storagePath?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  durationSeconds?: number | null
  metadata?: unknown
}


const VIDEO_ASYNC_TASK_MAX_POLLS = 720

const VIDEO_ASYNC_TASK_POLL_INTERVAL_MS = 5_000

const activeVideoGenerationTasks = new Set<string>()


function mediaForField({
  media,
  attachments,
  field,
}: {
  media: Record<string, StudioMediaAttachment[]>
  attachments: StudioMediaAttachment[]
  field: StudioVideoParameterField
}) {
  const specific =
    media[getFieldKey(field)] ??
    media[field.name] ??
    media[field.payloadPath.at(-1) ?? ""]

  if (specific) {
    return specific
  }

  return Object.keys(media).length > 0 ? [] : attachments
}


function allMediaAttachments({
  media,
  attachments,
}: {
  media: Record<string, StudioMediaAttachment[]>
  attachments: StudioMediaAttachment[]
}) {
  const values = Object.values(media).flat()

  return values.length > 0 ? values : attachments
}


function firstMediaValue(
  attachments: StudioMediaAttachment[],
  paramsValue: unknown
) {
  if (typeof paramsValue === "string" && paramsValue.trim()) {
    return paramsValue.trim()
  }

  const first = attachments[0]
  return first?.url ?? first?.dataUrl ?? undefined
}


function mediaValueForField(
  field: StudioVideoParameterField,
  attachments: StudioMediaAttachment[],
  paramsValue: unknown
) {
  const values = attachments
    .map((attachment) => attachment.url ?? attachment.dataUrl ?? null)
    .filter((value): value is string => Boolean(value))

  if (typeof paramsValue === "string" && paramsValue.trim()) {
    values.unshift(paramsValue.trim())
  }

  if (values.length === 0) {
    return undefined
  }

  const first = values[0]
  const parsed = first.startsWith("data:") ? parseStrictDataUrl(first) : null

  if (parsed && field.mediaShape === "object-base64") {
    return {
      bytesBase64Encoded: parsed.base64,
      mimeType: parsed.mimeType,
    }
  }

  if (field.mediaShape === "array-object") {
    const payloadKey = field.mediaPayloadKey ?? field.name

    return values.map((value, index) => {
      const item: Record<string, unknown> = { [payloadKey]: value }
      const roleValue = field.mediaRoleValues?.[index]

      if (field.mediaRoleKey && roleValue) {
        item[field.mediaRoleKey] = roleValue
      }

      return item
    })
  }

  if (field.acceptMultiple) {
    return values
  }

  return first
}


function buildContentItems(
  prompt: string,
  attachments: StudioMediaAttachment[]
) {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: prompt,
    },
  ]

  attachments.forEach((attachment, index) => {
    const value = attachment.url ?? attachment.dataUrl
    if (!value) return

    content.push({
      type: "image_url",
      image_url: { url: value },
      role:
        index === 0
          ? "first_frame"
          : index === 1
            ? "last_frame"
            : "reference_image",
    })
  })

  return content
}


function buildVideoPayload({
  openapi,
  fields,
  prompt,
  params,
  media,
  attachments,
}: {
  openapi: StudioVideoModelOpenapi
  fields: StudioVideoParameterField[]
  prompt: string
  params: Record<string, unknown>
  media: Record<string, StudioMediaAttachment[]>
  attachments: StudioMediaAttachment[]
}) {
  const payload: Record<string, unknown> = {
    model: openapi.modelConstant,
    input: {},
    parameters: {},
  }

  for (const field of fields) {
    if (field.name === "model") {
      continue
    }

    const fieldAttachments = mediaForField({ media, attachments, field })
    const paramValue = getParamValue(params, field)
    let value: unknown

    if (field.name === "prompt" || field.name === "text") {
      value = prompt
    } else if (field.mediaShape === "content-item") {
      value = buildContentItems(prompt, fieldAttachments)
    } else if (field.name === "content") {
      value =
        coerceFieldValue(field, paramValue) ??
        buildContentItems(prompt, fieldAttachments)
    } else if (field.kind === "image") {
      value = mediaValueForField(field, fieldAttachments, paramValue)
    } else if (field.constantValue !== undefined) {
      value = field.constantValue
    } else {
      value = coerceFieldValue(field, paramValue)
    }

    if (value === undefined) {
      continue
    }

    if (
      field.options &&
      field.options.length > 0 &&
      field.arrayItemKey !== undefined
    ) {
      const stringValue = String(value)
      value = [
        field.arrayItemKey
          ? { [field.arrayItemKey]: stringValue }
          : stringValue,
      ]
    }

    setPayloadValue(payload, field.payloadPath, value)
  }

  const knownPaths = new Set(fields.map((field) => field.payloadPath.join(".")))

  if (!knownPaths.has("input.prompt") && !knownPaths.has("input.content")) {
    setPayloadValue(payload, ["input", "prompt"], prompt)
  }

  const firstAttachment = firstMediaValue(
    allMediaAttachments({ media, attachments }),
    undefined
  )
  if (firstAttachment) {
    for (const name of ["img_url", "image_url", "first_frame_url"]) {
      const hasPath = knownPaths.has(`input.${name}`)
      const inputPayload = payload.input as Record<string, unknown>
      const current = inputPayload[name]

      if (hasPath && current === undefined) {
        setPayloadValue(payload, ["input", name], firstAttachment)
        break
      }
    }
  }

  return payload
}


function videoAttachmentToBlob(attachment: StudioMediaAttachment) {
  if (!attachment.dataUrl) {
    return null
  }

  const parsed = parseStrictDataUrl(attachment.dataUrl)

  if (!parsed) {
    return null
  }

  const bytes = Buffer.from(parsed.base64, "base64")

  return {
    blob: new Blob([bytes], { type: parsed.mimeType }),
    name:
      attachment.name?.trim() ||
      `reference.${parsed.mimeType.split("/")[1] ?? "jpg"}`,
  }
}


function buildOpenAiVideoFormData({
  openapi,
  fields,
  prompt,
  params,
  media,
  attachments,
}: {
  openapi: StudioVideoModelOpenapi
  fields: StudioVideoParameterField[]
  prompt: string
  params: Record<string, unknown>
  media: Record<string, StudioMediaAttachment[]>
  attachments: StudioMediaAttachment[]
}) {
  const formData = new FormData()
  const appended = new Set<string>()

  for (const field of fields) {
    const key = field.payloadPath.at(-1) ?? field.name

    if (!key || appended.has(key)) {
      continue
    }

    if (field.kind === "image") {
      const first = mediaForField({ media, attachments, field })[0]

      if (!first) {
        continue
      }

      const file = videoAttachmentToBlob(first)

      if (!file) {
        throw new Error(`${field.label} requires a local image file.`)
      }

      formData.append(key, file.blob, file.name)
      appended.add(key)
      continue
    }

    const value =
      field.name === "prompt" || field.name === "text"
        ? prompt
        : field.name === "model"
          ? (field.constantValue ?? openapi.modelConstant)
          : (field.constantValue ??
            coerceFieldValue(field, getParamValue(params, field)))

    appendFormDataValue(formData, key, value)
    appended.add(key)
  }

  if (!appended.has("model")) {
    formData.append("model", openapi.modelConstant)
  }

  if (!appended.has("prompt")) {
    formData.append("prompt", prompt)
  }

  return formData
}


async function callVideoProvider({
  url,
  payload,
  apiKey,
}: {
  url: string
  payload: unknown
  apiKey: string
}): Promise<ProviderResponse> {
  const isMultipart = payload instanceof FormData
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  }

  if (!isMultipart) {
    headers["Content-Type"] = "application/json"
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


function getProviderRequestId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const requestId = (payload as { request_id?: unknown }).request_id

  if (typeof requestId === "string" && requestId) {
    return requestId
  }

  if (typeof requestId === "number" && Number.isFinite(requestId)) {
    return String(requestId)
  }

  return null
}


function getOpenAiVideoTaskId(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const id = (payload as { id?: unknown }).id

  return typeof id === "string" && id ? id : null
}


function isTransientProviderStatus(status: number) {
  return TRANSIENT_PROVIDER_STATUSES.has(status)
}


async function pollVideoAsyncTask({
  statusUrl,
  taskId,
  apiKey,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
}): Promise<ProviderResponse> {
  const url = new URL(statusUrl)
  url.searchParams.set("task_id", taskId)
  let lastTransientError: ProviderResponse | null = null

  for (let attempt = 0; attempt < VIDEO_ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS)
    }

    let response: Response

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
    } catch (error) {
      lastTransientError = {
        ok: false,
        status: 0,
        body: {
          error: {
            message:
              error instanceof Error
                ? error.message
                : "Task status request failed.",
          },
        },
      }
      continue
    }

    const text = await response.text()
    let parsed: unknown = null

    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!response.ok) {
      if (isTransientProviderStatus(response.status)) {
        lastTransientError = {
          ok: false,
          status: response.status,
          body: parsed,
        }
        continue
      }

      return { ok: false, status: response.status, body: parsed }
    }

    lastTransientError = null
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
        message: "Async video task polling window expired.",
      },
      lastTransientError,
    },
  }
}


async function pollOpenAiVideoTask({
  statusUrl,
  taskId,
  apiKey,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
}): Promise<ProviderResponse> {
  const url = statusUrl.replace("{task_id}", encodeURIComponent(taskId))
  let lastTransientError: ProviderResponse | null = null

  for (let attempt = 0; attempt < VIDEO_ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS)
    }

    let response: Response

    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      })
    } catch (error) {
      lastTransientError = {
        ok: false,
        status: 0,
        body: {
          error: {
            message:
              error instanceof Error
                ? error.message
                : "Video status request failed.",
          },
        },
      }
      continue
    }

    const text = await response.text()
    let parsed: unknown = null

    try {
      parsed = text ? JSON.parse(text) : null
    } catch {
      parsed = text
    }

    if (!response.ok) {
      if (isTransientProviderStatus(response.status)) {
        lastTransientError = {
          ok: false,
          status: response.status,
          body: parsed,
        }
        continue
      }

      return { ok: false, status: response.status, body: parsed }
    }

    lastTransientError = null
    const taskStatus = getOpenAiVideoTaskStatus(parsed)

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
        message: "OpenAI video task polling window expired.",
      },
      lastTransientError,
    },
  }
}


async function downloadOpenAiVideoContent({
  statusUrl,
  taskId,
  apiKey,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
}): Promise<NormalizedVideoOutput> {
  const contentUrl = `${statusUrl.replace(
    "{task_id}",
    encodeURIComponent(taskId)
  )}/content`
  const response = await fetch(contentUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Provider content download returned ${response.status}`)
  }

  const mimeType = response.headers.get("content-type") ?? "video/mp4"
  const arrayBuffer = await response.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString("base64")

  return {
    url: null,
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    width: null,
    height: null,
    durationSeconds: null,
    metadata: { contentUrl },
  }
}


function extractVideoOutputs(payload: unknown): NormalizedVideoOutput[] {
  if (!payload || typeof payload !== "object") {
    return []
  }

  const finalPayload =
    "status" in payload ? (payload as { status?: unknown }).status : payload

  if (!finalPayload || typeof finalPayload !== "object") {
    return []
  }

  const output = (finalPayload as { output?: Record<string, unknown> }).output
  const usage = (finalPayload as { usage?: Record<string, unknown> }).usage
  const urls = Array.isArray(output?.urls) ? output.urls : []
  const durationSeconds =
    readNumber(usage?.duration) ??
    readNumber(usage?.output_video_duration) ??
    readNumber(output?.duration)

  return urls
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => ({
      url,
      dataUrl: null,
      mimeType: null,
      width: null,
      height: null,
      durationSeconds,
      metadata: output ?? null,
    }))
}


async function prepareAutoSavedVideoOutput({
  output,
  generationId,
  outputId,
}: {
  output: NormalizedVideoOutput
  generationId: string
  outputId: string
}): Promise<NormalizedVideoOutput> {
  if (output.storagePath) {
    return output
  }

  try {
    const saved = output.dataUrl
      ? writeDataUrlToStudioMediaFile({
          kind: "video",
          generationId,
          outputId,
          dataUrl: output.dataUrl,
          fallbackMimeType: output.mimeType,
        })
      : output.url
        ? await downloadUrlToStudioMediaFile({
            kind: "video",
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
      dataUrl: null,
      metadata: mergeOutputMetadata(output.metadata, {
        autoSaved: true,
        autoSaveDownloadError:
          error instanceof Error ? error.message : "Failed to download video.",
      }),
    }
  }
}


function toVideoOutputResult(
  output: StudioVideoOutput
): StudioMediaOutputResult {
  return {
    id: output.id,
    index: output.index,
    sessionFileId: outputSessionFileId({
      kind: "video",
      outputId: output.id,
      storagePath: output.storagePath,
    }),
    contentUrl: `/api/studio/video-outputs/${encodeURIComponent(
      output.id
    )}/content`,
    url: output.url,
    storagePath: output.storagePath,
    mimeType: output.mimeType,
    width: output.width,
    height: output.height,
    durationSeconds: output.durationSeconds,
  }
}


function toVideoGenerationResult(
  generation: StudioVideoGeneration
): StudioVideoGenerationResult {
  return {
    kind: "video",
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
    providerTaskId: generation.providerTaskId,
    providerRequestId: generation.providerRequestId,
    outputs: generation.outputs.map(toVideoOutputResult),
    errorMessage: generation.errorMessage,
  }
}


function shouldResumeStudioVideoGeneration(generation: StudioVideoGeneration) {
  if (
    !generation.providerTaskId ||
    generation.status === "complete" ||
    generation.status === "partial" ||
    generation.status === "error" ||
    generation.status === "cancelled"
  ) {
    return false
  }

  return (
    generation.status === "queued" ||
    generation.status === "running" ||
    generation.status === "polling"
  )
}


export async function resumeStudioVideoGeneration({
  generation,
  apiKey,
}: {
  generation: StudioVideoGeneration
  apiKey: string
}): Promise<StudioVideoGenerationResult> {
  if (!shouldResumeStudioVideoGeneration(generation)) {
    return toVideoGenerationResult(generation)
  }

  const entry = getVideoOpenapiEntry(
    generation.openapiFile,
    generation.operationId
  )
  const taskId = generation.providerTaskId

  if (!entry || !taskId) {
    return toVideoGenerationResult(generation)
  }

  const statusUrl = getVideoTaskStatusEndpoint(entry)
  let providerRequestId = generation.providerRequestId
  const leaseOwner = createMediaJobLeaseOwner()
  const pollingStartedAt = new Date().toISOString()
  const nextAttempt = generation.attempt + 1

  updateStudioVideoGeneration(generation.id, {
    status: "polling",
    phase: "polling",
    progress: Math.max(generation.progress ?? 0, 0.1),
    rawStatus: generation.rawStatus ?? "polling",
    attempt: nextAttempt,
    lastPolledAt: pollingStartedAt,
    nextPollAt: isoAfter(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS),
    leaseOwner,
    leaseExpiresAt: mediaJobLeaseExpiresAt(),
    providerTaskId: taskId,
    providerRequestId,
  })

  try {
    let providerResponse: ProviderResponse
    let outputs: NormalizedVideoOutput[] = []

    if (entry.adapter === "openai-video") {
      const statusResponse = await pollOpenAiVideoTask({
        statusUrl,
        taskId,
        apiKey,
      })

      providerRequestId =
        getProviderRequestId(statusResponse.body) ?? providerRequestId
      providerResponse = {
        ok: statusResponse.ok,
        status: statusResponse.status,
        body: {
          task_id: taskId,
          request_id: providerRequestId,
          status: statusResponse.body,
          resumed: true,
        },
      }

      if (statusResponse.ok) {
        outputs = [
          await downloadOpenAiVideoContent({
            statusUrl,
            taskId,
            apiKey,
          }),
        ]
      }
    } else {
      const statusResponse = await pollVideoAsyncTask({
        statusUrl,
        taskId,
        apiKey,
      })

      providerRequestId =
        getProviderRequestId(statusResponse.body) ?? providerRequestId
      providerResponse = {
        ok: statusResponse.ok,
        status: statusResponse.status,
        body: {
          task_id: taskId,
          request_id: providerRequestId,
          status: statusResponse.body,
          resumed: true,
        },
      }

      if (providerResponse.ok) {
        outputs = extractVideoOutputs(providerResponse.body)
      }
    }

    if (!providerResponse.ok) {
      const message = getProviderErrorMessage(
        providerResponse.body,
        `Provider returned ${providerResponse.status}`
      )

      updateStudioVideoGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: getTaskRawStatus(providerResponse.body) ?? "error",
        errorMessage: String(message),
        rawResponse: providerResponse.body,
        providerTaskId: taskId,
        providerRequestId,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toVideoGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: getTaskRawStatus(providerResponse.body) ?? "error",
        attempt: nextAttempt,
        lastPolledAt: pollingStartedAt,
        providerTaskId: taskId,
        providerRequestId,
        errorMessage: String(message),
      }
    }

    if (outputs.length === 0) {
      const message = "No video returned by the provider."

      updateStudioVideoGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "empty_output",
        errorMessage: message,
        rawResponse: providerResponse.body,
        providerTaskId: taskId,
        providerRequestId,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toVideoGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "empty_output",
        attempt: nextAttempt,
        lastPolledAt: pollingStartedAt,
        providerTaskId: taskId,
        providerRequestId,
        errorMessage: message,
      }
    }

    const autoSavedOutputs = await Promise.all(
      outputs.map(async (output, index) => {
        const outputId = randomUUID()

        return {
          outputId,
          index,
          output: await prepareAutoSavedVideoOutput({
            output,
            generationId: generation.id,
            outputId,
          }),
        }
      })
    )
    const storedOutputs: StudioVideoOutput[] = []

    autoSavedOutputs.forEach(({ output, outputId, index }) => {
      storedOutputs.push(
        createStudioVideoOutput({
          id: outputId,
          generationId: generation.id,
          index,
          url: output.url ?? null,
          dataUrl: null,
          storagePath: output.storagePath ?? null,
          mimeType: output.mimeType ?? null,
          width: output.width ?? null,
          height: output.height ?? null,
          durationSeconds: output.durationSeconds ?? null,
          metadata: output.metadata,
          autoSave: true,
        })
      )
    })

    const completedAt = new Date().toISOString()

    updateStudioVideoGeneration(generation.id, {
      status: "complete",
      phase: "complete",
      progress: 1,
      rawStatus: getTaskRawStatus(providerResponse.body) ?? "complete",
      rawResponse: providerResponse.body,
      providerTaskId: taskId,
      providerRequestId,
      completedAt,
      leaseOwner,
      leaseExpiresAt: completedAt,
    })

    return toVideoGenerationResult({
      ...generation,
      status: "complete",
      phase: "complete",
      progress: 1,
      rawStatus: getTaskRawStatus(providerResponse.body) ?? "complete",
      attempt: nextAttempt,
      lastPolledAt: pollingStartedAt,
      providerTaskId: taskId,
      providerRequestId,
      completedAt,
      outputs: storedOutputs,
      errorMessage: null,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video generation failed."

    updateStudioVideoGeneration(generation.id, {
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
      providerTaskId: taskId,
      providerRequestId,
      leaseOwner,
      leaseExpiresAt: new Date().toISOString(),
    })

    return {
      ...toVideoGenerationResult(generation),
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      attempt: nextAttempt,
      lastPolledAt: pollingStartedAt,
      providerTaskId: taskId,
      providerRequestId,
      errorMessage: message,
    }
  }
}


export function scheduleStudioVideoGenerationResume({
  generation,
  apiKey,
}: {
  generation: StudioVideoGeneration
  apiKey: string
}) {
  if (!shouldResumeStudioVideoGeneration(generation)) {
    return
  }

  if (activeVideoGenerationTasks.has(generation.id)) {
    return
  }

  activeVideoGenerationTasks.add(generation.id)
  void (async () => {
    try {
      await resumeStudioVideoGeneration({ generation, apiKey })
    } finally {
      activeVideoGenerationTasks.delete(generation.id)
    }
  })()
}


export function scheduleStudioVideoGenerationResumesForSession({
  sessionId,
  apiKey,
}: {
  sessionId: string
  apiKey: string
}) {
  for (const generation of listStudioVideoGenerations(sessionId)) {
    scheduleStudioVideoGenerationResume({ generation, apiKey })
  }
}


export async function submitStudioVideoGeneration(
  input: GenerateStudioVideoInput
): Promise<StudioVideoGenerationResult> {
  const session = getStudioSession(input.sessionId)

  if (!session) {
    throw new Error("Session not found.")
  }

  const modelId = input.modelId?.trim() || input.modelName
  const modelName = input.modelName.trim()
  const prompt = input.prompt.trim()
  const rawParams = input.params ?? {}
  const media = mergeMediaReferenceAttachments({
    media: input.media ?? {},
    mediaReferences: input.mediaReferences ?? {},
    sessionId: input.sessionId,
  })
  const attachments = mergeReferenceAttachments({
    attachments: input.attachments ?? [],
    references: input.references ?? [],
    sessionId: input.sessionId,
  })
  const resolvedOperation = resolveVideoModelOperation({
    modelId,
    modelName,
    file: input.openapiFile,
    operationId: input.operationId,
  })

  if (!resolvedOperation) {
    throw new Error("Video operation is not supported for this model.")
  }

  if (resolvedOperation.fields.length === 0) {
    throw new Error("Video operation fields are not available.")
  }

  const params = mergeFieldDefaultParams(resolvedOperation.fields, rawParams)
  const leaseOwner = createMediaJobLeaseOwner()
  const generation = createStudioVideoGeneration({
    sessionId: input.sessionId,
    modelSquareId: modelId,
    modelName,
    openapiFile: resolvedOperation.openapi.file,
    operationId: resolvedOperation.openapi.operationId,
    prompt,
    params,
    status: "running",
    phase: "submitting",
    progress: 0,
    attempt: 0,
    leaseOwner,
    leaseExpiresAt: mediaJobLeaseExpiresAt(),
  })
  const endpointUrl = getVideoModelEndpoint(resolvedOperation.openapi)
  const payload =
    resolvedOperation.openapi.adapter === "openai-video"
      ? buildOpenAiVideoFormData({
          openapi: resolvedOperation.openapi,
          fields: resolvedOperation.fields,
          prompt,
          params,
          media,
          attachments,
        })
      : buildVideoPayload({
          openapi: resolvedOperation.openapi,
          fields: resolvedOperation.fields,
          prompt,
          params,
          media,
          attachments,
        })

  try {
    const providerResponse = await callVideoProvider({
      url: endpointUrl,
      payload,
      apiKey: input.apiKey,
    })
    const providerRequestId = getProviderRequestId(providerResponse.body)

    if (!providerResponse.ok) {
      const message = getProviderErrorMessage(
        providerResponse.body,
        `Provider returned ${providerResponse.status}`
      )

      updateStudioVideoGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: getTaskRawStatus(providerResponse.body) ?? "error",
        errorMessage: String(message),
        rawResponse: providerResponse.body,
        providerRequestId,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toVideoGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: getTaskRawStatus(providerResponse.body) ?? "error",
        providerRequestId,
        errorMessage: String(message),
      }
    }

    const providerTaskId =
      resolvedOperation.openapi.adapter === "openai-video"
        ? getOpenAiVideoTaskId(providerResponse.body)
        : getAsyncTaskId(providerResponse.body)

    if (!providerTaskId) {
      const message = "No async task id returned by the provider."

      updateStudioVideoGeneration(generation.id, {
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "missing_task_id",
        errorMessage: message,
        rawResponse: providerResponse.body,
        providerRequestId,
        leaseOwner,
        leaseExpiresAt: new Date().toISOString(),
      })

      return {
        ...toVideoGenerationResult(generation),
        status: "error",
        phase: "error",
        progress: generation.progress ?? 0,
        rawStatus: "missing_task_id",
        providerRequestId,
        errorMessage: message,
      }
    }

    recordStudioVideoGenerationTask(generation.id, {
      providerTaskId,
      providerRequestId,
    })
    updateStudioVideoGeneration(generation.id, {
      status: "polling",
      phase: "polling",
      progress: 0.05,
      rawStatus: getTaskRawStatus(providerResponse.body) ?? "submitted",
      rawResponse: providerResponse.body,
      providerTaskId,
      providerRequestId,
      nextPollAt: isoAfter(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS),
      leaseOwner,
      leaseExpiresAt: mediaJobLeaseExpiresAt(),
      completedAt: null,
    })

    const runningGeneration: StudioVideoGeneration = {
      ...generation,
      providerTaskId,
      providerRequestId,
      status: "polling",
      phase: "polling",
      progress: 0.05,
      rawStatus: getTaskRawStatus(providerResponse.body) ?? "submitted",
      nextPollAt: isoAfter(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS),
    }

    scheduleStudioVideoGenerationResume({
      generation: runningGeneration,
      apiKey: input.apiKey,
    })

    return toVideoGenerationResult(runningGeneration)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Video generation failed."

    updateStudioVideoGeneration(generation.id, {
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
      leaseOwner,
      leaseExpiresAt: new Date().toISOString(),
    })

    return {
      ...toVideoGenerationResult(generation),
      status: "error",
      phase: "error",
      progress: generation.progress ?? 0,
      rawStatus: "exception",
      errorMessage: message,
    }
  }
}
