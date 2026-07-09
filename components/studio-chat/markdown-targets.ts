import {
  parseFilePathHrefTarget,
  type MarkdownFilePathTarget,
} from "@/lib/markdown-file-paths"

export function createSidePanelEntryFromPath(
  path: string
): AstraFlowSidePanelDirectoryEntry {
  const normalizedPath = path
  const name = normalizedPath.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  const extension = name.includes(".")
    ? (name.split(".").at(-1)?.toLowerCase() ?? "")
    : ""

  return {
    name,
    path: normalizedPath,
    kind: "file",
    extension,
    size: 0,
    modifiedAt: Date.now(),
  }
}

export function getMarkdownTargetFileTarget(
  href: string
): MarkdownFilePathTarget | null {
  return parseFilePathHrefTarget(href)
}

export function getMarkdownTargetFilePath(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref) {
    return null
  }

  const fileTarget = getMarkdownTargetFileTarget(trimmedHref)

  if (fileTarget) {
    return fileTarget.path.startsWith("/") || fileTarget.path.startsWith("~/")
      ? fileTarget.path
      : null
  }

  if (trimmedHref.startsWith("/api/")) {
    return null
  }

  if (trimmedHref.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmedHref).pathname)
    } catch {
      return null
    }
  }

  if (trimmedHref.startsWith("/") || trimmedHref.startsWith("~/")) {
    return trimmedHref
  }

  return null
}

export function resolveRelativeWorkspaceFilePath(
  href: string,
  projectRoot: string | null | undefined
) {
  if (!projectRoot) {
    return null
  }

  const trimmedHref = href.trim().replace(/^\.\//, "")

  if (
    !trimmedHref ||
    trimmedHref.startsWith("/") ||
    trimmedHref.startsWith("~") ||
    trimmedHref.startsWith("#") ||
    trimmedHref.includes("://") ||
    trimmedHref.includes("..")
  ) {
    return null
  }

  if (!/^[\w.@+-]+(?:\/[\w.@+-]+)*$/.test(trimmedHref)) {
    return null
  }

  return `${projectRoot.replace(/[\\/]+$/, "")}/${trimmedHref}`
}

export function getMarkdownTargetBrowserUrl(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref) {
    return null
  }

  if (trimmedHref.startsWith("/api/")) {
    return new URL(trimmedHref, window.location.href).toString()
  }

  try {
    const url = new URL(trimmedHref)

    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}
