const PENDING_WORKSPACE_STORAGE_KEY = "astraflow:pending-workspace"
const PENDING_WORKSPACE_MAX_AGE_MS = 30_000

type PendingWorkspacePayload = {
  workspaceId: string
  createdAt: number
}

function readPendingWorkspacePayload(): PendingWorkspacePayload | null {
  if (typeof window === "undefined") {
    return null
  }

  const raw = window.localStorage
    .getItem(PENDING_WORKSPACE_STORAGE_KEY)
    ?.trim()

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PendingWorkspacePayload>

    if (
      typeof parsed.workspaceId === "string" &&
      parsed.workspaceId.trim() &&
      typeof parsed.createdAt === "number"
    ) {
      return {
        workspaceId: parsed.workspaceId.trim(),
        createdAt: parsed.createdAt,
      }
    }
  } catch {
    // Remove malformed or obsolete values below.
  }

  window.localStorage.removeItem(PENDING_WORKSPACE_STORAGE_KEY)
  return null
}

export function getPendingWorkspaceId() {
  const payload = readPendingWorkspacePayload()

  if (
    !payload ||
    Date.now() - payload.createdAt > PENDING_WORKSPACE_MAX_AGE_MS
  ) {
    setPendingWorkspaceId(null)
    return null
  }

  return payload.workspaceId
}

export function consumePendingWorkspaceId() {
  const workspaceId = getPendingWorkspaceId()

  setPendingWorkspaceId(null)
  return workspaceId
}

export function setPendingWorkspaceId(workspaceId: string | null) {
  if (typeof window === "undefined") {
    return
  }

  if (workspaceId) {
    window.localStorage.setItem(
      PENDING_WORKSPACE_STORAGE_KEY,
      JSON.stringify({ workspaceId, createdAt: Date.now() })
    )
  } else {
    window.localStorage.removeItem(PENDING_WORKSPACE_STORAGE_KEY)
  }
}
