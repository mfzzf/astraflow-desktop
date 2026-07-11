import "server-only"

import { createDecipheriv } from "node:crypto"

import { getStudioImageOutput } from "@/lib/studio-db"
import { readStudioFile } from "@/lib/studio-file-storage"
import type { StudioMediaGenerationOutput } from "@/lib/studio-types"
import { getStudioVideoOutput } from "@/lib/studio-video-db"

import type {
  MobileChannelOutboundImage,
  MobileChannelOutboundVideo,
} from "./adapter"
import type { MobileChannelImageAttachment } from "./types"

export const MAX_MOBILE_CHANNEL_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_MOBILE_CHANNEL_VIDEO_BYTES = 20 * 1024 * 1024

const imageMimeTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
])

const videoMimeTypes = new Set([
  "video/mp4",
  "video/mpeg",
  "video/quicktime",
  "video/webm",
])

function sniffImageMimeType(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png"
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg"
  }
  if (
    buffer.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))
  ) {
    return "image/gif"
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }

  return null
}

function normalizeImageMimeType(
  buffer: Buffer,
  hintedMimeType?: string | null
) {
  const normalizedHint = hintedMimeType?.split(";", 1)[0]?.trim().toLowerCase()
  const sniffed = sniffImageMimeType(buffer)
  const mimeType = sniffed ?? normalizedHint

  if (!mimeType || !imageMimeTypes.has(mimeType)) {
    throw new Error("Unsupported image format. Use PNG, JPEG, GIF, or WebP.")
  }

  return mimeType
}

function sniffVideoMimeType(buffer: Buffer) {
  if (
    buffer.length >= 12 &&
    buffer.subarray(4, 8).toString("ascii") === "ftyp"
  ) {
    return buffer.subarray(8, 12).toString("ascii").startsWith("qt")
      ? "video/quicktime"
      : "video/mp4"
  }
  if (
    buffer.length >= 4 &&
    buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  ) {
    return "video/webm"
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    [0xba, 0xb3].includes(buffer[3])
  ) {
    return "video/mpeg"
  }

  return null
}

function normalizeVideoMimeType(
  buffer: Buffer,
  hintedMimeType?: string | null
) {
  const normalizedHint = hintedMimeType?.split(";", 1)[0]?.trim().toLowerCase()
  const mimeType = sniffVideoMimeType(buffer) ?? normalizedHint

  if (!mimeType || !videoMimeTypes.has(mimeType)) {
    throw new Error("Unsupported video format. Use MP4, MOV, WebM, or MPEG.")
  }

  return mimeType
}

function extensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg"
    case "image/gif":
      return "gif"
    case "image/webp":
      return "webp"
    default:
      return "png"
  }
}

function videoExtensionForMimeType(mimeType: string) {
  switch (mimeType) {
    case "video/mpeg":
      return "mpeg"
    case "video/quicktime":
      return "mov"
    case "video/webm":
      return "webm"
    default:
      return "mp4"
  }
}

function assertImageSize(buffer: Buffer) {
  if (buffer.length === 0) {
    throw new Error("The image is empty.")
  }
  if (buffer.length > MAX_MOBILE_CHANNEL_IMAGE_BYTES) {
    throw new Error("The image exceeds the 10 MB mobile-channel limit.")
  }
}

function assertVideoSize(buffer: Buffer) {
  if (buffer.length === 0) {
    throw new Error("The video is empty.")
  }
  if (buffer.length > MAX_MOBILE_CHANNEL_VIDEO_BYTES) {
    throw new Error("The video exceeds the 20 MB mobile-channel limit.")
  }
}

function safeImageFileName(
  fileName: string | null | undefined,
  mimeType: string
) {
  const normalized = fileName
    ?.trim()
    .replace(/[\\/\0]/g, "-")
    .slice(0, 180)

  return normalized || `image-${Date.now()}.${extensionForMimeType(mimeType)}`
}

function safeVideoFileName(
  fileName: string | null | undefined,
  mimeType: string
) {
  const normalized = fileName
    ?.trim()
    .replace(/[\\/\0]/g, "-")
    .slice(0, 180)

  return (
    normalized ||
    `video-${Date.now()}.${videoExtensionForMimeType(mimeType)}`
  )
}

export function createMobileChannelImageAttachment({
  buffer,
  fileName,
  mimeType,
}: {
  buffer: Buffer
  fileName?: string | null
  mimeType?: string | null
}): MobileChannelImageAttachment {
  assertImageSize(buffer)
  const resolvedMimeType = normalizeImageMimeType(buffer, mimeType)

  return {
    type: "image",
    name: safeImageFileName(fileName, resolvedMimeType),
    mimeType: resolvedMimeType,
    size: buffer.length,
    dataUrl: `data:${resolvedMimeType};base64,${buffer.toString("base64")}`,
  }
}

