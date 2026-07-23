import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path"

import { getLegacyAcpWorkspacePath } from "@/lib/agent/acp/workspace"
import {
  allocateAndBindStudioManagedWorkspace,
  createStudioLegacyWorkspace,
  getLatestStudioAcpSessionSelection,
  getStudioOwnedLocalWorkspaceForRootPath,
  getStudioSession,
  listStudioSessions,
  getStudioWorkspace,
  getStudioWorkspaceForAllocationKey,
  resetStudioSessionProviderResume,
  updateStudioSessionWorkspace,
} from "@/lib/studio-db"
import { safeFileName } from "@/lib/studio-file-storage"
import type { StudioLocalWorkspace } from "@/lib/studio-types"

const MANAGED_WORKSPACE_DIRECTORY_NAME = "AstraFlow"
const MANAGED_WORKSPACE_ALLOCATION_PREFIX = "studio-session:"
const LEGACY_WORKSPACE_ALLOCATION_PREFIX = "legacy-acp-session:"
const managedWorkspaceAllocationLocks = new Set<string>()

function canonicalExistingDirectory(path: string) {
  if (!isAbsolute(path) || !existsSync(path)) {
    return null
  }

  const stats = lstatSync(path)

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    return null
  }

  return realpathSync.native(path)
}

function isPathInside(parent: string, child: string) {
  const pathFromParent = relative(parent, child)

  return (
    pathFromParent.length > 0 &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  )
}

export function getStudioManagedWorkspacesRoot() {
  return (
    process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH?.trim() ||
    join(homedir(), MANAGED_WORKSPACE_DIRECTORY_NAME)
  )
}

function getManagedWorkspaceDirectoryName(
  sessionId: string,
  createdAt: string
) {
  const timestamp = createdAt
    .replace(/\.\d{3}Z$/, "")
    .replace(/[T:]/g, "-")
    .replace(/[^0-9-]/g, "")
  const shortId = createHash("sha256")
    .update(sessionId)
    .digest("hex")
    .slice(0, 8)

  return safeFileName(`${timestamp}-${shortId}`)
}

function getManagedWorkspaceAllocationKey(sessionId: string) {
  return `${MANAGED_WORKSPACE_ALLOCATION_PREFIX}${sessionId}`
}

function resolveLegacyWorkspacePath(sessionId: string) {
  const selectedPath =
    getLatestStudioAcpSessionSelection(sessionId)?.cwd?.trim() || null

  if (!selectedPath) {
    return null
  }

  const selectedCanonical = canonicalExistingDirectory(selectedPath)
  const expectedCanonical = canonicalExistingDirectory(
    getLegacyAcpWorkspacePath(sessionId)
  )

  if (!selectedCanonical) {
    return null
  }

  return selectedCanonical === expectedCanonical ? selectedCanonical : null
}

function bindWorkspace(sessionId: string, workspace: StudioLocalWorkspace) {
  const updated = updateStudioSessionWorkspace(sessionId, workspace.id, {
    // Recovery/adoption reaches this helper only after proving that the
    // provider continuation already belongs to this exact safe workspace.
    preserveProviderContinuation: true,
  })

  if (!updated || updated.workspaceId !== workspace.id) {
    throw new Error("Failed to bind the managed workspace to the Studio task.")
  }

  return workspace
}

/**
 * Allocate a task-owned local workspace on the first Agent run.
 *
 * New tasks live under ~/AstraFlow. Existing unbound tasks are allowed to keep
 * their old per-session ACP directory only when it exactly matches the legacy
 * allocator path; arbitrary historical cwd values are never adopted.
 */
