import { lstatSync, realpathSync } from "node:fs"
import { resolve } from "node:path"

import { connectOwnedCodeBoxSandbox } from "@/lib/codebox-runtime"
import { getStudioSession, getStudioSessionWorkspace } from "@/lib/studio-db"
import type { StudioLocalWorkspace } from "@/lib/studio-types"

export class StudioSessionWorkspaceUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StudioSessionWorkspaceUnavailableError"
  }
}

function normalizeWorkspacePath(path: string) {
  const normalized = resolve(path)

  return process.platform === "win32" || process.platform === "darwin"
    ? normalized.toLocaleLowerCase("en-US")
    : normalized
}

function validateOwnedLocalWorkspaceRoot(workspace: StudioLocalWorkspace) {
  if (
    workspace.origin !== "managed_local" &&
    workspace.origin !== "legacy_local"
  ) {
    return workspace.rootPath
  }

  const configuredRoot = resolve(workspace.rootPath)
  let stats

  try {
    stats = lstatSync(configuredRoot)
  } catch {
    throw new StudioSessionWorkspaceUnavailableError(
      `The ${workspace.origin === "legacy_local" ? "legacy task" : "task"} workspace is unavailable: ${configuredRoot}`
    )
  }

  if (stats.isSymbolicLink()) {
    throw new StudioSessionWorkspaceUnavailableError(
      `The task workspace cannot be a symbolic link: ${configuredRoot}`
    )
  }

  if (!stats.isDirectory()) {
    throw new StudioSessionWorkspaceUnavailableError(
      `The task workspace is not a directory: ${configuredRoot}`
    )
  }

  let canonicalRoot: string

  try {
    canonicalRoot = realpathSync.native(configuredRoot)
  } catch {
    throw new StudioSessionWorkspaceUnavailableError(
      `The task workspace is unavailable: ${configuredRoot}`
    )
  }

  if (
    normalizeWorkspacePath(canonicalRoot) !==
    normalizeWorkspacePath(configuredRoot)
  ) {
    throw new StudioSessionWorkspaceUnavailableError(
      `The task workspace path changed and must be reselected: ${configuredRoot}`
    )
  }

  return canonicalRoot
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

  const workspaceRoot =
    workspace.type === "local"
      ? validateOwnedLocalWorkspaceRoot(workspace)
      : workspace.rootPath

  return {
    session,
    workspace,
    workspaceId: workspace.id,
    workspaceRoot,
    type: workspace.type,
  }
}

export function getStudioSessionWorkspaceExecutionTarget(sessionId: string) {
  const context = getStudioSessionWorkspaceExecutionContext(sessionId)
  const environment: "remote" | "local" =
    context?.type === "sandbox" ? "remote" : "local"

  return {
    context,
    environment,
    workspaceId: context?.workspaceId ?? null,
    workspaceRoot: context?.workspaceRoot ?? null,
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
