import {
  getStudioFileExtension,
  isStudioFileLikePath,
} from "@/lib/studio-file-support"
import type { StudioFileWorkspaceTarget } from "@/lib/studio-file-workspace"

export const STUDIO_OPEN_MARKDOWN_TARGET_EVENT =
  "astraflow:open-markdown-target"

export type StudioOpenMarkdownTargetDetail = {
  href: string
  source: "image" | "link"
  intent?: "preview" | "download"
  workspace?: StudioFileWorkspaceTarget | null
  line?: number | null
  column?: number | null
  endLine?: number | null
}

export type StudioMarkdownUrlOpenResult =
  "external" | "workspace" | "unavailable"

const EXTERNAL_WEB_PAGE_EXTENSIONS = new Set([
  "asp",
  "aspx",
  "cgi",
  "htm",
  "html",
  "jsp",
  "php",
  "shtml",
  "xhtml",
])

function isExternalFilePath(path: string) {
  return (
    isStudioFileLikePath(path) &&
    !EXTERNAL_WEB_PAGE_EXTENSIONS.has(getStudioFileExtension(path))
  )
}

export function isStudioAppDownloadHref(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref.startsWith("/api/studio/")) {
    return false
  }

  try {
    const parsed = new URL(trimmedHref, "http://localhost")

    return parsed.searchParams.get("download") === "1"
  } catch {
    return false
  }
}

export function isStudioExternalFileHref(href: string) {
  try {
    const trimmedHref = href.trim()

    if (!/^(?:https?:)?\/\//i.test(trimmedHref)) {
      return false
    }

    const parsed = new URL(trimmedHref, "http://localhost")

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false
    }

    const download = parsed.searchParams.get("download")

    if (
      download !== null &&
      download.toLowerCase() !== "false" &&
      download !== "0"
    ) {
      return true
    }

    if (isExternalFilePath(decodeURIComponent(parsed.pathname))) {
      return true
    }

    return ["file", "filename", "name"].some((parameter) => {
      const value = parsed.searchParams.get(parameter)

      return value ? isExternalFilePath(value) : false
    })
  } catch {
    return false
  }
}

function isBrowserFallbackUrl(url: string) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

export async function openStudioMarkdownUrlWithFallback({
  url,
  openExternal,
  openInWorkspace,
}: {
  url: string
  openExternal: (url: string) => boolean | Promise<boolean>
  openInWorkspace: (url: string) => boolean
}): Promise<StudioMarkdownUrlOpenResult> {
  try {
    if (await openExternal(url)) {
      return "external"
    }
  } catch {
    // Fall through to the in-app browser for web URLs.
  }

  if (isBrowserFallbackUrl(url)) {
    try {
      if (openInWorkspace(url)) {
        return "workspace"
      }
    } catch {
      // A missing workspace listener must not restore default-page navigation.
    }
  }

  return "unavailable"
}
