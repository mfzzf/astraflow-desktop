"use client"

import type { StudioFileWorkspaceTarget } from "@/lib/studio-file-workspace"

import {
  getStudioRemoteFileUrl,
  findStudioRemoteFile,
  listStudioRemoteDirectory,
  readStudioRemoteDataUrlFile,
  readStudioRemoteTextFile,
  statStudioRemoteFile,
} from "./remote-workspace-api"

export type StudioWorkspaceTransport = StudioFileWorkspaceTarget

export type StudioWorkspaceFileResolution = {
  path: string | null
  candidates: string[]
}

function requireDesktopBridge() {
  const bridge = window.astraflowDesktop

  if (!bridge) {
    throw new Error("Local workspace access requires the CompShare desktop app.")
  }

  return bridge
}

export async function listStudioWorkspaceDirectory(
  workspace: StudioWorkspaceTransport,
  directory = workspace.rootPath,
  options: { includeHidden?: boolean } = {}
) {
  if (workspace.type === "sandbox") {
    return listStudioRemoteDirectory(workspace.id, directory, options)
  }

  return requireDesktopBridge().localWorkspaceListDirectory(
    workspace.rootPath,
    directory,
    options
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

// Markdown emitted by the agent does not always carry the exact file path
// (paths with spaces get mangled by parsers, relative paths assume a
// different cwd than the UI's workspace root). As a repair step, locate a
// file by its basename inside the workspace. Current Desktop/Gateway builds and
// the server-side legacy-Sandbox fallback perform the exhaustive index. This
// renderer traversal is only the final compatibility lane for an old preload.
const WORKSPACE_FILE_COMPATIBILITY_SEARCH_TIMEOUT_MS = 30_000

export async function findStudioWorkspaceFileByName(
  workspace: StudioWorkspaceTransport,
  filename: string
): Promise<string | null> {
  return (await findStudioWorkspaceFileReference(workspace, filename)).path
}

function getComparableFileReferenceSegments(path: string) {
  return path
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
}

function countMatchingFileReferenceSuffix(
  candidatePath: string,
  referencePath: string
) {
  const candidate = getComparableFileReferenceSegments(candidatePath).map(
    (segment) => segment.toLocaleLowerCase("en-US")
  )
  const reference = getComparableFileReferenceSegments(referencePath).map(
    (segment) => segment.toLocaleLowerCase("en-US")
  )
  let score = 0

  while (
    score < candidate.length &&
    score < reference.length &&
    candidate[candidate.length - score - 1] ===
      reference[reference.length - score - 1]
  ) {
    score += 1
  }

  return score
}

// When an exact path is stale, use the path context instead of selecting the
// first same-named file. A generated link such as `work/rendered/report.pptx`
// should prefer that suffix over an unrelated `archive/report.pptx`.
export async function findStudioWorkspaceFileReference(
  workspace: StudioWorkspaceTransport,
  referencePath: string
): Promise<StudioWorkspaceFileResolution> {
  const referenceSegments = getComparableFileReferenceSegments(referencePath)
  const targetName = referenceSegments.at(-1)?.trim() ?? ""

  if (!targetName) {
    return { path: null, candidates: [] }
  }

  // New Desktop/Gateway builds index the whole source workspace in one native
  // operation. Keep the exhaustive directory walk below as a compatibility
  // fallback for older local preloads and remote Sandbox runtimes.
  if (workspace.type === "sandbox") {
    const indexed = await findStudioRemoteFile(
      workspace.id,
      referencePath
    ).catch(() => null)

    if (indexed) {
      return indexed
    }
  } else {
    const bridge = requireDesktopBridge()
    const indexed =
      typeof bridge.localWorkspaceFindFile === "function"
        ? await bridge
            .localWorkspaceFindFile(workspace.rootPath, referencePath)
            .catch(() => null)
        : null

    if (indexed) {
      return indexed
    }
  }

  const directories = [workspace.rootPath]
  const visitedDirectories = new Set<string>()
  const comparableTargetName = targetName.toLocaleLowerCase("en-US")
  const matches: Array<{
    path: string
    exactName: boolean
    score: number
    modifiedAt: number
  }> = []
  const deadline = Date.now() + WORKSPACE_FILE_COMPATIBILITY_SEARCH_TIMEOUT_MS

  for (let index = 0; index < directories.length; index += 1) {
    if (Date.now() >= deadline) {
      break
    }

    const listing = await listStudioWorkspaceDirectory(
      workspace,
      directories[index],
      { includeHidden: true }
    ).catch(() => null)

    if (!listing || visitedDirectories.has(listing.cwd)) {
      continue
    }
    visitedDirectories.add(listing.cwd)

    for (const entry of listing.entries) {
      if (
        entry.kind === "file" &&
        entry.name.toLocaleLowerCase("en-US") === comparableTargetName
      ) {
        matches.push({
          path: entry.path,
          exactName: entry.name === targetName,
          score: countMatchingFileReferenceSuffix(entry.path, referencePath),
          modifiedAt: entry.modifiedAt,
        })
      } else if (entry.kind === "directory") {
        directories.push(entry.path)
      }
    }
  }

  matches.sort(
    (left, right) =>
      Number(right.exactName) - Number(left.exactName) ||
      right.score - left.score ||
      right.modifiedAt - left.modifiedAt ||
      left.path.length - right.path.length ||
      left.path.localeCompare(right.path)
  )

  const best = matches[0]
  const bestMatches = best
    ? matches.filter(
        (match) =>
          match.exactName === best.exactName && match.score === best.score
      )
    : []

  return {
    path: bestMatches.length === 1 ? bestMatches[0].path : null,
    candidates: matches.map((match) => match.path),
  }
}

export async function findStudioWorkspaceFileByReference(
  workspace: StudioWorkspaceTransport,
  referencePath: string
): Promise<string | null> {
  return (await findStudioWorkspaceFileReference(workspace, referencePath)).path
}

export async function resolveStudioWorkspaceFileReference(
  workspace: StudioWorkspaceTransport,
  path: string
): Promise<StudioWorkspaceFileResolution> {
  if (await probeStudioWorkspaceFile(workspace, path)) {
    return { path, candidates: [path] }
  }

  const normalizedRoot = workspace.rootPath
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")
  const normalizedPath = path.trim().replaceAll("\\", "/")
  const caseInsensitive = /^[A-Za-z]:\//.test(normalizedRoot)
  const comparableRoot = caseInsensitive
    ? normalizedRoot.toLowerCase()
    : normalizedRoot
  const comparablePath = caseInsensitive
    ? normalizedPath.toLowerCase()
    : normalizedPath
  const referencePath = comparablePath.startsWith(`${comparableRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath

  return findStudioWorkspaceFileReference(workspace, referencePath)
}

export async function resolveExistingStudioWorkspaceFilePath(
  workspace: StudioWorkspaceTransport,
  path: string
) {
  return (await resolveStudioWorkspaceFileReference(workspace, path)).path
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

export function getStudioWorkspaceFileHref(
  workspace: StudioWorkspaceTransport,
  path: string
) {
  return workspace.type === "sandbox"
    ? getStudioRemoteFileUrl(workspace.id, path)
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

  return requireDesktopBridge().localWorkspaceShowItem(workspace.rootPath, path)
}
