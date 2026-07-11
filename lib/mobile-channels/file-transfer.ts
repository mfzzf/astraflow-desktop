import { homedir } from "node:os"
import { basename, extname, isAbsolute, join, resolve } from "node:path"
import { readFileSync, realpathSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { MobileChannelOutboundFile } from "./adapter"

export const MOBILE_CHANNEL_FILE_TRANSFER_TYPE =
  "astraflow_mobile_channel_file"

export type MobileChannelFileReference = {
  type: typeof MOBILE_CHANNEL_FILE_TRANSFER_TYPE
  path: string
  fileName: string
  mimeType: string
  size: number
}

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  ".7z": "application/x-7z-compressed",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".gz": "application/gzip",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".m4a": "audio/mp4",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".tar": "application/x-tar",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip",
}

const SENSITIVE_LINKED_FILE_PATTERN =
  /(?:^|[\\/])(?:\.ssh|\.gnupg|\.aws|\.azure|\.kube)(?:[\\/]|$)|(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519)|credentials\.json|[^\\/]+\.(?:pem|key|p12|pfx))$/i

function mimeTypeForPath(path: string) {
  return (
    MIME_TYPES_BY_EXTENSION[extname(path).toLowerCase()] ??
    "application/octet-stream"
  )
}

function safeFileName(value: string | null | undefined, path: string) {
  const candidate = basename(value?.trim() || path)
    .replace(/\u0000/g, "-")
    .slice(0, 180)

  return candidate || `file-${Date.now()}`
}

function expandFilePath(value: string, rootDir?: string | null) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("File path is required.")
  }

  if (/^file:/i.test(trimmed)) {
    return fileURLToPath(new URL(trimmed))
  }

  const decoded = (() => {
    try {
      return decodeURIComponent(trimmed)
    } catch {
      return trimmed
    }
  })()

  if (decoded === "~") {
    return homedir()
  }
  if (decoded.startsWith("~/") || decoded.startsWith("~\\")) {
    return join(homedir(), decoded.slice(2))
  }

  return isAbsolute(decoded)
    ? decoded
    : resolve(rootDir?.trim() || homedir(), decoded)
}

export function createMobileChannelFileReference({
  path,
  fileName,
  rootDir,
}: {
  path: string
  fileName?: string | null
  rootDir?: string | null
}): MobileChannelFileReference {
  const resolvedPath = realpathSync(expandFilePath(path, rootDir))
  const stats = statSync(resolvedPath)

  if (!stats.isFile()) {
    throw new Error("Only regular files can be sent to a mobile channel.")
  }

  return {
    type: MOBILE_CHANNEL_FILE_TRANSFER_TYPE,
    path: resolvedPath,
    fileName: safeFileName(fileName, resolvedPath),
    mimeType: mimeTypeForPath(resolvedPath),
    size: stats.size,
  }
}

export function parseMobileChannelFileReference(value: unknown) {
  const parsed = (() => {
    if (typeof value !== "string") {
      return value
    }

    try {
      return JSON.parse(value) as unknown
    } catch {
      return null
    }
  })()

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }

  const record = parsed as Record<string, unknown>
  if (
    record.type !== MOBILE_CHANNEL_FILE_TRANSFER_TYPE ||
    typeof record.path !== "string"
  ) {
    return null
  }

  try {
    return createMobileChannelFileReference({
      path: record.path,
      fileName:
        typeof record.fileName === "string" ? record.fileName : undefined,
    })
  } catch {
    return null
  }
}

export function extractMobileChannelFileLinks({
  content,
  rootDir,
  maxFiles = 5,
}: {
  content: string
  rootDir?: string | null
  maxFiles?: number
}) {
  const references: MobileChannelFileReference[] = []
  const seen = new Set<string>()
  const linkPattern = /!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/g

  for (const match of content.matchAll(linkPattern)) {
    if (references.length >= maxFiles) {
      break
    }

    const rawTarget = match[1]
    const target =
      rawTarget.startsWith("<") && rawTarget.endsWith(">")
        ? rawTarget.slice(1, -1)
        : rawTarget
    if (/^https?:/i.test(target) || /^data:/i.test(target)) {
      continue
    }

    try {
      const reference = createMobileChannelFileReference({
        path: target,
        rootDir,
      })
      if (
        seen.has(reference.path) ||
        SENSITIVE_LINKED_FILE_PATTERN.test(reference.path)
      ) {
        continue
      }
      seen.add(reference.path)
      references.push(reference)
    } catch {
      // Ignore links that are not readable local files.
    }
  }

  return references
}

export function resolveMobileChannelOutboundFile(
  reference: MobileChannelFileReference
): MobileChannelOutboundFile {
  const current = createMobileChannelFileReference({
    path: reference.path,
    fileName: reference.fileName,
  })

  return {
    buffer: readFileSync(current.path),
    fileName: current.fileName,
    mimeType: current.mimeType,
    size: current.size,
  }
}
