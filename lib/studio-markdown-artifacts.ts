import { marked } from "marked"

import { parseFilePathHrefTarget } from "@/lib/markdown-file-paths"
import {
  getStudioFileDescriptor,
  isStudioFileLikePath,
  isStudioFilePath,
  type StudioFilePreviewKind,
} from "@/lib/studio-file-support"
import type { StudioMessageActivity, StudioWorkspace } from "@/lib/studio-types"

const MARKDOWN_ARTIFACT_KINDS: ReadonlySet<StudioFilePreviewKind> = new Set([
  "image",
  "pdf",
  "document",
  "presentation",
  "spreadsheet",
  "notebook",
  "molecule",
  "binary",
  "unsupported",
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

function getArtifactReferencePath(reference: string) {
  const target = parseFilePathHrefTarget(reference)

  return target?.path ?? reference.trim()
}

function getRelativeArtifactPath(path: string, root: string) {
  const normalizedPath = normalizeLocalArtifactPath(path)
  const normalizedRoot = normalizeLocalArtifactPath(root)

  if (normalizedPath === normalizedRoot) {
    return ""
  }

  if (normalizedRoot === "/") {
    return normalizedPath.slice(1)
  }

  return normalizedPath.slice(normalizedRoot.length + 1)
}

function joinLocalPath(root: string, segments: string[]) {
  const rawRoot = root.trim()

  if (rawRoot === "/") {
    return segments.length > 0 ? `/${segments.join("/")}` : null
  }

  const trimmedRoot = rawRoot.replace(/[\\/]+$/, "")

  if (!trimmedRoot || segments.length === 0) {
    return null
  }

  const separator = rawRoot.includes("\\") ? "\\" : "/"

  return `${trimmedRoot}${separator}${segments.join(separator)}`
}

export function normalizeLocalArtifactPath(path: string) {
  const slashNormalized = path.trim().replaceAll("\\", "/")
  const normalized =
    slashNormalized === "/" ? "/" : slashNormalized.replace(/\/+$/, "")

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
      (normalizedRoot === "/" && normalizedPath.startsWith("/")) ||
      normalizedPath.startsWith(`${normalizedRoot}/`))
  )
}

export function isMarkdownArtifactPath(path: string) {
  return (
    isStudioFileLikePath(path) &&
    MARKDOWN_ARTIFACT_KINDS.has(getStudioFileDescriptor(path).kind)
  )
}

export type StudioWorkspaceArtifact = {
  workspaceId: string
  relativePath: string
  path: string
  name: string
  mimeType: string | null
  size: number | null
  source: "tool" | "markdown" | "generated"
}

export type StudioWorkspaceArtifactResolution =
  | {
      status: "available"
      artifact: StudioWorkspaceArtifact
    }
  | {
      status: "outside_workspace"
      path: string
      name: string
      workspaceRoot: string
    }
  | {
      status: "invalid"
      path: string
      name: string
    }

export function resolveStudioWorkspaceArtifact({
  reference,
  source,
  workspace,
}: {
  reference: string
  source: StudioWorkspaceArtifact["source"]
  workspace: Pick<StudioWorkspace, "id" | "rootPath">
}): StudioWorkspaceArtifactResolution {
  const targetPath = getArtifactReferencePath(reference)
  const name = targetPath.split(/[\\/]/).filter(Boolean).at(-1) ?? targetPath
  const root = workspace.rootPath.trim()

  if (!targetPath || !root || !isStudioFilePath(targetPath)) {
    return { status: "invalid", path: targetPath, name }
  }

  if (isAbsoluteLocalPath(targetPath)) {
    if (!isPathInsideLocalRoot(targetPath, root)) {
      return {
        status: "outside_workspace",
        path: targetPath,
        name,
        workspaceRoot: root,
      }
    }

    return {
      status: "available",
      artifact: {
        workspaceId: workspace.id,
        relativePath: getRelativeArtifactPath(targetPath, root),
        path: targetPath,
        name,
        mimeType: null,
        size: null,
        source,
      },
    }
  }

  const relativeSegments = getSafeRelativePathSegments(targetPath)

  if (!relativeSegments) {
    return { status: "invalid", path: targetPath, name }
  }

  const path = joinLocalPath(root, relativeSegments)

  if (!path) {
    return { status: "invalid", path: targetPath, name }
  }

  return {
    status: "available",
    artifact: {
      workspaceId: workspace.id,
      relativePath: relativeSegments.join("/"),
      path,
      name,
      mimeType: null,
      size: null,
      source,
    },
  }
}

