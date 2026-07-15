import { randomUUID } from "node:crypto"

import {
  coerceFieldValue,
  getFieldKey,
  getParamValue,
  appendFormDataValue,
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
import { withAstraflowClientHeaders } from "@/lib/review-client"
import type {
  StudioVideoGeneration,
  StudioVideoModelOpenapi,
  StudioVideoOutput,
  StudioVideoParameterField,
  StudioVideoPollingProtocol,
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
  getTaskRawStatus,
  isoAfter,
  mediaJobLeaseExpiresAt,
  mergeMediaReferenceAttachments,
  mergeReferenceAttachments,
  mergeFieldDefaultParams,
  outputSessionFileId,
} from "@/lib/studio-media-generation/shared"
import {
  STUDIO_VIDEO_INPUT_MODE_PARAM,
  evaluateVideoParameterRules,
  getVideoInputMode,
  getVideoModeMediaField,
  validateVideoConstraints,
  validateVideoModeMedia,
  validateVideoModeMediaSources,
} from "@/lib/studio-video-profile"
import {
  getVideoProtocolResultUrls,
  getVideoProtocolTaskId,
  getVideoProtocolTaskStatus,
  isVideoProtocolFailure,
  isVideoProtocolSuccess,
} from "@/lib/studio-video-protocol"
import {
  serializeVideoProfileMedia,
  serializeVideoStructuredFields,
} from "@/lib/studio-video-serialization"

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


function buildTextContent(prompt: string) {
  return prompt ? [{ type: "text", text: prompt }] : []
}


function buildVideoPayload({
  openapi,
  fields,
  prompt,
  params,
  media,
  inputModeId,
}: {
  openapi: StudioVideoModelOpenapi
  fields: StudioVideoParameterField[]
  prompt: string
  params: Record<string, unknown>
  media: Record<string, StudioMediaAttachment[]>
  inputModeId?: string | null
}) {
  const payload: Record<string, unknown> = {
    model: openapi.modelConstant,
    input: {},
    parameters: {},
  }
  const inputMode = getVideoInputMode(openapi.profile, inputModeId)

  for (const field of fields) {
    if (field.name === "model") {
      continue
    }

    const profileOwnsField = Boolean(
      inputMode?.media.some(
        (mediaField) =>
          mediaField.fieldPath.join(".") === field.payloadPath.join(".")
      )
    )
    if (profileOwnsField) {
      continue
    }
    if (
      field.kind === "image" &&
      field.mediaShape !== "content-item"
    ) {
      continue
    }

    const paramValue = getParamValue(params, field)
    let value: unknown

    if (field.name === "prompt" || field.name === "text") {
      value = prompt || (field.required ? prompt : undefined)
    } else if (field.mediaShape === "content-item") {
      value = buildTextContent(prompt)
    } else if (field.name === "content") {
      value = coerceFieldValue(field, paramValue) ?? buildTextContent(prompt)
    } else if (field.kind === "image") {
      continue
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

  if (inputMode) {
    for (const entry of serializeVideoProfileMedia({
      prompt,
      media,
      inputMode,
    })) {
      setPayloadValue(payload, entry.path, entry.value)
    }

    for (const entry of serializeVideoStructuredFields({
      inputMode,
      params,
    })) {
      setPayloadValue(payload, entry.path, entry.value)
    }
  }

  return payload
}

function normalizeVideoParamValues(
  fields: StudioVideoParameterField[],
  params: Record<string, unknown>
) {
  const normalized = { ...params }

  for (const field of fields) {
    const key = getFieldKey(field)
    const rawValue = getParamValue(params, field)
    const value = coerceFieldValue(field, rawValue)

    if (value !== undefined) {
      normalized[key] = value
    }
  }

  return normalized
}

function validateVideoParamValues(
  fields: StudioVideoParameterField[],
  params: Record<string, unknown>,
  omittedFields: Set<string>
) {
  for (const field of fields) {
    const key = getFieldKey(field)

    if (
      omittedFields.has(key) ||
      field.constantValue !== undefined ||
      field.kind === "image" ||
      field.name === "prompt" ||
      field.name === "text" ||
      field.name === "model"
    ) {
      continue
    }

    const rawValue = getParamValue(params, field)
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      continue
    }

    const value = coerceFieldValue(field, rawValue)
    if (
      value === undefined &&
      ["boolean", "integer", "number"].includes(field.valueType ?? "")
    ) {
      throw new Error(`${field.label} has an invalid value.`)
    }

    if (
      field.options?.length &&
      !field.options.some((option) => option.value === String(value))
    ) {
      throw new Error(`${field.label} has an unsupported value.`)
    }

    if (typeof value !== "number") {
      continue
    }

    if (field.valueType === "integer" && !Number.isInteger(value)) {
      throw new Error(`${field.label} must be an integer.`)
    }
    if (field.min !== undefined && value < field.min) {
      throw new Error(`${field.label} must be at least ${field.min}.`)
    }
    if (field.max !== undefined && value > field.max) {
      throw new Error(`${field.label} must be at most ${field.max}.`)
    }
    if (field.multipleOf !== undefined) {
      const quotient = value / field.multipleOf
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        throw new Error(`${field.label} must use a ${field.multipleOf} step.`)
      }
    }
  }
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
  inputModeId,
}: {
  openapi: StudioVideoModelOpenapi
  fields: StudioVideoParameterField[]
  prompt: string
  params: Record<string, unknown>
  media: Record<string, StudioMediaAttachment[]>
  inputModeId?: string | null
}) {
  const formData = new FormData()
  const appended = new Set<string>()
  const inputMode = getVideoInputMode(openapi.profile, inputModeId)

  for (const field of fields) {
    const key = field.payloadPath.at(-1) ?? field.name

    if (!key || appended.has(key)) {
      continue
    }

    if (field.kind === "image") {
      const modeMedia = getVideoModeMediaField(inputMode, field.payloadPath)
      const first = modeMedia
        ? (
            media[modeMedia.id] ??
            media[modeMedia.fieldPath.join(".")] ??
            []
          )[0]
        : undefined

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
  fixedHeaders,
}: {
  url: string
  payload: unknown
  apiKey: string
  fixedHeaders?: Record<string, string>
}): Promise<ProviderResponse> {
  const isMultipart = payload instanceof FormData
  const headers: Record<string, string> = withAstraflowClientHeaders({
    ...(fixedHeaders ?? {}),
    Authorization: `Bearer ${apiKey}`,
  })

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


function isTransientProviderStatus(status: number) {
  return TRANSIENT_PROVIDER_STATUSES.has(status)
}


async function pollVideoAsyncTask({
  statusUrl,
  taskId,
  apiKey,
  polling,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
  polling: StudioVideoPollingProtocol
}): Promise<ProviderResponse> {
  const url = new URL(statusUrl)
  url.searchParams.set(polling.taskIdParameter, taskId)
  let lastTransientError: ProviderResponse | null = null

  for (let attempt = 0; attempt < VIDEO_ASYNC_TASK_MAX_POLLS; attempt += 1) {
    if (attempt > 0) {
      await sleep(VIDEO_ASYNC_TASK_POLL_INTERVAL_MS)
    }

    let response: Response

    try {
      response = await fetch(url, {
        headers: withAstraflowClientHeaders({
          Authorization: `Bearer ${apiKey}`,
        }),
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
    const taskStatus = getVideoProtocolTaskStatus(parsed, polling)

    if (isVideoProtocolSuccess(taskStatus, polling)) {
      return { ok: true, status: response.status, body: parsed }
    }

    if (isVideoProtocolFailure(taskStatus, polling)) {
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
  polling,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
  polling: StudioVideoPollingProtocol
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
        headers: withAstraflowClientHeaders({
          Authorization: `Bearer ${apiKey}`,
        }),
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
    const taskStatus = getVideoProtocolTaskStatus(parsed, polling)

    if (isVideoProtocolSuccess(taskStatus, polling)) {
      return { ok: true, status: response.status, body: parsed }
    }

    if (isVideoProtocolFailure(taskStatus, polling)) {
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
  polling,
}: {
  statusUrl: string
  taskId: string
  apiKey: string
  polling: StudioVideoPollingProtocol
}): Promise<NormalizedVideoOutput> {
  const contentUrl = polling.contentPath
    ? `${new URL(statusUrl).origin}${polling.contentPath.replace(
        "{task_id}",
        encodeURIComponent(taskId)
      )}`
    : `${statusUrl.replace("{task_id}", encodeURIComponent(taskId))}/content`
  const response = await fetch(contentUrl, {
    headers: withAstraflowClientHeaders({
      Authorization: `Bearer ${apiKey}`,
    }),
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


function extractVideoOutputs(
  payload: unknown,
  polling: StudioVideoPollingProtocol
): NormalizedVideoOutput[] {
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
  const profileUrls = getVideoProtocolResultUrls(finalPayload, polling)
  const urls = profileUrls.length > 0
    ? profileUrls
    : Array.isArray(output?.urls)
      ? output.urls
      : []
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
        polling: entry.profile.polling,
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
            polling: entry.profile.polling,
          }),
        ]
      }
    } else {
      const statusResponse = await pollVideoAsyncTask({
        statusUrl,
        taskId,
        apiKey,
        polling: entry.profile.polling,
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
        outputs = extractVideoOutputs(
          providerResponse.body,
          entry.profile.polling
        )
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

  if (!resolvedOperation.openapi.profile.explicit) {
    throw new Error("Video operation profile is not available.")
  }

  const requestedInputMode =
    input.inputMode ??
    (typeof rawParams[STUDIO_VIDEO_INPUT_MODE_PARAM] === "string"
      ? rawParams[STUDIO_VIDEO_INPUT_MODE_PARAM]
      : undefined)
  const inputMode = getVideoInputMode(
    resolvedOperation.openapi.profile,
    requestedInputMode
  )

  if (
    requestedInputMode &&
    resolvedOperation.openapi.profile.modes.length > 0 &&
    inputMode?.id !== requestedInputMode
  ) {
    throw new Error(`Unsupported video input mode: ${requestedInputMode}`)
  }

  if (inputMode?.promptRequired && !prompt) {
    throw new Error("The selected video input mode requires a prompt.")
  }
  if (inputMode?.promptAllowed === false && prompt) {
    throw new Error("The selected video input mode does not accept a prompt.")
  }

  if (inputMode?.available === false) {
    throw new Error("The selected video input mode is not available yet.")
  }

  const unkeyedMedia = mergeReferenceAttachments({
    attachments: input.attachments ?? [],
    references: input.references ?? [],
    sessionId: input.sessionId,
  })

  if (unkeyedMedia.length > 0) {
    if (!inputMode || inputMode.media.length !== 1) {
      throw new Error(
        "Unkeyed media is only supported when the selected input mode has exactly one media field."
      )
    }

    const field = inputMode.media[0]
    const existing = media[field.id] ?? media[field.fieldPath.join(".")] ?? []
    if (existing.length > 0) {
      throw new Error(
        "Do not mix unkeyed media with field-keyed media in one request."
      )
    }
    media[field.id] = unkeyedMedia
  }

  const modeValidationErrors = validateVideoModeMedia({
    profile: resolvedOperation.openapi.profile,
    modeId: inputMode?.id,
    mediaCounts: Object.fromEntries(
      Object.entries(media).map(([key, values]) => [key, values.length])
    ),
  })

  if (modeValidationErrors.length > 0) {
    throw new Error(modeValidationErrors[0].message)
  }

  const mediaSourceErrors = validateVideoModeMediaSources({
    profile: resolvedOperation.openapi.profile,
    modeId: inputMode?.id,
    media,
  })

  if (mediaSourceErrors.length > 0) {
    throw new Error(mediaSourceErrors[0].message)
  }

  const mergedParams = mergeFieldDefaultParams(
    resolvedOperation.fields,
    rawParams
  )
  const normalizedParams = normalizeVideoParamValues(
    resolvedOperation.fields,
    mergedParams
  )
  const parameterRuleResult = evaluateVideoParameterRules({
    profile: resolvedOperation.openapi.profile,
    modeId: inputMode?.id,
    params: normalizedParams,
    context: { model: resolvedOperation.openapi.modelConstant },
  })

  if (parameterRuleResult.errors.length > 0) {
    throw new Error(parameterRuleResult.errors[0])
  }
  const effectiveParams = parameterRuleResult.params
  validateVideoParamValues(
    resolvedOperation.fields,
    effectiveParams,
    parameterRuleResult.omittedFields
  )
  const constraintErrors = validateVideoConstraints({
    profile: resolvedOperation.openapi.profile,
    modeId: inputMode?.id,
    params: effectiveParams,
    mediaCounts: Object.fromEntries(
      Object.entries(media).map(([key, values]) => [key, values.length])
    ),
    context: {
      model: resolvedOperation.openapi.modelConstant,
      "input.prompt": prompt,
      "input.text": prompt,
    },
  })

  if (constraintErrors.length > 0) {
    throw new Error(constraintErrors[0].message)
  }

  if (inputMode) {
    serializeVideoStructuredFields({ inputMode, params: effectiveParams })
  }

  for (const field of resolvedOperation.fields) {
    const fieldKey = getFieldKey(field)
    const required =
      field.required || parameterRuleResult.requiredFields.has(fieldKey)

    if (
      !required ||
      field.constantValue !== undefined ||
      parameterRuleResult.omittedFields.has(fieldKey)
    ) {
      continue
    }

    if (field.name === "prompt" || field.name === "text") {
      if (!prompt) {
        throw new Error(`${field.label} is required.`)
      }
      continue
    }

    if (field.kind === "image") {
      continue
    }

    const value = getParamValue(effectiveParams, field)
    if (value === undefined || value === null || value === "") {
      throw new Error(`${field.label} is required.`)
    }
  }

  const params = {
    ...effectiveParams,
    ...(inputMode ? { [STUDIO_VIDEO_INPUT_MODE_PARAM]: inputMode.id } : {}),
  }
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
          inputModeId: inputMode?.id,
        })
      : buildVideoPayload({
          openapi: resolvedOperation.openapi,
          fields: resolvedOperation.fields,
          prompt,
          params,
          media,
          inputModeId: inputMode?.id,
        })

  try {
    const providerResponse = await callVideoProvider({
      url: endpointUrl,
      payload,
      apiKey: input.apiKey,
      fixedHeaders: resolvedOperation.openapi.profile.submit.headers,
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

    const providerTaskId = getVideoProtocolTaskId(
      providerResponse.body,
      resolvedOperation.openapi.profile.submit
    )

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
