import { DEFAULT_AGENT_RUNTIME_ID } from "@/lib/agent/runtime"
import type { StudioPermissionMode, StudioSession } from "@/lib/studio-types"

export function isAgentRunSelectionCurrent({
  session,
  permissionMode,
  runtimeId,
  workspaceId,
}: {
  session: Pick<
    StudioSession,
    "chatRuntimeId" | "permissionMode" | "workspaceId"
  >
  permissionMode: StudioPermissionMode
  runtimeId: string
  workspaceId: string | null | undefined
}) {
  return (
    session.permissionMode === permissionMode &&
    session.workspaceId === (workspaceId ?? null) &&
    (session.chatRuntimeId || DEFAULT_AGENT_RUNTIME_ID) === runtimeId
  )
}
