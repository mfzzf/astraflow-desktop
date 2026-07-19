import type { StudioFileWorkspaceTarget } from "@/lib/studio-types"

export type { StudioFileWorkspaceTarget } from "@/lib/studio-types"

export function createStudioRunFileWorkspaceTarget({
  agentWorkspaceRoot,
  environment,
  projectPath,
  sessionId,
  workspaceId,
  workspaceRoot,
}: {
  agentWorkspaceRoot?: string | null
  environment: "local" | "remote"
  projectPath?: string | null
  sessionId: string
  workspaceId?: string | null
  workspaceRoot?: string | null
}): StudioFileWorkspaceTarget | null {
  const rootPath =
    workspaceRoot?.trim() ||
    agentWorkspaceRoot?.trim() ||
    projectPath?.trim() ||
    ""

  if (!rootPath) {
    return null
  }

  if (environment === "remote") {
    return workspaceId?.trim()
      ? {
          id: workspaceId.trim(),
          type: "sandbox",
          rootPath,
        }
      : null
  }

  return {
    id: workspaceId?.trim() || `astraflow:agent-workspace:${sessionId}`,
    type: "local",
    rootPath,
  }
}

export function getStudioFileWorkspaceTargetKey(
  workspace: StudioFileWorkspaceTarget
) {
  return `${workspace.type}\0${workspace.id}\0${workspace.rootPath}`
}

export function areSameStudioFileWorkspaceTarget(
  left: StudioFileWorkspaceTarget,
  right: StudioFileWorkspaceTarget
) {
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.rootPath === right.rootPath
  )
}

function normalizeComparableWorkspaceRoot(rootPath: string) {
  const normalized = rootPath.trim().replaceAll("\\", "/").replace(/\/+$/, "")

  return /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLocaleLowerCase("en-US")
    : normalized
}

/**
 * Prefer the workspace captured with the message, while retaining a safe
 * recovery path for a workspace record that was deleted and recreated. A
 * recreated Sandbox workspace has a new database id but the same type/root;
 * retrying an unrelated active workspace would risk opening the wrong file.
 */
export function getStudioFileWorkspaceTargetCandidates(
  sourceWorkspace: StudioFileWorkspaceTarget | null | undefined,
  activeWorkspace: StudioFileWorkspaceTarget
) {
  if (!sourceWorkspace) {
    return [activeWorkspace]
  }

  if (areSameStudioFileWorkspaceTarget(sourceWorkspace, activeWorkspace)) {
    return [sourceWorkspace]
  }

  const canSafelyRetryActiveWorkspace =
    sourceWorkspace.type === activeWorkspace.type &&
    (sourceWorkspace.id === activeWorkspace.id ||
      normalizeComparableWorkspaceRoot(sourceWorkspace.rootPath) ===
        normalizeComparableWorkspaceRoot(activeWorkspace.rootPath))

  return canSafelyRetryActiveWorkspace
    ? [sourceWorkspace, activeWorkspace]
    : [sourceWorkspace]
}

export function isStudioFileWorkspaceTargetForEnvironment(
  workspace: StudioFileWorkspaceTarget,
  environment: "local" | "remote"
) {
  return environment === "remote"
    ? workspace.type === "sandbox"
    : workspace.type === "local"
}
