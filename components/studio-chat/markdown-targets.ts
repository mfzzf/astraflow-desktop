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
    return fileTarget.path.startsWith("/") ||
      fileTarget.path.startsWith("~/") ||
      /^[A-Za-z]:[\\/]/.test(fileTarget.path) ||
      fileTarget.path.startsWith("\\\\")
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

  const trimmedHref = href
    .trim()
    .replace(/^\.\//, "")
    .replaceAll("\\", "/")

  if (
    !trimmedHref ||
    trimmedHref.startsWith("/") ||
    trimmedHref.startsWith("~") ||
    trimmedHref.startsWith("#") ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmedHref) ||
    trimmedHref.includes("\0")
  ) {
    return null
  }

  const segments = trimmedHref
    .split("/")
    .filter((segment) => segment !== ".")

  if (
    segments.length === 0 ||
    segments.some(
      (segment) => !segment || segment === ".." || segment.includes(":")
    )
  ) {
    return null
  }

  const rawRoot = projectRoot.trim()
  const trimmedRoot = rawRoot.replace(/[\\/]+$/, "")
  const separator = rawRoot.includes("\\") ? "\\" : "/"

  return `${trimmedRoot}${separator}${segments.join(separator)}`
}

function getSafeRelativeSessionPath(
  href: string,
  sessionId: string
): string[] | null {
  const normalizedHref = href
    .trim()
    .replace(/^\.\//, "")
    .replaceAll("\\", "/")
  const normalizedSessionId = sessionId.trim()

  if (
    !normalizedHref ||
    !normalizedSessionId ||
    normalizedHref.startsWith("/") ||
    normalizedHref.startsWith("~") ||
    normalizedHref.startsWith("#") ||
    /^[a-z][a-z\d+.-]*:/i.test(normalizedHref) ||
    normalizedHref.includes("\0")
  ) {
    return null
  }

  const segments = normalizedHref
    .split("/")
    .filter((segment) => segment !== ".")

  if (
    segments.length === 0 ||
    segments.some(
      (segment) => !segment || segment === ".." || segment.includes(":")
    )
  ) {
    return null
  }

  if (segments[0] === "sandbox-workspaces") {
    if (segments[1] !== normalizedSessionId || segments.length < 3) {
      return null
    }

    return segments.slice(2)
  }

  return segments
}

export function isSessionWorkspaceFileHref(href: string, sessionId: string) {
  const normalizedHref = href
    .trim()
    .replace(/^\.\//, "")
    .replaceAll("\\", "/")

  return normalizedHref.startsWith(`sandbox-workspaces/${sessionId.trim()}/`)
}

export function resolveRelativeSessionWorkspaceFilePath(
  href: string,
  sessionId: string,
  workspaceRoot: string | null | undefined
) {
  const trimmedRoot = workspaceRoot?.trim().replace(/[\\/]+$/, "")
  const segments = getSafeRelativeSessionPath(href, sessionId)

  if (!trimmedRoot || !segments) {
    return null
  }

  const separator = trimmedRoot.includes("\\") ? "\\" : "/"

  return `${trimmedRoot}${separator}${segments.join(separator)}`
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
