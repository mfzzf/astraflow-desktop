import { defaultUrlTransform } from "react-markdown"

import { parseFilePathHrefTarget } from "@/lib/markdown-file-paths"
import { STUDIO_OPEN_MARKDOWN_TARGET_EVENT } from "@/lib/studio-markdown-open"
import type { StudioOpenMarkdownTargetDetail } from "@/lib/studio-markdown-open"

export const markdownExternalProtocols = new Set([
  "http:",
  "https:",
  "mailto:",
  "vscode:",
  "vscode-insiders:",
])

export function transformWorkspaceMarkdownUrl(url: string) {
  // react-markdown strips custom protocols before custom components see
  // them. Preserve only the file schemes that this renderer converts into
  // workspace file controls, and retain its safe default for every other URL.
  return /^(?:file|sandbox):/i.test(url) ? url : defaultUrlTransform(url)
}

export type StudioMarkdownMediaKind = "image" | "video" | "audio"

export type StudioMarkdownMediaRoute = {
  kind: StudioMarkdownMediaKind
  outputId?: string
  contentUrl: string
  downloadUrl: string
  saveUrl?: string | null
  sourceUrl?: string | null
  filename: string
}

const mediaRouteConfig = {
  image: {
    segment: "image-outputs",
    extension: "png",
  },
  video: {
    segment: "video-outputs",
    extension: "mp4",
  },
  audio: {
    segment: "audio-outputs",
    extension: "mp3",
  },
} satisfies Record<
  StudioMarkdownMediaKind,
  { segment: string; extension: string }
>

const externalImageExtensions = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])

function withSearchParam(href: string, key: string, value: string) {
  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const url = new URL(href, baseUrl)
    url.searchParams.set(key, value)

    return href.startsWith("/")
      ? `${url.pathname}${url.search}`
      : url.toString()
  } catch {
    const separator = href.includes("?") ? "&" : "?"
    return `${href}${separator}${encodeURIComponent(key)}=${encodeURIComponent(
      value
    )}`
  }
}

