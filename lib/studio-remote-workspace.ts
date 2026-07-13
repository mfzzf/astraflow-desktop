import { posix } from "node:path"

import {
  ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
  closeWorkspaceGatewayTerminal,
  CODEBOX_WORKSPACE_PATH,
  createWorkspaceGatewayTerminal,
  fetchWorkspaceGateway,
  getOwnedCodeBoxSandbox,
} from "@/lib/codebox-runtime"
import {
  getStudioSession,
  getStudioSessionWorkspace,
  touchStudioWorkspace,
} from "@/lib/studio-db"

export const STUDIO_REMOTE_WORKSPACE_PATH = CODEBOX_WORKSPACE_PATH

export type StudioRemoteWorkspace = {
  sessionId: string
  workspaceId: string
  sandboxId: string
  gatewayPath: string
  workspacePath: string
}

export class StudioWorkspaceTypeMismatchError extends Error {
  readonly code = "WORKSPACE_TYPE_MISMATCH"

  constructor(message: string) {
    super(message)
    this.name = "StudioWorkspaceTypeMismatchError"
  }
}

export function getStudioRemoteWorkspaceSummary(sessionId: string) {
  const workspace = getStudioSessionWorkspace(sessionId)

  if (workspace?.type !== "sandbox") {
    return null
  }

  let sandbox: ReturnType<typeof getOwnedCodeBoxSandbox> = null

  try {
    sandbox = getOwnedCodeBoxSandbox(workspace.sandboxId)
  } catch {
    // Keep the explicit workspace type visible while authentication or
    // project selection is being restored, but do not read another owner's
    // local CodeBox record for status metadata.
  }

  return {
    workspaceId: workspace.id,
    sandboxId: workspace.sandboxId,
    status: sandbox?.status ?? ("unknown" as const),
    template: sandbox?.template ?? ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
    workspacePath: workspace.rootPath,
  }
}

export function toStudioRemoteRelativePath(
  path: string | null | undefined,
  workspacePath = STUDIO_REMOTE_WORKSPACE_PATH,
  gatewayPath = workspacePath
) {
  const trimmed = path?.trim() || workspacePath
  const normalized = posix.normalize(trimmed)
  const normalizedWorkspace = posix.normalize(workspacePath)
  const normalizedGateway = posix.normalize(gatewayPath)

  if (
    normalizedWorkspace !== normalizedGateway &&
    !normalizedWorkspace.startsWith(`${normalizedGateway}/`)
  ) {
    throw new Error(
      `Workspace ${normalizedWorkspace} must stay inside Gateway root ${normalizedGateway}.`
    )
  }

  if (
    normalized !== normalizedWorkspace &&
    !normalized.startsWith(`${normalizedWorkspace}/`)
  ) {
    throw new Error(`Remote path must stay inside ${normalizedWorkspace}.`)
  }

  if (normalized === normalizedGateway) {
    return ""
  }

  return normalized.slice(`${normalizedGateway}/`.length)
}

export function toStudioRemoteAbsolutePath(
  path: string | null | undefined,
  workspacePath = STUDIO_REMOTE_WORKSPACE_PATH
) {
  const relative = path?.trim().replace(/^\/+/, "") || ""

  return relative
    ? `${posix.normalize(workspacePath)}/${relative}`
    : posix.normalize(workspacePath)
}

export async function ensureStudioRemoteWorkspace(
  sessionId: string
): Promise<StudioRemoteWorkspace> {
  const normalizedSessionId = sessionId.trim()

  if (!normalizedSessionId || !getStudioSession(normalizedSessionId)) {
    throw new Error("Studio session was not found.")
  }

  const workspace = getStudioSessionWorkspace(normalizedSessionId)

  if (workspace?.type !== "sandbox") {
    throw new StudioWorkspaceTypeMismatchError(
      "This session is not bound to a Sandbox workspace."
    )
  }

  const sandbox = getOwnedCodeBoxSandbox(workspace.sandboxId)

  if (!sandbox) {
    throw new Error("Sandbox workspace is not owned by the current account.")
  }

  touchStudioWorkspace(workspace.id)

  return {
    sessionId: normalizedSessionId,
    workspaceId: workspace.id,
    sandboxId: workspace.sandboxId,
    gatewayPath: sandbox.workspacePath || CODEBOX_WORKSPACE_PATH,
    workspacePath: workspace.rootPath,
  }
}

export function getStudioRemoteWorkspaceErrorStatus(error: unknown) {
  if (error instanceof StudioWorkspaceTypeMismatchError) {
    return 409
  }

  if (
    error instanceof Error &&
    error.message === "Studio session was not found."
  ) {
    return 404
  }

  return 502
}

export async function fetchStudioRemoteWorkspaceGateway({
  sessionId,
  path,
  init,
  workspace: providedWorkspace,
}: {
  sessionId: string
  path: string
  init?: RequestInit
  workspace?: StudioRemoteWorkspace
}) {
  const workspace =
    providedWorkspace ?? (await ensureStudioRemoteWorkspace(sessionId))

  return fetchWorkspaceGateway({
    sandboxId: workspace.sandboxId,
    workspacePath: workspace.gatewayPath,
    path,
    init,
  })
}

export async function createStudioRemoteTerminal({
  sessionId,
  cwd,
  cols,
  rows,
}: {
  sessionId: string
  cwd?: string | null
  cols?: number | null
  rows?: number | null
}) {
  const workspace = await ensureStudioRemoteWorkspace(sessionId)

  const terminal = await createWorkspaceGatewayTerminal({
    sandboxId: workspace.sandboxId,
    workspacePath: workspace.gatewayPath,
    cwd: cwd || workspace.workspacePath,
    cols,
    rows,
  })

  return {
    ...terminal,
    cwd: toStudioRemoteAbsolutePath(terminal.cwd, workspace.gatewayPath),
  }
}

export async function closeStudioRemoteTerminal({
  sessionId,
  terminalId,
}: {
  sessionId: string
  terminalId: string
}) {
  const workspace = await ensureStudioRemoteWorkspace(sessionId)

  return closeWorkspaceGatewayTerminal({
    sandboxId: workspace.sandboxId,
    workspacePath: workspace.gatewayPath,
    terminalId,
  })
}
