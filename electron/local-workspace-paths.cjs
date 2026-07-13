/* eslint-disable @typescript-eslint/no-require-imports */
const { realpathSync, statSync } = require("node:fs")
const { isAbsolute, relative, resolve } = require("node:path")
const { fileURLToPath } = require("node:url")

function resolveLocalFilePath(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    throw new Error("File path is required.")
  }

  const trimmedPath = filePath.trim()
  const isWindowsDrivePath = /^[a-z]:[\\/]/i.test(trimmedPath)

  if (trimmedPath.startsWith("/api/") || /^https?:\/\//i.test(trimmedPath)) {
    throw new Error("Selected target is not a local file.")
  }

  if (!isWindowsDrivePath && /^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
    if (trimmedPath.startsWith("file://")) {
      return fileURLToPath(trimmedPath)
    }

    throw new Error("Selected target is not a local file.")
  }

  return resolve(trimmedPath)
}

function isPathInsideLocalWorkspace(workspaceRoot, targetPath) {
  const pathFromRoot = relative(workspaceRoot, targetPath)

  return (
    pathFromRoot === "" ||
    (!/^\.\.(?:[\\/]|$)/.test(pathFromRoot) && !isAbsolute(pathFromRoot))
  )
}

function resolveLocalWorkspaceRoot(workspaceRoot) {
  const resolvedRoot = realpathSync(resolveLocalFilePath(workspaceRoot))

  if (!statSync(resolvedRoot).isDirectory()) {
    throw new Error("Local workspace root is not a directory.")
  }

  return resolvedRoot
}

function resolveLocalWorkspacePath(
  workspaceRoot,
  requestedPath,
  { allowRoot = true, kind = "any" } = {}
) {
  const resolvedRoot = resolveLocalWorkspaceRoot(workspaceRoot)
  const trimmedRequestedPath =
    typeof requestedPath === "string" ? requestedPath.trim() : ""
  const isWindowsDrivePath = /^[a-z]:[\\/]/i.test(trimmedRequestedPath)
  const hasProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmedRequestedPath)
  const candidate = !trimmedRequestedPath
    ? resolvedRoot
    : isAbsolute(trimmedRequestedPath) || isWindowsDrivePath || hasProtocol
      ? resolveLocalFilePath(trimmedRequestedPath)
      : resolve(resolvedRoot, trimmedRequestedPath)
  const resolvedPath = realpathSync(candidate)

  if (!isPathInsideLocalWorkspace(resolvedRoot, resolvedPath)) {
    throw new Error("Selected path is outside the local workspace.")
  }

  if (!allowRoot && resolvedPath === resolvedRoot) {
    throw new Error("A file inside the local workspace is required.")
  }

  const stats = statSync(resolvedPath)

  if (kind === "directory" && !stats.isDirectory()) {
    throw new Error("Selected path is not a directory.")
  }

  if (kind === "file" && !stats.isFile()) {
    throw new Error("Selected path is not a file.")
  }

  return { resolvedRoot, resolvedPath, stats }
}

module.exports = {
  isPathInsideLocalWorkspace,
  resolveLocalFilePath,
  resolveLocalWorkspacePath,
  resolveLocalWorkspaceRoot,
}
