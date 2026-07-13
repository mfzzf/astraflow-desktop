import { realpath, stat } from "node:fs/promises"
import path from "node:path"

export class WorkspacePathError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = "WorkspacePathError"
    this.code = code
    this.status = status
  }
}

export function normalizeWorkspaceRelativePath(value, { allowRoot = true } = {}) {
  if (typeof value !== "string") {
    throw new WorkspacePathError(
      "INVALID_PATH",
      "Workspace path must be a string."
    )
  }

  if (value.length > 4096 || value.includes("\0") || value.includes("\\")) {
    throw new WorkspacePathError("INVALID_PATH", "Workspace path is invalid.")
  }

  const trimmed = value.trim()

  if (!trimmed || trimmed === ".") {
    if (allowRoot) {
      return ""
    }

    throw new WorkspacePathError("INVALID_PATH", "Workspace path is required.")
  }

  if (path.posix.isAbsolute(trimmed)) {
    throw new WorkspacePathError(
      "PATH_OUTSIDE_WORKSPACE",
      "Workspace paths must be relative."
    )
  }

  const segments = trimmed.split("/")

  if (segments.includes("..")) {
    throw new WorkspacePathError(
      "PATH_OUTSIDE_WORKSPACE",
      "Workspace path cannot contain parent traversal."
    )
  }

  const normalized = path.posix.normalize(trimmed).replace(/^\.\//, "")

  if (!normalized || normalized === ".") {
    if (allowRoot) {
      return ""
    }

    throw new WorkspacePathError("INVALID_PATH", "Workspace path is required.")
  }

  return normalized
}

function isWithinWorkspace(workspaceRoot, target) {
  return target === workspaceRoot || target.startsWith(`${workspaceRoot}${path.sep}`)
}

export async function resolveExistingWorkspacePath(
  workspaceRoot,
  value,
  { allowRoot = true, kind = "any" } = {}
) {
  const relativePath = normalizeWorkspaceRelativePath(value, { allowRoot })
  const candidate = path.resolve(
    workspaceRoot,
    ...relativePath.split("/").filter(Boolean)
  )
  let resolvedPath

  try {
    resolvedPath = await realpath(candidate)
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new WorkspacePathError(
        "PATH_NOT_FOUND",
        "Workspace path was not found.",
        404
      )
    }

    throw error
  }

  if (!isWithinWorkspace(workspaceRoot, resolvedPath)) {
    throw new WorkspacePathError(
      "PATH_OUTSIDE_WORKSPACE",
      "Workspace path resolves outside the workspace.",
      403
    )
  }

  const stats = await stat(resolvedPath)

  if (kind === "file" && !stats.isFile()) {
    throw new WorkspacePathError("NOT_A_FILE", "Workspace path is not a file.")
  }

  if (kind === "directory" && !stats.isDirectory()) {
    throw new WorkspacePathError(
      "NOT_A_DIRECTORY",
      "Workspace path is not a directory."
    )
  }

  return {
    absolutePath: resolvedPath,
    relativePath,
    stats,
  }
}
