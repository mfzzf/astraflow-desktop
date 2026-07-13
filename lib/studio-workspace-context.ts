import { connectOwnedCodeBoxSandbox } from "@/lib/codebox-runtime"
import { getStudioSession, getStudioSessionWorkspace } from "@/lib/studio-db"

export class StudioSessionWorkspaceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StudioSessionWorkspaceUnavailableError"
  }
}

export function getStudioSessionWorkspaceExecutionContext(sessionId: string) {
  const session = getStudioSession(sessionId)

  if (!session) {
    return null
  }

  const workspace = getStudioSessionWorkspace(sessionId)

  if (!workspace) {
    return null
  }

  return {
    session,
    workspace,
    workspaceId: workspace.id,
    workspaceRoot: workspace.rootPath,
    type: workspace.type,
  }
}

export function requireStudioSessionWorkspaceExecutionContext(
  sessionId: string
) {
  const context = getStudioSessionWorkspaceExecutionContext(sessionId)

  if (!context) {
    throw new StudioSessionWorkspaceUnavailableError(
      `Session ${sessionId} is not bound to an available workspace.`
    )
  }

  return context
}

export async function connectStudioSessionSandboxWorkspace(sessionId: string) {
  const context = requireStudioSessionWorkspaceExecutionContext(sessionId)

  if (context.workspace.type !== "sandbox") {
    throw new StudioSessionWorkspaceUnavailableError(
      `Session ${sessionId} is bound to a local workspace.`
    )
  }

  const sandbox = await connectOwnedCodeBoxSandbox(context.workspace.sandboxId)

  return {
    ...context,
    workspace: context.workspace,
    sandbox,
  }
}