export function getStudioMarkdownMediaRoute(href: string | undefined | null) {
  const trimmedHref = typeof href === "string" ? href.trim() : ""

  if (!trimmedHref) {
    return null
  }

  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(trimmedHref, baseUrl)
    const match = parsed.pathname.match(
      /^\/api\/studio\/(image-outputs|video-outputs|audio-outputs)\/([^/]+)\/content\/?$/
    )

    if (!match) {
      return null
    }

    const entry = Object.entries(mediaRouteConfig).find(
      ([, config]) => config.segment === match[1]
    )

    if (!entry) {
      return null
    }

    const [kind, config] = entry as [
      StudioMarkdownMediaKind,
      (typeof mediaRouteConfig)[StudioMarkdownMediaKind],
    ]
    const outputId = decodeURIComponent(match[2])
    const contentUrl = trimmedHref.startsWith("http")
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}`

    return {
      kind,
      outputId,
      contentUrl,
      downloadUrl: withSearchParam(contentUrl, "download", "1"),
      saveUrl: `/api/studio/${config.segment}/${encodeURIComponent(outputId)}/save`,
      filename: `${kind}-${outputId}.${config.extension}`,
    } satisfies StudioMarkdownMediaRoute
  } catch {
    return null
  }
}

function getFilenameExtension(filename: string) {
  const extension = filename.split(".").at(-1)?.trim().toLowerCase() ?? ""

  return /^[a-z0-9]{2,8}$/.test(extension) ? extension : ""
}

function getExternalImageFilename(url: URL, alt: string | undefined) {
  const pathName = decodeURIComponent(url.pathname)
  const basename = pathName.split("/").filter(Boolean).at(-1) ?? ""
  const extension = getFilenameExtension(basename) || "png"
  const stem =
    basename.replace(/\.[^.]+$/, "").trim() ||
    alt
      ?.trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    "image"

  return `${stem.slice(0, 80) || "image"}.${extension}`
}

export function getExternalMarkdownImageRoute(
  href: string | undefined | null,
  alt: string | undefined
) {
  const trimmedHref = typeof href === "string" ? href.trim() : ""

  if (!trimmedHref) {
    return null
  }

  try {
    const parsed = new URL(trimmedHref)

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null
    }

    const contentUrl = parsed.toString()

    return {
      kind: "image",
      contentUrl,
      downloadUrl: contentUrl,
      saveUrl: null,
      sourceUrl: contentUrl,
      filename: getExternalImageFilename(parsed, alt),
    } satisfies StudioMarkdownMediaRoute
  } catch {
    return null
  }
}

export function isLikelyExternalImageUrl(href: string | undefined | null) {
  if (!href) {
    return false
  }

  try {
    const parsed = new URL(href)
    const extension = getFilenameExtension(parsed.pathname)

    return externalImageExtensions.has(extension)
  } catch {
    return false
  }
}

function getMediaUrlLookupKeys(href: string) {
  const keys = [href]

  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(href, baseUrl)

    keys.push(parsed.toString(), `${parsed.origin}${parsed.pathname}`)

    if (href.startsWith("/")) {
      keys.push(parsed.pathname)
    }
  } catch {
    // Use the original href only.
  }

  return keys
}

export function resolveMappedMediaUrl(
  href: string | undefined | null,
  mediaUrlMap: Record<string, string> | undefined
) {
  if (!href || !mediaUrlMap) {
    return href ?? undefined
  }

  for (const key of getMediaUrlLookupKeys(href)) {
    const mapped = mediaUrlMap[key]

    if (mapped) {
      return mapped
    }
  }

  return href
}

export function getOpenableMarkdownUrl(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return null
  }

  // App-served routes (media, file downloads) stay openable via the origin.
  if (trimmedHref.startsWith("/api/")) {
    try {
      const baseUrl =
        typeof window === "undefined"
          ? "http://localhost"
          : window.location.href

      return new URL(trimmedHref, baseUrl).toString()
    } catch {
      return null
    }
  }

  try {
    // Parse without a base URL on purpose: relative hrefs (bare file names,
    // unresolved workspace paths) must not resolve against the app origin —
    // opening that URL just shows the app's own HTML instead of the file.
    const parsed = new URL(
      trimmedHref.startsWith("//") ? `https:${trimmedHref}` : trimmedHref
    )
    return markdownExternalProtocols.has(parsed.protocol)
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

export function getWorkspaceMarkdownTarget(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return null
  }

  const fileTarget = parseFilePathHrefTarget(trimmedHref)

  if (fileTarget) {
    return fileTarget
  }

  if (trimmedHref.startsWith("/api/")) {
    try {
      const baseUrl =
        typeof window === "undefined"
          ? "http://localhost"
          : window.location.href

      return {
        path: new URL(trimmedHref, baseUrl).toString(),
        line: null,
        column: null,
        endLine: null,
      }
    } catch {
      return null
    }
  }

  try {
    const parsed = new URL(trimmedHref)

    if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
      return null
    }

    return {
      path: parsed.toString(),
      line: null,
      column: null,
      endLine: null,
    }
  } catch {
    return null
  }
}

export function openMarkdownTargetInWorkspace(
  href: string,
  source: StudioOpenMarkdownTargetDetail["source"]
) {
  const target = getWorkspaceMarkdownTarget(href)

  if (!target) {
    return false
  }

  window.dispatchEvent(
    new CustomEvent<StudioOpenMarkdownTargetDetail>(
      STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
      {
        detail: {
          href: target.path,
          source,
          line: target.line,
          column: target.column,
          endLine: target.endLine,
        },
      }
    )
  )
  return true
}

export function openMarkdownLink(url: string) {
  if (window.astraflowDesktop?.openExternal) {
    void window.astraflowDesktop.openExternal(url)
    return true
  }

  return Boolean(window.open(url, "_blank", "noopener,noreferrer"))
}

export function openMarkdownHrefInWorkspace(
  href: string,
  source: StudioOpenMarkdownTargetDetail["source"],
  openableUrl: string | null = null
) {
  if (openMarkdownTargetInWorkspace(href, source)) {
    return
  }

  // External protocols the workspace cannot host (mailto:, vscode:, ...).
  if (openableUrl) {
    openMarkdownLink(openableUrl)
    return
  }

  // Hand the raw href to the workspace handler: it can still resolve
  // relative paths against the project root, and unsupported files land on
  // the "no preview" page instead of navigating the app window.
  window.dispatchEvent(
    new CustomEvent<StudioOpenMarkdownTargetDetail>(
      STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
      { detail: { href, source } }
    )
  )
}
