const PENDING_PROJECT_STORAGE_KEY = "astraflow:pending-project"

export function getPendingProjectId() {
  if (typeof window === "undefined") {
    return null
  }

  return (
    window.localStorage.getItem(PENDING_PROJECT_STORAGE_KEY)?.trim() || null
  )
}

export function setPendingProjectId(projectId: string | null) {
  if (typeof window === "undefined") {
    return
  }

  if (projectId) {
    window.localStorage.setItem(PENDING_PROJECT_STORAGE_KEY, projectId)
  } else {
    window.localStorage.removeItem(PENDING_PROJECT_STORAGE_KEY)
  }
}
