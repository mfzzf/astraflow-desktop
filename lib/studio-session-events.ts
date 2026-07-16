export const STUDIO_SESSIONS_CHANGED_EVENT = "astraflow:studio-sessions-changed"
export const STUDIO_LOCAL_PROJECTS_CHANGED_EVENT =
  "astraflow:studio-local-projects-changed"
export const STUDIO_WORKSPACES_CHANGED_EVENT =
  "astraflow:studio-workspaces-changed"
export const STUDIO_REMOTE_WORKSPACE_CREATE_REQUESTED_EVENT =
  "astraflow:studio-remote-workspace-create-requested"
export const STUDIO_SLASH_COMMANDS_REFRESH_EVENT =
  "astraflow:studio-slash-commands-refresh"

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

export function dispatchStudioWorkspacesChanged() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new Event(STUDIO_WORKSPACES_CHANGED_EVENT))
}

export function dispatchStudioRemoteWorkspaceCreateRequested() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(
    new Event(STUDIO_REMOTE_WORKSPACE_CREATE_REQUESTED_EVENT)
  )
}

export function dispatchStudioSlashCommandsRefresh() {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(new Event(STUDIO_SLASH_COMMANDS_REFRESH_EVENT))
}
