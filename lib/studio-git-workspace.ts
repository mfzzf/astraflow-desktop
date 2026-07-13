import { realpath } from "node:fs/promises"

import { runSafeGit } from "@/lib/studio-safe-git"
import type { StudioLocalProject, StudioWorkspace } from "@/lib/studio-types"

const GIT_ROOT_TIMEOUT_MS = 2_000

function git(root: string, args: string[]) {
  return runSafeGit(root, args, {
    timeout: GIT_ROOT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  })
}

export class StudioGitWorkspaceBindingError extends Error {
  readonly status: number

  constructor(message: string, status = 409) {
    super(message)
    this.name = "StudioGitWorkspaceBindingError"
    this.status = status
  }
}

export async function resolveStudioLocalGitWorkspaceRoot({
  project,
  workspace,
}: {
  project: StudioLocalProject
  workspace: StudioWorkspace
}) {
  if (workspace.type !== "local") {
    throw new StudioGitWorkspaceBindingError(
      "Sandbox workspaces cannot use the local Git transport."
    )
  }

  if (workspace.localProjectId !== project.id) {
    throw new StudioGitWorkspaceBindingError(
      "Local workspace is not bound to the requested project."
    )
  }

  let workspaceRoot: string
  let projectRoot: string

  try {
    ;[workspaceRoot, projectRoot] = await Promise.all([
      realpath(/* turbopackIgnore: true */ workspace.rootPath),
      realpath(/* turbopackIgnore: true */ project.path),
    ])
  } catch {
    throw new StudioGitWorkspaceBindingError(
      "Local workspace root is unavailable.",
      404
    )
  }

  if (workspaceRoot !== projectRoot) {
    throw new StudioGitWorkspaceBindingError(
      "Local workspace root does not match its registered project."
    )
  }

  return workspaceRoot
}

export async function isExactStudioGitWorkspaceRoot(root: string) {
  try {
    const inside = (
      await git(root, ["rev-parse", "--is-inside-work-tree"])
    ).trim()
    const repositoryPath = (
      await git(root, ["rev-parse", "--show-toplevel"])
    ).trim()
    const [workspaceRoot, repositoryRoot] = await Promise.all([
      realpath(/* turbopackIgnore: true */ root),
      realpath(/* turbopackIgnore: true */ repositoryPath),
    ])

    // A workspace nested inside a parent repository must not expose or mutate
    // sibling paths through Git. Treat only an exact repository root as Git.
    return inside === "true" && workspaceRoot === repositoryRoot
  } catch {
    return false
  }
}
