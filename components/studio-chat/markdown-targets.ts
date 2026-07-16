import {
  parseFilePathHrefTarget,
  type MarkdownFilePathTarget,
} from "@/lib/markdown-file-paths"

type StudioMarkdownTargetWorkspace = {
  type: "local" | "sandbox"
  rootPath: string
}

export type StudioMarkdownOpenTarget =
  | {
      kind: "workspace_file"
      path: string
      line: number | null
      column: number | null
      endLine: number | null
    }
  | {
      kind: "external_file"
      path: string
    }
  | {
      kind: "browser"
      url: string
    }
  | {
      kind: "unavailable"
    }

function normalizeComparableWorkspacePath(path: string) {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/+$/, "")

  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized
}

export function isPathInsideWorkspaceRoot(
  rootPath: string,
  targetPath: string
) {
  const root = normalizeComparableWorkspacePath(rootPath)
  const target = normalizeComparableWorkspacePath(targetPath)

  return target === root || target.startsWith(`${root}/`)
}

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

export function getMarkdownTargetBrowserUrl(
  href: string,
  baseUrl = typeof window === "undefined"
    ? "http://localhost"
    : window.location.href
) {
  const trimmedHref = href.trim()

  if (!trimmedHref) {
    return null
  }

  if (trimmedHref.startsWith("/api/")) {
    return new URL(trimmedHref, baseUrl).toString()
  }

  try {
    const url = new URL(trimmedHref)

    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

export function resolveStudioMarkdownOpenTarget({
  href,
  sessionId,
  workspace,
  line,
  column,
  endLine,
  browserBaseUrl,
}: {
  href: string
  sessionId: string
  workspace: StudioMarkdownTargetWorkspace
  line?: number | null
  column?: number | null
  endLine?: number | null
  browserBaseUrl?: string
}): StudioMarkdownOpenTarget {
  const fileTarget = getMarkdownTargetFileTarget(href)
  const targetHref = fileTarget?.path ?? href
  const focusLine = line ?? fileTarget?.line ?? null
  const focusColumn = column ?? fileTarget?.column ?? null
  const focusEndLine = endLine ?? fileTarget?.endLine ?? null
  let filePath = getMarkdownTargetFilePath(targetHref)
  const targetsSessionWorkspace = isSessionWorkspaceFileHref(
    targetHref,
    sessionId
  )

  if (filePath && !isPathInsideWorkspaceRoot(workspace.rootPath, filePath)) {
    return workspace.type === "local"
      ? { kind: "external_file", path: filePath }
      : { kind: "unavailable" }
  }

  if (!filePath && targetsSessionWorkspace) {
    filePath = resolveRelativeSessionWorkspaceFilePath(
      targetHref,
      sessionId,
      workspace.rootPath
    )
  }

  if (!filePath && !targetsSessionWorkspace) {
    filePath = resolveRelativeWorkspaceFilePath(targetHref, workspace.rootPath)
  }

  if (filePath) {
    return {
      kind: "workspace_file",
      path: filePath,
      line: focusLine,
      column: focusColumn,
      endLine: focusEndLine,
    }
  }

  const url = getMarkdownTargetBrowserUrl(
    targetHref,
    browserBaseUrl ??
      (typeof window === "undefined"
        ? "http://localhost"
        : window.location.href)
  )

  return url ? { kind: "browser", url } : { kind: "unavailable" }
}
