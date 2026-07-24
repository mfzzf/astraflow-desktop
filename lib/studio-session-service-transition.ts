import type {
  StudioPermissionMode,
  StudioWorkspace,
} from "@/lib/studio-types"
import type { stopActiveWorkspaceServicesBestEffort } from "@/lib/studio-workspace-service-cleanup"

type WorkspaceServiceCleanupResult = Awaited<
  ReturnType<typeof stopActiveWorkspaceServicesBestEffort>
>

export class StudioSessionServiceTransitionError extends Error {
  readonly status = 502
  readonly failures: WorkspaceServiceCleanupResult["failures"]

  constructor(
    message: string,
    failures: WorkspaceServiceCleanupResult["failures"] = [],
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = "StudioSessionServiceTransitionError"
    this.failures = failures
  }
}

export function requiresStudioSessionServiceScopeCleanup({
  currentWorkspace,
  currentPermissionMode,
  nextWorkspaceId,
  nextPermissionMode,
}: {
  currentWorkspace: Pick<StudioWorkspace, "id" | "type"> | null
  currentPermissionMode: StudioPermissionMode
  nextWorkspaceId: string | null
  nextPermissionMode: StudioPermissionMode
}) {
  if (currentWorkspace?.type !== "sandbox") {
    return false
  }

  const workspaceChanged = nextWorkspaceId !== currentWorkspace.id
  const fullAccessRevoked =
    currentPermissionMode === "full_access" &&
    nextPermissionMode !== "full_access"

  return workspaceChanged || fullAccessRevoked
}

export async function cleanStudioSessionServiceScopeBeforeTransition({
  required,
  cleanup,
}: {
  required: boolean
  cleanup: () => Promise<WorkspaceServiceCleanupResult>
}) {
  if (!required) {
    return null
  }

  let result: WorkspaceServiceCleanupResult

  try {
    result = await cleanup()
  } catch (error) {
    throw new StudioSessionServiceTransitionError(
      `Workspace services could not be stopped before changing the session: ${
        error instanceof Error ? error.message : String(error)
      }`,
      [],
      { cause: error }
    )
  }

  if (
    result.failures.length > 0 ||
    result.stopped !== result.attempted
  ) {
    throw new StudioSessionServiceTransitionError(
      "Workspace services could not all be stopped before changing the session.",
      result.failures
    )
  }

  return result
}
