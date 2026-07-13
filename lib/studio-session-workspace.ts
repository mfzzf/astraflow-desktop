import { statSync } from "node:fs"

import type { StudioLocalProject } from "@/lib/studio-types"

export class StudioWorkspaceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StudioWorkspaceUnavailableError"
  }
}

export function resolveStudioSessionWorkspacePath({
  project,
  projectId,
  sessionId,
}: {
  project: StudioLocalProject | null
  projectId: string | null
  sessionId: string
}) {
  if (!projectId) {
    return null
  }

  if (!project || project.id !== projectId) {
    throw new StudioWorkspaceUnavailableError(
      `The workspace selected for session ${sessionId} is no longer registered.`
    )
  }

  try {
    if (statSync(/* turbopackIgnore: true */ project.path).isDirectory()) {
      return project.path
    }
  } catch {
    throw new StudioWorkspaceUnavailableError(
      `The selected workspace is unavailable: ${project.path}`
    )
  }

  throw new StudioWorkspaceUnavailableError(
    `The selected workspace is not a directory: ${project.path}`
  )
}
