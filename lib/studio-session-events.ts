export const STUDIO_SESSIONS_CHANGED_EVENT = "astraflow:studio-sessions-changed"

export function dispatchStudioSessionsChanged() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new Event(STUDIO_SESSIONS_CHANGED_EVENT))
}
