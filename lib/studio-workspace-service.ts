import { stat, realpath } from "node:fs/promises"
import { basename, posix } from "node:path"

import {
  listCodeBoxSandboxDirectories,
  listCodeBoxSandboxes,
} from "@/lib/codebox-runtime"
import {
  isPosixPathInsideRoot,
  normalizeSandboxWorkspaceRoot,
} from "@/lib/sandbox-workspace-paths"
import {
  createStudioLocalProject,
  createStudioSandboxWorkspace,
  ensureStudioLocalWorkspaceForProject,
} from "@/lib/studio-db"

export class StudioWorkspaceNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StudioWorkspaceNotFoundError"
  }
}

export class StudioWorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StudioWorkspaceValidationError"
  }
}

function normalizeWorkspaceName(
  name: string | null | undefined,
  fallbackName: string
) {
  const normalized = name?.trim() || fallbackName || "Workspace"

  if (normalized.length > 64) {
    throw new StudioWorkspaceValidationError(
      "Workspace name must be 64 characters or fewer."
    )
  }

  return normalized
}

export async function createLocalStudioWorkspace({
  name,
  path,
}: {
  name?: string | null
  path: string
}) {
  const requestedPath = path.trim()

  if (!requestedPath) {
    throw new StudioWorkspaceValidationError(
      "Local workspace path is required."
    )
  }

  let canonicalPath: string

  try {
    const stats = await stat(/* turbopackIgnore: true */ requestedPath)

    if (!stats.isDirectory()) {
      throw new StudioWorkspaceValidationError(
        "Local workspace path must be a directory."
      )
    }

    canonicalPath = await realpath(/* turbopackIgnore: true */ requestedPath)
  } catch (error) {
    if (error instanceof StudioWorkspaceValidationError) {
      throw error
    }

    throw new StudioWorkspaceNotFoundError(
      "Local workspace directory was not found."
    )
  }

  const project = createStudioLocalProject({
    name: normalizeWorkspaceName(
      name,
      basename(canonicalPath) || canonicalPath
    ),
    path: canonicalPath,
  })

  return ensureStudioLocalWorkspaceForProject(project)
}

export async function createSandboxStudioWorkspace({
  name,
  rootPath,
  sandboxId,
}: {
  name?: string | null
  rootPath: string
  sandboxId: string
}) {
  const normalizedSandboxId = sandboxId.trim()

  if (!normalizedSandboxId) {
    throw new StudioWorkspaceValidationError("Sandbox id is required.")
  }

  if (rootPath.includes("\0")) {
    throw new StudioWorkspaceValidationError(
      "Sandbox workspace path contains an invalid null byte."
    )
  }

  let normalizedRoot: string

  try {
    normalizedRoot = normalizeSandboxWorkspaceRoot(rootPath)
  } catch (error) {
    throw new StudioWorkspaceValidationError(
      error instanceof Error
        ? error.message
        : "Sandbox workspace path is invalid."
    )
  }

  const sandboxes = await listCodeBoxSandboxes({ state: "all" })
  const sandbox = sandboxes.find(
    (candidate) => candidate.sandboxId === normalizedSandboxId
  )

  if (!sandbox) {
    throw new StudioWorkspaceNotFoundError("Owned Code Sandbox was not found.")
  }

  const gatewayRoot = posix.normalize(sandbox.workspacePath)

  if (!isPosixPathInsideRoot(normalizedRoot, gatewayRoot)) {
    throw new StudioWorkspaceValidationError(
      `Sandbox workspace path must stay under ${gatewayRoot}.`
    )
  }

  let directory

  try {
    // This also auto-resumes paused sandboxes and proves that the selected
    // path is an existing directory in a sandbox owned by the current user.
    directory = await listCodeBoxSandboxDirectories({
      sandboxId: normalizedSandboxId,
      path: normalizedRoot,
    })
  } catch (error) {
    throw new StudioWorkspaceNotFoundError(
      error instanceof Error
        ? error.message
        : "Sandbox workspace directory was not found."
    )
  }

  const canonicalRoot = posix.normalize(
    directory.resolvedPath || directory.path
  )

  if (!isPosixPathInsideRoot(canonicalRoot, gatewayRoot)) {
    throw new StudioWorkspaceValidationError(
      "Sandbox workspace directory resolves outside the Gateway root."
    )
  }

  return createStudioSandboxWorkspace({
    name: normalizeWorkspaceName(
      name,
      posix.basename(canonicalRoot) || canonicalRoot
    ),
    rootPath: canonicalRoot,
    sandboxId: normalizedSandboxId,
  })
}
