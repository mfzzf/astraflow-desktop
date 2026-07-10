import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, sep } from "node:path"

import type { AgentFileChangeEvent } from "@/lib/agent/events"
import { parseUnifiedDiffToFileChanges } from "@/lib/agent/unified-diff"
import { runSafeGit } from "@/lib/studio-safe-git"

const SNAPSHOT_GIT_TIMEOUT_MS = 15_000
const SNAPSHOT_GIT_MAX_BUFFER = 32 * 1024 * 1024
const SNAPSHOT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"

export type GitWorktreeSnapshot = {
  beforeTree: string
  finishPromise: Promise<AgentFileChangeEvent[] | null> | null
  indexPath: string
  pathspec: string
  repositoryRoot: string
  temporaryDirectory: string
}

function debugSnapshotFailure(stage: string, error: unknown) {
  if (!SNAPSHOT_DEBUG) {
    return
  }

  console.warn("[studio-chat] git_worktree_snapshot_failed", {
    stage,
    error: error instanceof Error ? error.message : String(error),
  })
}

function snapshotOptions(indexPath: string) {
  return {
    timeout: SNAPSHOT_GIT_TIMEOUT_MS,
    maxBuffer: SNAPSHOT_GIT_MAX_BUFFER,
    env: {
      GIT_INDEX_FILE: indexPath,
    },
  }
}

async function captureWorktreeTree(
  repositoryRoot: string,
  indexPath: string,
  pathspec: string
) {
  const options = snapshotOptions(indexPath)
  const literalPathspec = pathspec === "." ? pathspec : `:(literal)${pathspec}`

  await runSafeGit(repositoryRoot, ["read-tree", "--empty"], options)
  await runSafeGit(
    repositoryRoot,
    ["add", "-A", "--", literalPathspec],
    options
  )

  return (await runSafeGit(repositoryRoot, ["write-tree"], options)).trim()
}

export async function beginGitWorktreeSnapshot(
  projectPath: string
): Promise<GitWorktreeSnapshot | null> {
  let temporaryDirectory: string | null = null

  try {
    const repositoryRoot = await realpath(
      (
        await runSafeGit(projectPath, ["rev-parse", "--show-toplevel"], {
          timeout: SNAPSHOT_GIT_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        })
      ).trim()
    )

    if (!repositoryRoot) {
      return null
    }

    const projectRealPath = await realpath(projectPath)
    const relativeProjectPath = relative(repositoryRoot, projectRealPath)

    if (
      relativeProjectPath === ".." ||
      relativeProjectPath.startsWith(`..${sep}`) ||
      isAbsolute(relativeProjectPath)
    ) {
      throw new Error("Project path is outside its Git repository root.")
    }

    const pathspec = relativeProjectPath || "."

    temporaryDirectory = await mkdtemp(
      join(tmpdir(), "astraflow-git-snapshot-")
    )
    const indexPath = join(temporaryDirectory, "index")
    const beforeTree = await captureWorktreeTree(
      repositoryRoot,
      indexPath,
      pathspec
    )

    if (!beforeTree) {
      throw new Error("Git did not return a worktree tree id.")
    }

    return {
      beforeTree,
      finishPromise: null,
      indexPath,
      pathspec,
      repositoryRoot,
      temporaryDirectory,
    }
  } catch (error) {
    debugSnapshotFailure("begin", error)

    if (temporaryDirectory) {
      await rm(temporaryDirectory, { force: true, recursive: true }).catch(
        () => undefined
      )
    }

    return null
  }
}

async function finishSnapshot(
  snapshot: GitWorktreeSnapshot
): Promise<AgentFileChangeEvent[] | null> {
  try {
    const afterTree = await captureWorktreeTree(
      snapshot.repositoryRoot,
      snapshot.indexPath,
      snapshot.pathspec
    )
    const literalPathspec =
      snapshot.pathspec === "."
        ? snapshot.pathspec
        : `:(literal)${snapshot.pathspec}`
    const relativeArgs =
      snapshot.pathspec === "."
        ? []
        : [`--relative=${snapshot.pathspec.replaceAll("\\", "/")}`]
    const diff = await runSafeGit(
      snapshot.repositoryRoot,
      [
        "diff",
        "--binary",
        "--find-renames=50%",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        ...relativeArgs,
        snapshot.beforeTree,
        afterTree,
        "--",
        literalPathspec,
      ],
      snapshotOptions(snapshot.indexPath)
    )

    return parseUnifiedDiffToFileChanges(diff)
  } catch (error) {
    debugSnapshotFailure("finish", error)
    return null
  } finally {
    await rm(snapshot.temporaryDirectory, {
      force: true,
      recursive: true,
    }).catch(() => undefined)
  }
}

export function finishGitWorktreeSnapshot(
  snapshot: GitWorktreeSnapshot
): Promise<AgentFileChangeEvent[] | null> {
  snapshot.finishPromise ??= finishSnapshot(snapshot)

  return snapshot.finishPromise
}
