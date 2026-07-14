import type { StudioLocalWorkspace } from "@/lib/studio-types"

const DEFAULT_HOME_WORKSPACE_ID = "astraflow:default-home"
const DEFAULT_HOME_WORKSPACE_TIMESTAMP = "1970-01-01T00:00:00.000Z"

export function createStudioDefaultHomeWorkspace(
  homePath: string
): StudioLocalWorkspace | null {
  const rootPath = homePath.trim()

  if (!rootPath) {
    return null
  }

  return {
    id: DEFAULT_HOME_WORKSPACE_ID,
    type: "local",
    name: "~",
    rootPath,
    localProjectId: "",
    createdAt: DEFAULT_HOME_WORKSPACE_TIMESTAMP,
    updatedAt: DEFAULT_HOME_WORKSPACE_TIMESTAMP,
    lastOpenedAt: null,
  }
}
