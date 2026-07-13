import { posix } from "node:path"

import {
  closeWorkspaceGatewayTerminal,
  CODEBOX_WORKSPACE_PATH,
  createWorkspaceGatewayTerminal,
  fetchWorkspaceGateway,
} from "@/lib/codebox-runtime"
import { getOrCreateSessionSandbox } from "@/lib/astraflow-session-sandbox"
import {
  getStudioModelverseApiKey,
  getStudioSession,
  touchStudioSessionSandbox,
} from "@/lib/studio-db"

export const STUDIO_REMOTE_WORKSPACE_PATH = CODEBOX_WORKSPACE_PATH

export type StudioRemoteWorkspace = {
  sessionId: string
  sandboxId: string
  workspacePath: string
}

function requireStudioRemoteWorkspaceApiKey() {
  const apiKey = getStudioModelverseApiKey()

  if (!apiKey?.key) {
    throw new Error("ModelVerse API key is required for the remote workspace.")
  }

  return apiKey.key
}

export function toStudioRemoteRelativePath(path: string | null | undefined) {
  const trimmed = path?.trim() || STUDIO_REMOTE_WORKSPACE_PATH
  const normalized = posix.normalize(trimmed)

  if (normalized === STUDIO_REMOTE_WORKSPACE_PATH) {
    return ""
  }

  const prefix = `${STUDIO_REMOTE_WORKSPACE_PATH}/`

  if (!normalized.startsWith(prefix)) {
    throw new Error("Remote path must stay inside /workspace.")
  }

  return normalized.slice(prefix.length)
}

export function toStudioRemoteAbsolutePath(path: string | null | undefined) {
  const relative = path?.trim().replace(/^\/+/, "") || ""

  return relative
    ? `${STUDIO_REMOTE_WORKSPACE_PATH}/${relative}`
    : STUDIO_REMOTE_WORKSPACE_PATH
}

export async function ensureStudioRemoteWorkspace(
  sessionId: string
): Promise<StudioRemoteWorkspace> {
  const normalizedSessionId = sessionId.trim()

  if (!normalizedSessionId || !getStudioSession(normalizedSessionId)) {
    throw new Error("Studio session was not found.")
  }

  const sandbox = await getOrCreateSessionSandbox({
    sessionId: normalizedSessionId,
    apiKey: requireStudioRemoteWorkspaceApiKey(),
  })

  touchStudioSessionSandbox(normalizedSessionId, "running")

  return {
    sessionId: normalizedSessionId,
    sandboxId: sandbox.sandboxId,
    workspacePath: STUDIO_REMOTE_WORKSPACE_PATH,
  }
}

export async function fetchStudioRemoteWorkspaceGateway({
  sessionId,
  path,
  init,
}: {
  sessionId: string
  path: string
  init?: RequestInit
}) {
  const workspace = await ensureStudioRemoteWorkspace(sessionId)

  return fetchWorkspaceGateway({
    sandboxId: workspace.sandboxId,
    workspacePath: workspace.workspacePath,
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
    workspacePath: workspace.workspacePath,
    cwd: cwd || workspace.workspacePath,
    cols,
    rows,
  })

  return {
    ...terminal,
    cwd: toStudioRemoteAbsolutePath(terminal.cwd),
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
    workspacePath: workspace.workspacePath,
    terminalId,
  })
}
