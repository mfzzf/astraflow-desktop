import type { StudioLegacyLocalWorkspace } from "@/lib/studio-types"

const DEFAULT_HOME_WORKSPACE_TIMESTAMP = "1970-01-01T00:00:00.000Z"

// Compatibility adapter for historical session responses that recorded an
// Agent cwd before workspaces became persisted records. New sessions bind a
// managed_local workspace and do not use this synthetic object.
export function createStudioAgentWorkspace(
  sessionId: string,
  rootPath: string | null | undefined
): StudioLegacyLocalWorkspace | null {
  const trimmedRoot = rootPath?.trim()

  if (!sessionId.trim() || !trimmedRoot) {
    return null
  }

  return {
    id: `astraflow:agent-workspace:${sessionId}`,
    type: "local",
    origin: "legacy_local",
    name: "Agent workspace",
    rootPath: trimmedRoot,
    localProjectId: null,
    allocationKey: `legacy-agent-workspace:${sessionId}`,
    createdBySessionId: sessionId,
    createdAt: DEFAULT_HOME_WORKSPACE_TIMESTAMP,
    updatedAt: DEFAULT_HOME_WORKSPACE_TIMESTAMP,
    lastOpenedAt: null,
  }
}
