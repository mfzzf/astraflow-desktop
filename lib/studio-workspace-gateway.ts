import { posix } from "node:path"

import {
  closeWorkspaceGatewayTerminal,
  CODEBOX_WORKSPACE_PATH,
  createWorkspaceGatewayTerminal,
  fetchWorkspaceGateway,
  getOwnedCodeBoxSandbox,
} from "@/lib/codebox-runtime"
import {
  isPosixPathInsideRoot,
  normalizeSandboxWorkspaceRoot,
  resolveSandboxWorkspacePath,
} from "@/lib/sandbox-workspace-paths"
import {
  getStudioWorkspace,
  touchStudioWorkspace,
} from "@/lib/studio-db"
import { StudioWorkspaceTypeMismatchError } from "@/lib/studio-remote-workspace"

export type StudioSandboxWorkspaceGatewayContext = {
  workspaceId: string
  sandboxId: string
  workspacePath: string
  gatewayRoot: string
}

export class StudioWorkspaceGatewayNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StudioWorkspaceGatewayNotFoundError"
  }
}

export function requireStudioSandboxWorkspace(
  workspaceId: string
): StudioSandboxWorkspaceGatewayContext {
  const normalizedWorkspaceId = workspaceId.trim()
  const workspace = getStudioWorkspace(normalizedWorkspaceId)

  if (!workspace) {
    throw new StudioWorkspaceGatewayNotFoundError(
      "Studio workspace was not found."
    )
  }

  if (workspace.type !== "sandbox") {
    throw new StudioWorkspaceTypeMismatchError(
      "Local workspaces cannot use the remote Workspace Gateway."
    )
  }

  const sandbox = getOwnedCodeBoxSandbox(workspace.sandboxId)

  if (!sandbox) {
    throw new StudioWorkspaceGatewayNotFoundError(
      "Owned Code Sandbox was not found."
    )
  }

  const gatewayRoot = normalizeSandboxWorkspaceRoot(
    sandbox.workspacePath || CODEBOX_WORKSPACE_PATH
  )
  const workspacePath = normalizeSandboxWorkspaceRoot(workspace.rootPath)

  if (!isPosixPathInsideRoot(workspacePath, gatewayRoot)) {
    throw new StudioWorkspaceTypeMismatchError(
      `Sandbox workspace must stay under Gateway root ${gatewayRoot}.`
    )
  }

  touchStudioWorkspace(workspace.id)

  return {
    workspaceId: workspace.id,
    sandboxId: workspace.sandboxId,
    workspacePath,
    gatewayRoot,
  }
}

export function toStudioWorkspaceGatewayRelativePath(
  workspace: StudioSandboxWorkspaceGatewayContext,
  path: string | null | undefined
) {
  const absolutePath = resolveSandboxWorkspacePath({
    path: path?.trim() || workspace.workspacePath,
    workspaceRoot: workspace.workspacePath,
  })

  if (absolutePath === workspace.gatewayRoot) {
    return ""
  }

  const gatewayPrefix = `${workspace.gatewayRoot.replace(/\/+$/, "")}/`

  if (!absolutePath.startsWith(gatewayPrefix)) {
    throw new Error("Workspace path resolves outside the Sandbox Gateway root.")
  }

  return absolutePath.slice(gatewayPrefix.length)
}

export function toStudioWorkspaceAbsolutePath(
  workspace: StudioSandboxWorkspaceGatewayContext,
  gatewayPath: string | null | undefined
) {
  const relativePath = gatewayPath?.trim().replace(/^\/+/, "") || ""
  const absolutePath = relativePath
    ? posix.join(workspace.gatewayRoot, relativePath)
    : workspace.gatewayRoot

  if (!isPosixPathInsideRoot(absolutePath, workspace.workspacePath)) {
    throw new Error("Gateway response path is outside the Studio workspace.")
  }

  return absolutePath
}

export async function fetchStudioWorkspaceGateway({
  workspace,
  path,
  init,
}: {
  workspace: StudioSandboxWorkspaceGatewayContext
  path: string
  init?: RequestInit
}) {
  return fetchWorkspaceGateway({
    sandboxId: workspace.sandboxId,
    workspacePath: workspace.gatewayRoot,
    path,
    init,
  })
}

export async function createStudioWorkspaceTerminal({
  workspace,
  cwd,
  cols,
  rows,
}: {
  workspace: StudioSandboxWorkspaceGatewayContext
  cwd?: string | null
  cols?: number | null
  rows?: number | null
}) {
  const resolvedCwd = resolveSandboxWorkspacePath({
    path: cwd?.trim() || workspace.workspacePath,
    workspaceRoot: workspace.workspacePath,
  })
  const terminal = await createWorkspaceGatewayTerminal({
    sandboxId: workspace.sandboxId,
    workspacePath: workspace.gatewayRoot,
    cwd: resolvedCwd,
    cols,
    rows,
  })

  return {
    ...terminal,
    cwd: toStudioWorkspaceAbsolutePath(workspace, terminal.cwd),
  }
}

export async function closeStudioWorkspaceTerminal({
  workspace,
  terminalId,
}: {
  workspace: StudioSandboxWorkspaceGatewayContext
  terminalId: string
}) {
  return closeWorkspaceGatewayTerminal({
    sandboxId: workspace.sandboxId,
    workspacePath: workspace.gatewayRoot,
    terminalId,
  })
}

export function getStudioWorkspaceGatewayErrorStatus(error: unknown) {
  if (error instanceof StudioWorkspaceTypeMismatchError) {
    return 409
  }

  if (error instanceof StudioWorkspaceGatewayNotFoundError) {
    return 404
  }

  return 502
}
