import { createReadStream, statSync } from "node:fs"
import { Readable } from "node:stream"

import { resolveStudioStoragePath } from "@/lib/studio-file-storage"

type StudioFileResponseInput = {
  request: Request
  storagePath: string
  mimeType: string
  filename: string
  download?: boolean
}

function encodeContentDispositionFilename(name: string) {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

export function createContentDispositionValue(
  disposition: "inline" | "attachment",
  name: string
) {
  const normalizedName = name.replace(/[\r\n]/g, "_").trim() || "download"
  const fallbackName =
    normalizedName
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/["\\]/g, "_") || "download"

  return `${disposition}; filename="${fallbackName}"; filename*=UTF-8''${encodeContentDispositionFilename(
    normalizedName
  )}`
}

function streamFile(path: string, start?: number, end?: number) {
  return Readable.toWeb(
    createReadStream(path, {
      start,
      end,
    })
  ) as ReadableStream<Uint8Array>
}

function parseRange(value: string | null, size: number) {
  if (!value) {
    return null
  }

  const match = value.match(/^bytes=(\d*)-(\d*)$/)

  if (!match) {
    return null
  }

  const rawStart = match[1]
  const rawEnd = match[2]

  if (!rawStart && !rawEnd) {
    return null
  }

  if (!rawStart) {
    const suffixLength = Number(rawEnd)

    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null
    }

    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    }
  }

  const start = Number(rawStart)
  const end = rawEnd ? Number(rawEnd) : size - 1

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null
  }

  return {
    start,
    end: Math.min(end, size - 1),
  }
}

export function createStoredFileResponse({
  request,
  storagePath,
  mimeType,
  filename,
  download = false,
}: StudioFileResponseInput) {
  const absolutePath = resolveStudioStoragePath(storagePath)
  const stats = statSync(/* turbopackIgnore: true */ absolutePath)

  if (!stats.isFile()) {
    throw new Error("Stored file is unavailable.")
  }

  const disposition = download ? "attachment" : "inline"
  const commonHeaders = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60",
    "Content-Disposition": createContentDispositionValue(disposition, filename),
    "Content-Type": mimeType,
  }
  const range = parseRange(request.headers.get("range"), stats.size)

  if (range) {
    const contentLength = range.end - range.start + 1

    return new Response(streamFile(absolutePath, range.start, range.end), {
      status: 206,
      headers: {
        ...commonHeaders,
        "Content-Length": String(contentLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${stats.size}`,
      },
    })
  }

  return new Response(streamFile(absolutePath), {
    headers: {
      ...commonHeaders,
      "Content-Length": String(stats.size),
    },
  })
}