function ensureStudioManagedWorkspaceUnlocked(
  sessionId: string
): StudioLocalWorkspace {
  const session = getStudioSession(sessionId)

  if (!session) {
    throw new Error("Session not found")
  }

  if (session.workspaceId) {
    const workspace = getStudioWorkspace(session.workspaceId)

    if (!workspace) {
      throw new Error("The session workspace is unavailable.")
    }

    if (workspace.type !== "local") {
      throw new Error("A remote session cannot allocate a local workspace.")
    }

    return workspace
  }

  const allocationKey = getManagedWorkspaceAllocationKey(sessionId)
  const allocated = getStudioWorkspaceForAllocationKey(allocationKey)
  const selectedSession = getLatestStudioAcpSessionSelection(sessionId)

  if (allocated) {
    if (allocated.origin !== "managed_local") {
      throw new Error("The task workspace allocation has an invalid origin.")
    }

    mkdirSync(allocated.rootPath, { recursive: true, mode: 0o700 })
    const allocatedStats = lstatSync(allocated.rootPath)

    if (allocatedStats.isSymbolicLink() || !allocatedStats.isDirectory()) {
      throw new Error("The allocated task workspace is not a safe directory.")
    }

    if (
      selectedSession &&
      canonicalExistingDirectory(selectedSession.cwd) !==
        canonicalExistingDirectory(allocated.rootPath)
    ) {
      resetStudioSessionProviderResume(sessionId)
    }

    return bindWorkspace(sessionId, allocated)
  }

  const legacyRoot = resolveLegacyWorkspacePath(sessionId)

  if (legacyRoot) {
    const sharedLegacyWorkspace =
      getStudioOwnedLocalWorkspaceForRootPath(legacyRoot)

    if (sharedLegacyWorkspace?.type === "local") {
      return bindWorkspace(sessionId, sharedLegacyWorkspace)
    }

    const legacyWorkspace = createStudioLegacyWorkspace({
      name: session.title,
      rootPath: legacyRoot,
      allocationKey: `${LEGACY_WORKSPACE_ALLOCATION_PREFIX}${sessionId}`,
      createdBySessionId: sessionId,
    })

    return bindWorkspace(sessionId, legacyWorkspace)
  }

  const configuredRoot = resolve(getStudioManagedWorkspacesRoot())
  mkdirSync(configuredRoot, { recursive: true, mode: 0o700 })
  const configuredRootStats = lstatSync(configuredRoot)

  if (
    configuredRootStats.isSymbolicLink() ||
    !configuredRootStats.isDirectory()
  ) {
    throw new Error("The AstraFlow workspace root is not a safe directory.")
  }

  const canonicalRoot = realpathSync.native(configuredRoot)
  const workspacePath = join(
    canonicalRoot,
    getManagedWorkspaceDirectoryName(sessionId, session.createdAt)
  )
  const existedBefore = existsSync(workspacePath)
  let createdDirectory = false

  if (existedBefore) {
    const existingStats = lstatSync(workspacePath)

    if (existingStats.isSymbolicLink() || !existingStats.isDirectory()) {
      throw new Error("The managed workspace path is not a safe directory.")
    }
  } else {
    const temporaryPath = join(
      canonicalRoot,
      `.allocating-${safeFileName(sessionId)}-${randomUUID()}`
    )

    try {
      mkdirSync(temporaryPath, { mode: 0o700 })
      renameSync(temporaryPath, workspacePath)
      createdDirectory = true
    } catch (error) {
      try {
        rmdirSync(temporaryPath)
      } catch {
        // The temporary directory may have been atomically renamed.
      }

      if (!existsSync(workspacePath)) {
        throw error
      }
    }
  }

  const canonicalWorkspacePath = realpathSync.native(workspacePath)

  if (
    !isPathInside(canonicalRoot, canonicalWorkspacePath) ||
    basename(canonicalWorkspacePath) !== basename(workspacePath) ||
    !statSync(canonicalWorkspacePath).isDirectory()
  ) {
    if (createdDirectory) {
      try {
        rmdirSync(workspacePath)
      } catch {
        // Only an empty directory is eligible for rollback.
      }
    }
    throw new Error("The managed workspace escaped the AstraFlow root.")
  }

  try {
    const workspace = allocateAndBindStudioManagedWorkspace({
      name: session.title,
      rootPath: canonicalWorkspacePath,
      allocationKey,
      createdBySessionId: sessionId,
    })

    return workspace
  } catch (error) {
    const racedWorkspace = getStudioWorkspaceForAllocationKey(allocationKey)

    if (
      racedWorkspace?.origin === "managed_local" &&
      racedWorkspace.createdBySessionId === sessionId &&
      racedWorkspace.rootPath === canonicalWorkspacePath
    ) {
      return bindWorkspace(sessionId, racedWorkspace)
    }

    if (createdDirectory) {
      try {
        rmdirSync(canonicalWorkspacePath)
      } catch {
        // Never recursively delete: a concurrently started run may have
        // already written user-visible files into this directory.
      }
    }

    throw error
  }
}

export function ensureStudioManagedWorkspace(
  sessionId: string
): StudioLocalWorkspace {
  const allocationKey = getManagedWorkspaceAllocationKey(sessionId)

  if (managedWorkspaceAllocationLocks.has(allocationKey)) {
    throw new Error("The managed workspace is already being allocated.")
  }

  managedWorkspaceAllocationLocks.add(allocationKey)

  try {
    return ensureStudioManagedWorkspaceUnlocked(sessionId)
  } finally {
    managedWorkspaceAllocationLocks.delete(allocationKey)
  }
}

export function reconcileStudioManagedWorkspaceAllocations() {
  const configuredRoot = resolve(getStudioManagedWorkspacesRoot())

  if (!existsSync(configuredRoot)) {
    return 0
  }

  const canonicalRoot = canonicalExistingDirectory(configuredRoot)

  if (!canonicalRoot) {
    throw new Error("The AstraFlow workspace root is not a safe directory.")
  }

  let reconciled = 0

  for (const session of listStudioSessions()) {
    if (session.workspaceId) {
      continue
    }

    const allocationKey = getManagedWorkspaceAllocationKey(session.id)

    if (getStudioWorkspaceForAllocationKey(allocationKey)) {
      continue
    }

    const workspacePath = join(
      canonicalRoot,
      getManagedWorkspaceDirectoryName(session.id, session.createdAt)
    )
    const canonicalWorkspacePath = canonicalExistingDirectory(workspacePath)

    if (
      !canonicalWorkspacePath ||
      !isPathInside(canonicalRoot, canonicalWorkspacePath) ||
      basename(canonicalWorkspacePath) !== basename(workspacePath)
    ) {
      continue
    }

    allocateAndBindStudioManagedWorkspace({
      name: session.title,
      rootPath: canonicalWorkspacePath,
      allocationKey,
      createdBySessionId: session.id,
    })
    reconciled += 1
  }

  return reconciled
}
