export const STUDIO_OPEN_MARKDOWN_TARGET_EVENT =
  "astraflow:open-markdown-target"

export type StudioOpenMarkdownTargetDetail = {
  href: string
  source: "image" | "link"
  line?: number | null
  column?: number | null
  endLine?: number | null
}

export function isStudioAppDownloadHref(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref.startsWith("/api/studio/")) {
    return false
  }

  try {
    const parsed = new URL(trimmedHref, "http://localhost")

    return (
      /\/content\/?$/.test(parsed.pathname) &&
      parsed.searchParams.get("download") === "1"
    )
  } catch {
    return false
  }
}