const TOOL_ARTIFACT_PATH_LINE =
  /^(?:wrote file|sandbox path|output(?: file| path)?|artifact(?: file| path)?|generated file|saved file|file path):\s*(.+)$/gim
const TOOL_ARTIFACT_JSON_KEYS = new Set([
  "artifactPath",
  "filePath",
  "outputPath",
  "sandboxPath",
])
const NON_ARTIFACT_TOOL_NAMES = new Set([
  "list_installed_skills",
  "list_installed_mcp_servers",
  "load_skill",
  "read_skill_file",
  "prepare_skill_sandbox",
])

function cleanToolArtifactPath(path: string) {
  return path
    .trim()
    .replace(/^`|`$/g, "")
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+\((?:about\s+)?[\d.,]+\s*(?:bytes?|[kmgt]i?b)\)$/i, "")
    .trim()
}

function collectArtifactJsonPaths(
  value: unknown,
  paths: string[],
  depth = 0
) {
  if (depth > 5 || !value || typeof value !== "object") {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactJsonPaths(item, paths, depth + 1)
    }
    return
  }

  for (const [key, item] of Object.entries(value)) {
    if (TOOL_ARTIFACT_JSON_KEYS.has(key) && typeof item === "string") {
      paths.push(item)
    } else {
      collectArtifactJsonPaths(item, paths, depth + 1)
    }
  }
}

export function extractToolOutputArtifactPaths(
  activity: Pick<StudioMessageActivity, "output" | "status" | "toolName">
) {
  if (
    activity.status !== "complete" ||
    NON_ARTIFACT_TOOL_NAMES.has(activity.toolName) ||
    !activity.output.trim()
  ) {
    return []
  }

  const candidates = extractMarkdownArtifactReferences(activity.output).map(
    getArtifactReferencePath
  )

  for (const match of activity.output.matchAll(TOOL_ARTIFACT_PATH_LINE)) {
    candidates.push(match[1])
  }

  try {
    collectArtifactJsonPaths(JSON.parse(activity.output), candidates)
  } catch {
    // Most tool output is human-readable rather than JSON.
  }

  const paths = new Map<string, string>()

  for (const candidate of candidates) {
    const path = cleanToolArtifactPath(candidate)

    if (!path || !isStudioFilePath(path)) {
      continue
    }

    const key = normalizeLocalArtifactPath(path)

    if (!paths.has(key)) {
      paths.set(key, path)
    }
  }

  return [...paths.values()]
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

export function extractMarkdownArtifactReferences(markdown: string) {
  const references = new Map<string, string>()

  for (const href of extractMarkdownArtifactHrefs(markdown)) {
    const path = getArtifactReferencePath(href)

    references.set(normalizeLocalArtifactPath(path), href)
  }

  if (!markdown.trim()) {
    return [...references.values()]
  }

  try {
    const tokens = marked.lexer(markdown)

    marked.walkTokens(tokens, (token) => {
      if (token.type !== "codespan" || typeof token.text !== "string") {
        return
      }

      const path = token.text.trim()

      if (!isMarkdownArtifactPath(path)) {
        return
      }

      const key = normalizeLocalArtifactPath(path)

      if (!references.has(key)) {
        references.set(key, path)
      }
    })
  } catch {
    return [...references.values()]
  }

  return [...references.values()]
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
