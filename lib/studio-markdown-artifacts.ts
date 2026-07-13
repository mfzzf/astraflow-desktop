import { marked } from "marked"

import { parseFilePathHrefTarget } from "@/lib/markdown-file-paths"
import {
  getStudioFileDescriptor,
  type StudioFilePreviewKind,
} from "@/lib/studio-file-support"

const MARKDOWN_ARTIFACT_KINDS: ReadonlySet<StudioFilePreviewKind> = new Set([
  "image",
  "pdf",
  "document",
  "presentation",
  "spreadsheet",
  "notebook",
  "molecule",
  "binary",
])

function isAbsoluteLocalPath(path: string) {
  return (
    path.startsWith("/") ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  )
}

function getSafeRelativePathSegments(path: string) {
  const normalizedPath = path.trim().replace(/^\.\//, "").replaceAll("\\", "/")

  if (
    !normalizedPath ||
    normalizedPath.startsWith("/") ||
    normalizedPath.startsWith("~") ||
    normalizedPath.startsWith("#") ||
    /^[a-z][a-z\d+.-]*:/i.test(normalizedPath) ||
    normalizedPath.includes("\0")
  ) {
    return null
  }

  const segments = normalizedPath
    .split("/")
    .filter((segment) => segment && segment !== ".")

  if (
    segments.length === 0 ||
    segments.some((segment) => segment === ".." || segment.includes(":"))
  ) {
    return null
  }

  return segments
}

function joinLocalPath(root: string, segments: string[]) {
  const trimmedRoot = root.trim().replace(/[\\/]+$/, "")

  if (!trimmedRoot || segments.length === 0) {
    return null
  }

  const separator = trimmedRoot.includes("\\") ? "\\" : "/"

  return `${trimmedRoot}${separator}${segments.join(separator)}`
}

export function normalizeLocalArtifactPath(path: string) {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/+$/, "")

  return /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLocaleLowerCase("en-US")
    : normalized
}

export function isPathInsideLocalRoot(path: string, root: string) {
  if (
    !isAbsoluteLocalPath(path) ||
    path.replaceAll("\\", "/").split("/").includes("..")
  ) {
    return false
  }

  const normalizedPath = normalizeLocalArtifactPath(path)
  const normalizedRoot = normalizeLocalArtifactPath(root)

  return (
    Boolean(normalizedRoot) &&
    (normalizedPath === normalizedRoot ||
      normalizedPath.startsWith(`${normalizedRoot}/`))
  )
}

export function isMarkdownArtifactPath(path: string) {
  return MARKDOWN_ARTIFACT_KINDS.has(getStudioFileDescriptor(path).kind)
}

export function extractMarkdownArtifactHrefs(markdown: string) {
  if (!markdown.trim()) {
    return []
  }

  const hrefs = new Map<string, string>()

  try {
    const tokens = marked.lexer(markdown)

    marked.walkTokens(tokens, (token) => {
      if (token.type !== "link" || typeof token.href !== "string") {
        return
      }

      const target = parseFilePathHrefTarget(token.href)

      if (!target || !isMarkdownArtifactPath(target.path)) {
        return
      }

      const key = normalizeLocalArtifactPath(target.path)

      if (!hrefs.has(key)) {
        hrefs.set(key, token.href)
      }
    })
  } catch {
    return []
  }

  return [...hrefs.values()]
}

export function markdownHrefTargetsSessionWorkspace(
  href: string,
  sessionId: string
) {
  const target = parseFilePathHrefTarget(href)
  const path = target?.path.trim().replace(/^\.\//, "").replaceAll("\\", "/")

  return Boolean(path?.startsWith(`sandbox-workspaces/${sessionId.trim()}/`))
}

export function resolveMarkdownArtifactPath({
  href,
  sessionId,
  projectRoot,
  sandboxRoot,
}: {
  href: string
  sessionId: string
  projectRoot: string | null | undefined
  sandboxRoot: string | null | undefined
}) {
  const target = parseFilePathHrefTarget(href)

  if (!target || !isMarkdownArtifactPath(target.path)) {
    return null
  }

  const targetPath = target.path.trim()
  const normalizedTarget = targetPath.replace(/^\.\//, "").replaceAll("\\", "/")
  const normalizedSessionId = sessionId.trim()
  const relativeSegments = getSafeRelativePathSegments(targetPath)

  if (isAbsoluteLocalPath(targetPath)) {
    const allowedRoots = [projectRoot, sandboxRoot].filter(
      (root): root is string => Boolean(root?.trim())
    )

    return allowedRoots.some((root) => isPathInsideLocalRoot(targetPath, root))
      ? targetPath
      : null
  }

  if (!relativeSegments) {
    return null
  }

  if (relativeSegments[0] === "sandbox-workspaces") {
    if (
      relativeSegments[1] !== normalizedSessionId ||
      relativeSegments.length < 3 ||
      !sandboxRoot
    ) {
      return null
    }

    return joinLocalPath(sandboxRoot, relativeSegments.slice(2))
  }

  const root = projectRoot?.trim() || sandboxRoot?.trim()

  if (!root || normalizedTarget.startsWith("sandbox-workspaces/")) {
    return null
  }

  return joinLocalPath(root, relativeSegments)
}
