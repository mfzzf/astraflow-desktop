import { posix } from "node:path"

import {
  ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
  closeWorkspaceGatewayTerminal,
  CODEBOX_AUTO_PAUSE_TIMEOUT_SECONDS,
  CODEBOX_WORKSPACE_PATH,
  createCodeBoxSandbox,
  createWorkspaceGatewayTerminal,
  fetchWorkspaceGateway,
  killCodeBoxSandbox,
} from "@/lib/codebox-runtime"
import { getOrCreateSessionSandbox } from "@/lib/astraflow-session-sandbox"
import {
  createStudioSession,
  deleteStudioSession,
  getStudioModelverseApiKey,
  getStudioSession,
  getStudioSessionSandbox,
  touchStudioSessionSandbox,
  upsertStudioSessionSandbox,
} from "@/lib/studio-db"

export const STUDIO_REMOTE_WORKSPACE_PATH = CODEBOX_WORKSPACE_PATH

export type StudioRemoteWorkspace = {
  sessionId: string
  sandboxId: string
  workspacePath: string
}

export type CreatedStudioRemoteWorkspace = {
  session: ReturnType<typeof createStudioSession>
  workspace: {
    sandboxId: string
    status: "running"
    name: string
    repoUrl: string | null
    workspacePath: string
    codeServerUrl: string | null
    template: string
  }
}

export function getStudioRemoteWorkspaceSummary(sessionId: string) {
  const workspace = getStudioSessionSandbox(sessionId)

  if (!workspace) {
    return null
  }

  return {
    sandboxId: workspace.sandboxId,
    status: workspace.status,
    template: workspace.template,
    workspacePath: STUDIO_REMOTE_WORKSPACE_PATH,
  }
}

function requireStudioRemoteWorkspaceApiKey() {
  const apiKey = getStudioModelverseApiKey()

  if (!apiKey?.key) {
    throw new Error("ModelVerse API key is required for the remote workspace.")
  }

  return apiKey.key
}

export async function createStudioRemoteWorkspace({
  name,
  repoUrl,
}: {
  name: string
  repoUrl?: string | null
}): Promise<CreatedStudioRemoteWorkspace> {
  const normalizedName = name.trim()
  const normalizedRepoUrl = repoUrl?.trim() || null

  if (!normalizedName) {
    throw new Error("Workspace name is required.")
  }

  const session = createStudioSession({
    mode: "chat",
    title: normalizedName,
    projectId: null,
    chatRuntimeId: "astraflow",
  })
  let sandbox: Awaited<ReturnType<typeof createCodeBoxSandbox>> | null = null

  try {
    sandbox = await createCodeBoxSandbox({
      name: normalizedName,
      repoUrl: normalizedRepoUrl,
    })

    const binding = upsertStudioSessionSandbox({
      sessionId: session.id,
      sandboxId: sandbox.sandboxId,
      sandboxDomain: sandbox.sandboxDomain,
      template: ASTRAFLOW_CODE_SANDBOX_TEMPLATE,
      status: "running",
      autoPauseTimeoutSeconds: CODEBOX_AUTO_PAUSE_TIMEOUT_SECONDS,
    })

    if (!binding) {
      throw new Error("Failed to bind the Sandbox workspace to the session.")
    }

    return {
      session,
      workspace: {
        sandboxId: sandbox.sandboxId,
        status: "running",
        name: normalizedName,
        repoUrl: normalizedRepoUrl,
        workspacePath: sandbox.workspacePath,
        codeServerUrl: sandbox.codeServerUrl,
        template: sandbox.template,
      },
    }
  } catch (error) {
    if (sandbox) {
      await killCodeBoxSandbox(sandbox.sandboxId).catch(() => undefined)
    }

    deleteStudioSession(session.id)
    throw error
  }
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