export async function fetchMobileChannelBuffer(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
  maxBytes = MAX_MOBILE_CHANNEL_IMAGE_BYTES,
  mediaLabel = "image"
) {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs)
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal

  try {
    const response = await fetch(url, { ...init, signal })
    if (!response.ok) {
      throw new Error(`${mediaLabel} download failed (${response.status}).`)
    }

    const declaredSize = Number(response.headers.get("content-length"))
    if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
      throw new Error(
        `The ${mediaLabel} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB mobile-channel limit.`
      )
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error(`${mediaLabel} download returned no content.`)
    }

    const chunks: Buffer[] = []
    let size = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new Error(
          `The ${mediaLabel} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MB mobile-channel limit.`
        )
      }
      chunks.push(Buffer.from(value))
    }

    const buffer = Buffer.concat(chunks, size)
    if (buffer.length === 0) {
      throw new Error(`${mediaLabel} download returned no content.`)
    }
    return {
      buffer,
      contentType: response.headers.get("content-type"),
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchMobileChannelImage(
  url: string,
  init: RequestInit = {},
  timeoutMs = 30_000
) {
  const downloaded = await fetchMobileChannelBuffer(url, init, timeoutMs)
  assertImageSize(downloaded.buffer)

  return {
    buffer: downloaded.buffer,
    mimeType: normalizeImageMimeType(downloaded.buffer, downloaded.contentType),
  }
}

function bufferFromDataUrl(dataUrl: string, mediaLabel: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,([\s\S]+)$/i)
  if (!match) {
    throw new Error(`Invalid generated ${mediaLabel} data URL.`)
  }

  return {
    buffer: Buffer.from(match[2], "base64"),
    mimeType: match[1],
  }
}

export function parseWechatImageAesKey(value: string) {
  if (/^[0-9a-f]{32}$/i.test(value)) {
    return Buffer.from(value, "hex")
  }

  const decoded = Buffer.from(value, "base64")
  if (decoded.length === 16) {
    return decoded
  }
  if (
    decoded.length === 32 &&
    /^[0-9a-f]{32}$/i.test(decoded.toString("ascii"))
  ) {
    return Buffer.from(decoded.toString("ascii"), "hex")
  }

  throw new Error("Invalid WeChat image encryption key.")
}

export function decryptWechatImage(buffer: Buffer, aesKey: string) {
  const decipher = createDecipheriv(
    "aes-128-ecb",
    parseWechatImageAesKey(aesKey),
    null
  )
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(buffer), decipher.final()])
}

export async function resolveGeneratedMobileChannelImage(
  output: StudioMediaGenerationOutput
): Promise<MobileChannelOutboundImage> {
  const stored = getStudioImageOutput(output.id)
  const mimeTypeHint = output.mimeType ?? stored?.mimeType
  let resolved: { buffer: Buffer; mimeType?: string | null }

  const storagePath = output.storagePath ?? stored?.storagePath
  if (storagePath) {
    resolved = { buffer: readStudioFile(storagePath), mimeType: mimeTypeHint }
  } else if (stored?.dataUrl) {
    resolved = bufferFromDataUrl(stored.dataUrl, "image")
  } else if (output.contentUrl.startsWith("data:")) {
    resolved = bufferFromDataUrl(output.contentUrl, "image")
  } else {
    const remoteUrl =
      output.url ??
      stored?.url ??
      (/^https?:\/\//i.test(output.contentUrl) ? output.contentUrl : null)
    if (!remoteUrl) {
      throw new Error("Generated image content is not available.")
    }
    resolved = await fetchMobileChannelImage(remoteUrl)
  }

  assertImageSize(resolved.buffer)
  const mimeType = normalizeImageMimeType(
    resolved.buffer,
    resolved.mimeType ?? mimeTypeHint
  )

  return {
    buffer: resolved.buffer,
    mimeType,
    fileName: safeImageFileName(
      `astraflow-${output.id}.${extensionForMimeType(mimeType)}`,
      mimeType
    ),
  }
}

export async function resolveGeneratedMobileChannelVideo(
  output: StudioMediaGenerationOutput
): Promise<MobileChannelOutboundVideo> {
  const stored = getStudioVideoOutput(output.id)
  const mimeTypeHint = output.mimeType ?? stored?.mimeType
  let resolved: { buffer: Buffer; mimeType?: string | null }

  const storagePath = output.storagePath ?? stored?.storagePath
  if (storagePath) {
    resolved = { buffer: readStudioFile(storagePath), mimeType: mimeTypeHint }
  } else if (stored?.dataUrl) {
    resolved = bufferFromDataUrl(stored.dataUrl, "video")
  } else if (output.contentUrl.startsWith("data:")) {
    resolved = bufferFromDataUrl(output.contentUrl, "video")
  } else {
    const remoteUrl =
      output.url ??
      stored?.url ??
      (/^https?:\/\//i.test(output.contentUrl) ? output.contentUrl : null)
    if (!remoteUrl) {
      throw new Error("Generated video content is not available.")
    }
    const downloaded = await fetchMobileChannelBuffer(
      remoteUrl,
      {},
      60_000,
      MAX_MOBILE_CHANNEL_VIDEO_BYTES,
      "video"
    )
    resolved = {
      buffer: downloaded.buffer,
      mimeType: downloaded.contentType,
    }
  }

  assertVideoSize(resolved.buffer)
  const mimeType = normalizeVideoMimeType(
    resolved.buffer,
    resolved.mimeType ?? mimeTypeHint
  )

  return {
    buffer: resolved.buffer,
    mimeType,
    fileName: safeVideoFileName(
      `astraflow-${output.id}.${videoExtensionForMimeType(mimeType)}`,
      mimeType
    ),
    durationSeconds: output.durationSeconds ?? stored?.durationSeconds ?? null,
  }
}
