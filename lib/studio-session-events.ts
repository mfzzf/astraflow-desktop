export const STUDIO_SESSIONS_CHANGED_EVENT = "astraflow:studio-sessions-changed"
export const STUDIO_LOCAL_PROJECTS_CHANGED_EVENT =
  "astraflow:studio-local-projects-changed"

export function dispatchStudioSessionsChanged() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new Event(STUDIO_SESSIONS_CHANGED_EVENT))
}

export function dispatchStudioLocalProjectsChanged() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new Event(STUDIO_LOCAL_PROJECTS_CHANGED_EVENT))
}
