import { randomUUID } from "node:crypto"

import { readStudioFile } from "@/lib/studio-file-storage"
import {
  getAsyncTaskStatus,
  getFieldKey,
} from "@/lib/studio-generation-shared"
import {
  getGeneratedMediaSessionFileId,
  getStudioImageOutput,
  getStudioSessionFile,
  listStudioImageGenerations,
} from "@/lib/studio-db"
import {
  getStudioVideoOutput,
  listStudioVideoGenerations,
} from "@/lib/studio-video-db"
import type { StudioImageParameterField } from "@/lib/studio-types"
import type { StudioVideoParameterField } from "@/lib/studio-video-types"

export type StudioMediaAttachment = {
  name?: string
  mimeType?: string
  dataUrl?: string
  url?: string
}


export type StudioMediaReference =
  | { type: "session_file"; id: string; name?: string }
  | { type: "image_output"; id: string; name?: string }
  | { type: "video_output"; id: string; name?: string }
  | { type: "url"; url: string; name?: string; mimeType?: string }


export type StudioMediaOutputResult = {
  id: string
  index: number
  sessionFileId: string | null
  contentUrl: string
  url: string | null
  storagePath: string | null
  mimeType: string | null
  width: number | null
  height: number | null
  durationSeconds?: number | null
}


export type GenerateStudioImageInput = {
  sessionId: string
  apiKey: string
  modelId?: string
  modelName: string
  operationId?: string
  prompt: string
  params?: Record<string, unknown>
  attachments?: StudioMediaAttachment[]
  references?: StudioMediaReference[]
}


export type GenerateStudioVideoInput = {
  sessionId: string
  apiKey: string
  modelId?: string
  modelName: string
  operationId?: string
  openapiFile?: string
  prompt: string
  params?: Record<string, unknown>
  media?: Record<string, StudioMediaAttachment[]>
  attachments?: StudioMediaAttachment[]
  references?: StudioMediaReference[]
  mediaReferences?: Record<string, StudioMediaReference[]>
}


const MEDIA_JOB_LEASE_MS = 5 * 60 * 1000

export function createMediaJobLeaseOwner() {
  return `studio-media:${process.pid}:${randomUUID()}`
}


export function isoAfter(ms: number) {
  return new Date(Date.now() + ms).toISOString()
}


export function mediaJobLeaseExpiresAt() {
  return isoAfter(MEDIA_JOB_LEASE_MS)
}


