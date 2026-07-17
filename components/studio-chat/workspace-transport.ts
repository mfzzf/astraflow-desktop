"use client"

import type { StudioWorkspace } from "@/lib/studio-types"

import {
  getStudioRemoteFileUrl,
  listStudioRemoteDirectory,
  readStudioRemoteDataUrlFile,
  readStudioRemoteTextFile,
  statStudioRemoteFile,
} from "./remote-workspace-api"

export type StudioWorkspaceTransport = Pick<
  StudioWorkspace,
  "id" | "type" | "rootPath"
>

function requireDesktopBridge() {
  const bridge = window.astraflowDesktop

  if (!bridge) {
    throw new Error("Local workspace access requires the AstraFlow desktop app.")
  }

  return bridge
}

export async function listStudioWorkspaceDirectory(
  workspace: StudioWorkspaceTransport,
  directory = workspace.rootPath
) {
  if (workspace.type === "sandbox") {
    return listStudioRemoteDirectory(workspace.id, directory)
  }

  return requireDesktopBridge().localWorkspaceListDirectory(
    workspace.rootPath,
    directory
  )
}

export async function statStudioWorkspaceFile(
  workspace: StudioWorkspaceTransport,
  path: string
) {
  if (workspace.type === "sandbox") {
    return statStudioRemoteFile(workspace.id, path)
  }

  const entry = await requireDesktopBridge().localWorkspaceStatPath(
    workspace.rootPath,
    path
  )

  if (!entry || entry.kind !== "file") {
    throw new Error("Workspace file was not found.")
  }

  return {
    size: entry.size ?? 0,
    modifiedAt: entry.modifiedAt,
  }
}

export async function readStudioWorkspaceTextFile(
  workspace: StudioWorkspaceTransport,
  path: string
) {
  if (workspace.type === "sandbox") {
    return readStudioRemoteTextFile(workspace.id, path)
  }

  return requireDesktopBridge().localWorkspaceReadTextFile(
    workspace.rootPath,
    path
  )
}

export async function probeStudioWorkspaceFile(
  workspace: StudioWorkspaceTransport,
  path: string
) {
  if (workspace.type === "sandbox") {
    return statStudioRemoteFile(workspace.id, path)
      .then(() => true)
      .catch(() => false)
  }

  const entry = await requireDesktopBridge()
    .localWorkspaceStatPath(workspace.rootPath, path)
    .catch(() => null)

  return entry?.kind === "file"
}

const WORKSPACE_FILE_SEARCH_MAX_DEPTH = 7
const WORKSPACE_FILE_SEARCH_SKIPPED_NAMES = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  "target",
  "__pycache__",
])

function getWorkspaceFileSearchDirectoryBudget(
  workspace: StudioWorkspaceTransport
) {
  // Remote listings are HTTP round-trips; local readdir over IPC is cheap.
  return workspace.type === "sandbox" ? 250 : 2_000
}

// Markdown emitted by the agent does not always carry the exact file path
// (paths with spaces get mangled by parsers, relative paths assume a
// different cwd than the UI's workspace root). As a repair step, locate a
// file by its basename inside the workspace — breadth-first so the
// shallowest match wins, with hard budgets so a huge workspace (or a home
// directory opened as one) stays bounded.
export async function findStudioWorkspaceFileByName(
  workspace: StudioWorkspaceTransport,
  filename: string
): Promise<string | null> {
  const targetName = filename.trim()

  if (!targetName) {
    return null
  }

  const maxDirectories = getWorkspaceFileSearchDirectoryBudget(workspace)
  let visitedDirectories = 0
  let frontier = [workspace.rootPath]

  for (
    let depth = 0;
    depth < WORKSPACE_FILE_SEARCH_MAX_DEPTH && frontier.length > 0;
    depth += 1
  ) {
    const nextFrontier: string[] = []

    for (const directory of frontier) {
      if (visitedDirectories >= maxDirectories) {
        return null
      }

      visitedDirectories += 1

      const listing = await listStudioWorkspaceDirectory(
        workspace,
        directory
      ).catch(() => null)

      if (!listing) {
        continue
      }

      for (const entry of listing.entries) {
        if (entry.kind === "file" && entry.name === targetName) {
          return entry.path
        }
      }

      for (const entry of listing.entries) {
        if (
          entry.kind === "directory" &&
          !entry.name.startsWith(".") &&
          !WORKSPACE_FILE_SEARCH_SKIPPED_NAMES.has(entry.name.toLowerCase())
        ) {
          nextFrontier.push(entry.path)
        }
      }
    }

    frontier = nextFrontier
  }

  return null
}

export async function resolveExistingStudioWorkspaceFilePath(
  workspace: StudioWorkspaceTransport,
  path: string
) {
  if (await probeStudioWorkspaceFile(workspace, path)) {
    return path
  }

  const basename = path.split(/[\\/]/).filter(Boolean).at(-1) ?? ""

  return findStudioWorkspaceFileByName(workspace, basename)
}

export async function readStudioWorkspaceDataUrlFile(
  workspace: StudioWorkspaceTransport,
  path: string,
  maxBytes?: number
) {
  if (workspace.type === "sandbox") {
    return readStudioRemoteDataUrlFile(workspace.id, path, maxBytes)
  }

  return requireDesktopBridge().localWorkspaceReadFileDataUrl(
    workspace.rootPath,
    path,
    maxBytes
  )
}

export async function openStudioWorkspacePath(
  workspace: StudioWorkspaceTransport,
  path: string
) {
  if (workspace.type !== "local") {
    return false
  }

  return requireDesktopBridge().localWorkspaceOpenPath(workspace.rootPath, path)
}

export function getStudioWorkspaceFileDownloadHref(
  workspace: StudioWorkspaceTransport,
  path: string
) {
  return workspace.type === "sandbox"
    ? getStudioRemoteFileUrl(workspace.id, path, { download: true })
    : null
}

export async function openStudioLocalFilePath(path: string) {
  return requireDesktopBridge().localOpenPath(path)
}

export async function revealStudioWorkspacePath(
  workspace: StudioWorkspaceTransport,
  path: string
) {
  if (workspace.type !== "local") {
    return false
  }

  return requireDesktopBridge().localWorkspaceShowItem(
    workspace.rootPath,
    path
  )
}
