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