export function dataUrlFromBuffer(buffer: Buffer, mimeType: string) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`
}


export function extensionFromMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/gif") return "gif"
  return "png"
}


export function extensionFromContentMimeType(mimeType: string) {
  if (mimeType.startsWith("image/")) return extensionFromMimeType(mimeType)
  if (mimeType === "video/mp4") return "mp4"
  if (mimeType === "video/webm") return "webm"
  if (mimeType === "video/quicktime") return "mov"
  return "bin"
}


export function mediaReferenceName({
  fallbackId,
  fallbackPrefix,
  fallbackMimeType,
  name,
}: {
  fallbackId: string
  fallbackPrefix: string
  fallbackMimeType: string
  name?: string
}) {
  const normalized = name?.trim()

  if (normalized) {
    return normalized
  }

  const extension = extensionFromContentMimeType(fallbackMimeType)
  return `${fallbackPrefix}-${fallbackId}.${extension}`
}


export function storedMediaAttachment({
  dataUrl,
  fallbackMimeType,
  name,
  storagePath,
  url,
}: {
  dataUrl?: string | null
  fallbackMimeType: string
  name: string
  storagePath?: string | null
  url?: string | null
}): StudioMediaAttachment {
  if (storagePath) {
    const bytes = readStudioFile(storagePath)
    return {
      dataUrl: dataUrlFromBuffer(bytes, fallbackMimeType),
      mimeType: fallbackMimeType,
      name,
    }
  }

  if (dataUrl) {
    return {
      dataUrl,
      mimeType: fallbackMimeType,
      name,
    }
  }

  if (url) {
    return {
      mimeType: fallbackMimeType,
      name,
      url,
    }
  }

  throw new Error("Referenced media output has no readable content.")
}


export function imageOutputBelongsToSession(sessionId: string, outputId: string) {
  return listStudioImageGenerations(sessionId).some((generation) =>
    generation.outputs.some((output) => output.id === outputId)
  )
}


export function videoOutputBelongsToSession(sessionId: string, outputId: string) {
  return listStudioVideoGenerations(sessionId).some((generation) =>
    generation.outputs.some((output) => output.id === outputId)
  )
}


export function resolveStudioMediaReference({
  reference,
  sessionId,
}: {
  reference: StudioMediaReference
  sessionId: string
}): StudioMediaAttachment {
  if (reference.type === "url") {
    return {
      mimeType: reference.mimeType,
      name: reference.name,
      url: reference.url,
    }
  }

  if (reference.type === "session_file") {
    const file = getStudioSessionFile(reference.id)

    if (!file || file.sessionId !== sessionId) {
      throw new Error("Referenced session file was not found.")
    }

    const mimeType = file.mimeType ?? "application/octet-stream"
    const name = reference.name?.trim() || file.originalName

    return {
      dataUrl: dataUrlFromBuffer(readStudioFile(file.storagePath), mimeType),
      mimeType,
      name,
    }
  }

  if (reference.type === "image_output") {
    if (!imageOutputBelongsToSession(sessionId, reference.id)) {
      throw new Error("Referenced image output was not found.")
    }

    const output = getStudioImageOutput(reference.id)

    if (!output) {
      throw new Error("Referenced image output was not found.")
    }

    const fallbackMimeType = output.mimeType ?? "image/png"
    const name = mediaReferenceName({
      fallbackId: output.id,
      fallbackMimeType,
      fallbackPrefix: "image-output",
      name: reference.name,
    })

    return storedMediaAttachment({
      dataUrl: output.dataUrl,
      fallbackMimeType,
      name,
      storagePath: output.storagePath,
      url: output.url,
    })
  }

  if (!videoOutputBelongsToSession(sessionId, reference.id)) {
    throw new Error("Referenced video output was not found.")
  }

  const output = getStudioVideoOutput(reference.id)

  if (!output) {
    throw new Error("Referenced video output was not found.")
  }

  const fallbackMimeType = output.mimeType ?? "video/mp4"
  const name = mediaReferenceName({
    fallbackId: output.id,
    fallbackMimeType,
    fallbackPrefix: "video-output",
    name: reference.name,
  })

  return storedMediaAttachment({
    dataUrl: output.dataUrl,
    fallbackMimeType,
    name,
    storagePath: output.storagePath,
    url: output.url,
  })
}


export function mergeReferenceAttachments({
  attachments,
  references,
  sessionId,
}: {
  attachments: StudioMediaAttachment[]
  references: StudioMediaReference[]
  sessionId: string
}) {
  if (references.length === 0) {
    return attachments
  }

  return [
    ...attachments,
    ...references.map((reference) =>
      resolveStudioMediaReference({ reference, sessionId })
    ),
  ]
}


export function mergeMediaReferenceAttachments({
  media,
  mediaReferences,
  sessionId,
}: {
  media: Record<string, StudioMediaAttachment[]>
  mediaReferences: Record<string, StudioMediaReference[]>
  sessionId: string
}) {
  if (Object.keys(mediaReferences).length === 0) {
    return media
  }

  const merged: Record<string, StudioMediaAttachment[]> = { ...media }

  for (const [key, references] of Object.entries(mediaReferences)) {
    merged[key] = mergeReferenceAttachments({
      attachments: merged[key] ?? [],
      references,
      sessionId,
    })
  }

  return merged
}


export function isVideoParameterField(
  field: StudioImageParameterField | StudioVideoParameterField
): field is StudioVideoParameterField {
  return "payloadPath" in field && Array.isArray(field.payloadPath)
}


export function mediaFieldParamKeys(
  field: StudioImageParameterField | StudioVideoParameterField
) {
  const keys = [field.name]

  if (isVideoParameterField(field)) {
    const key = getFieldKey(field)

    if (key && key !== field.name) {
      keys.unshift(key)
    }
  }

  return keys
}


export function hasParamValue(params: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => {
    const value = params[key]

    return value !== undefined && value !== null && value !== ""
  })
}


export function shouldApplyFieldDefault(
  field: StudioImageParameterField | StudioVideoParameterField
) {
  if (
    field.defaultValue === undefined ||
    field.hidden ||
    field.kind === "image"
  ) {
    return false
  }

  return (
    field.name !== "prompt" &&
    field.name !== "text" &&
    field.name !== "model" &&
    field.name !== "content"
  )
}


export function mergeFieldDefaultParams<
  Field extends StudioImageParameterField | StudioVideoParameterField,
>(fields: Field[], params: Record<string, unknown>) {
  const merged = { ...params }

  for (const field of fields) {
    if (!shouldApplyFieldDefault(field)) {
      continue
    }

    const keys = mediaFieldParamKeys(field)

    if (hasParamValue(merged, keys)) {
      continue
    }

    merged[keys[0]] = field.defaultValue
  }

  return merged
}


export function outputSessionFileId({
  kind,
  outputId,
  storagePath,
}: {
  kind: "image" | "video"
  outputId: string
  storagePath: string | null
}) {
  if (!storagePath) {
    return null
  }

  const fileId = getGeneratedMediaSessionFileId(kind, outputId)
  return getStudioSessionFile(fileId) ? fileId : null
}


export function getOpenAiVideoTaskStatus(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const status = (payload as { status?: unknown }).status

  return typeof status === "string" ? status : null
}


export function getTaskRawStatus(payload: unknown): string | null {
  const direct =
    getAsyncTaskStatus(payload) ?? getOpenAiVideoTaskStatus(payload)

  if (direct) {
    return direct
  }

  if (!payload || typeof payload !== "object") {
    return null
  }

  const nested = (payload as { status?: unknown }).status

  if (typeof nested === "string" && nested) {
    return nested
  }

  if (nested && nested !== payload) {
    return getTaskRawStatus(nested)
  }

  return null
}
