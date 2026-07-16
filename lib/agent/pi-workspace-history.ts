import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync } from "node:fs"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"

import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"
import { safeFileName } from "@/lib/studio-file-storage"
import { runSafeGit } from "@/lib/studio-safe-git"

const HISTORY_GIT_TIMEOUT_MS = 30_000
const HISTORY_GIT_MAX_BUFFER = 64 * 1024 * 1024
const HISTORY_REF_ROOT = "refs/astraflow/workspace-history"
const EXCLUDED_PATHS = [
  ":(exclude).git",
  ":(exclude).git/**",
  ":(exclude,glob)**/.git/**",
  ":(exclude)node_modules",
  ":(exclude,glob)**/node_modules/**",
  ":(exclude).next",
  ":(exclude,glob)**/.next/**",
  ":(exclude)dist",
  ":(exclude,glob)**/dist/**",
  ":(exclude)build",
  ":(exclude,glob)**/build/**",
  ":(exclude)coverage",
  ":(exclude,glob)**/coverage/**",
  ":(exclude).turbo",
  ":(exclude,glob)**/.turbo/**",
  ":(exclude).env",
  ":(exclude).env.*",
  ":(exclude,glob)**/.env",
  ":(exclude,glob)**/.env.*",
]

export type PiWorkspaceHistorySnapshot = {
  beforeRef: string
  projectPath: string
  repositoryPath: string
  sessionId: string
}

export type PiWorkspaceRestoreResult = {
  safetyRef: string
}

function historyGitOptions(indexPath?: string) {
  return {
    timeout: HISTORY_GIT_TIMEOUT_MS,
    maxBuffer: HISTORY_GIT_MAX_BUFFER,
    env: {
      ...(indexPath ? { GIT_INDEX_FILE: indexPath } : {}),
      GIT_AUTHOR_NAME: "AstraFlow Workspace History",
      GIT_AUTHOR_EMAIL: "workspace-history@astraflow.local",
      GIT_COMMITTER_NAME: "AstraFlow Workspace History",
      GIT_COMMITTER_EMAIL: "workspace-history@astraflow.local",
    },
  }
}

function historyRootForSession(sessionId: string) {
  const workspace = ensureLocalSandboxWorkspace(sessionId)

  return join(
    dirname(workspace),
    ".workspace-history",
    safeFileName(sessionId)
  )
}

function normalizeRefSegment(value: string) {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "-")
}

async function ensureHistoryRepository(sessionId: string) {
  const historyRoot = historyRootForSession(sessionId)
  const repositoryPath = join(historyRoot, "repo.git")

  mkdirSync(historyRoot, { recursive: true })

  if (!existsSync(join(repositoryPath, "HEAD"))) {
    await runSafeGit(historyRoot, ["init", "--bare", repositoryPath], {
      timeout: HISTORY_GIT_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    })
  }

  return repositoryPath
}

function historyArgs(
  repositoryPath: string,
  projectPath: string,
  args: string[]
) {
  return [
    `--git-dir=${repositoryPath}`,
    `--work-tree=${projectPath}`,
    ...args,
  ]
}

async function withTemporaryIndex<T>(
  task: (indexPath: string) => Promise<T>
) {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "astraflow-history-")
  )
  const indexPath = join(temporaryDirectory, "index")

  try {
    return await task(indexPath)
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true }).catch(
      () => undefined
    )
  }
}

async function captureTree({
  projectPath,
  repositoryPath,
}: {
  projectPath: string
  repositoryPath: string
}) {
  return withTemporaryIndex(async (indexPath) => {
    const options = historyGitOptions(indexPath)

    await runSafeGit(
      projectPath,
      historyArgs(repositoryPath, projectPath, ["read-tree", "--empty"]),
      options
    )
    await runSafeGit(
      projectPath,
      historyArgs(repositoryPath, projectPath, [
        "add",
        "-A",
        "--",
        ".",
        ...EXCLUDED_PATHS,
      ]),
      options
    )

    const tree = (
      await runSafeGit(
        projectPath,
        historyArgs(repositoryPath, projectPath, ["write-tree"]),
        options
      )
    ).trim()

    if (!tree) {
      throw new Error("Git did not return a workspace history tree.")
    }

    return tree
  })
}

async function commitTree({
  label,
  parentRef,
  projectPath,
  refName,
  repositoryPath,
  tree,
}: {
  label: string
  parentRef?: string | null
  projectPath: string
  refName: string
  repositoryPath: string
  tree: string
}) {
  const args = ["commit-tree", tree]

  if (parentRef) {
    args.push("-p", parentRef)
  }

  const commit = (
    await runSafeGit(
      projectPath,
      historyArgs(repositoryPath, projectPath, args),
      {
        ...historyGitOptions(),
        input: `${label}\n`,
      }
    )
  ).trim()

  if (!commit) {
    throw new Error("Git did not return a workspace history commit.")
  }

  await runSafeGit(
    projectPath,
    historyArgs(repositoryPath, projectPath, [
      "update-ref",
      `${HISTORY_REF_ROOT}/${refName}`,
      commit,
    ]),
    historyGitOptions()
  )

  return commit
}

async function canonicalProjectPath(projectPath: string) {
  const canonical = await realpath(resolve(projectPath))

  if (!canonical) {
    throw new Error("Workspace path is unavailable.")
  }

  return canonical
}

export async function beginPiWorkspaceHistorySnapshot({
  projectPath,
  sessionId,
  turnId,
}: {
  projectPath: string
  sessionId: string
  turnId: string
}): Promise<PiWorkspaceHistorySnapshot> {
  const canonicalPath = await canonicalProjectPath(projectPath)
  const repositoryPath = await ensureHistoryRepository(sessionId)
  const tree = await captureTree({
    projectPath: canonicalPath,
    repositoryPath,
  })
  const refSegment = normalizeRefSegment(turnId)
  const beforeRef = await commitTree({
    label: `Before AstraFlow turn ${turnId}`,
    projectPath: canonicalPath,
    refName: `turns/${refSegment}/before`,
    repositoryPath,
    tree,
  })

  return {
    beforeRef,
    projectPath: canonicalPath,
    repositoryPath,
    sessionId,
  }
}

export async function finishPiWorkspaceHistorySnapshot({
  snapshot,
  turnId,
}: {
  snapshot: PiWorkspaceHistorySnapshot
  turnId: string
}) {
  const tree = await captureTree({
    projectPath: snapshot.projectPath,
    repositoryPath: snapshot.repositoryPath,
  })
  const afterRef = await commitTree({
    label: `After AstraFlow turn ${turnId}`,
    parentRef: snapshot.beforeRef,
    projectPath: snapshot.projectPath,
    refName: `turns/${normalizeRefSegment(turnId)}/after`,
    repositoryPath: snapshot.repositoryPath,
    tree,
  })

  return {
    afterRef,
    beforeRef: snapshot.beforeRef,
    projectPath: snapshot.projectPath,
  }
}

async function resolveTree(
  projectPath: string,
  repositoryPath: string,
  ref: string
) {
  return (
    await runSafeGit(
      projectPath,
      historyArgs(repositoryPath, projectPath, [
        "rev-parse",
        `${ref}^{tree}`,
      ]),
      historyGitOptions()
    )
  ).trim()
}

async function listTreePaths(
  projectPath: string,
  repositoryPath: string,
  ref: string
) {
  const output = await runSafeGit(
    projectPath,
    historyArgs(repositoryPath, projectPath, [
      "ls-tree",
      "-r",
      "-z",
      "--name-only",
      ref,
    ]),
    historyGitOptions()
  )

  return output.split("\0").filter(Boolean)
}

function assertSafeRelativePath(path: string) {
  const normalized = path.replaceAll("\\", "/")

  if (
    !normalized ||
    isAbsolute(path) ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Workspace history contains an unsafe file path.")
  }

  return normalized
}

async function restoreRef({
  projectPath,
  repositoryPath,
  targetRef,
}: {
  projectPath: string
  repositoryPath: string
  targetRef: string
}) {
  await withTemporaryIndex(async (indexPath) => {
    const options = historyGitOptions(indexPath)
    const currentTree = await captureTree({ projectPath, repositoryPath })
    const currentPaths = await listTreePaths(
      projectPath,
      repositoryPath,
      currentTree
    )
    const targetPaths = new Set(
      await listTreePaths(projectPath, repositoryPath, targetRef)
    )

    for (const path of currentPaths) {
      if (!targetPaths.has(path)) {
        const safePath = assertSafeRelativePath(path)
        const absolutePath = resolve(projectPath, safePath)
        const relativePath = relative(projectPath, absolutePath)

        if (
          relativePath === ".." ||
          relativePath.startsWith(`..${sep}`) ||
          isAbsolute(relativePath)
        ) {
          throw new Error("Workspace history tried to delete an outside path.")
        }

        await rm(absolutePath, { force: true, recursive: true })
      }
    }

    await runSafeGit(
      projectPath,
      historyArgs(repositoryPath, projectPath, ["read-tree", targetRef]),
      options
    )
    await runSafeGit(
      projectPath,
      historyArgs(repositoryPath, projectPath, [
        "checkout-index",
        "--all",
        "--force",
      ]),
      options
    )
  })
}

export async function restorePiWorkspaceHistory({
  expectedCurrentRef,
  projectPath,
  sessionId,
  targetRef,
}: {
  expectedCurrentRef: string
  projectPath: string
  sessionId: string
  targetRef: string
}): Promise<PiWorkspaceRestoreResult> {
  const canonicalPath = await canonicalProjectPath(projectPath)
  const repositoryPath = await ensureHistoryRepository(sessionId)
  const currentTree = await captureTree({
    projectPath: canonicalPath,
    repositoryPath,
  })
  const expectedTree = await resolveTree(
    canonicalPath,
    repositoryPath,
    expectedCurrentRef
  )

  if (currentTree !== expectedTree) {
    throw new Error(
      "Workspace changed after the last checkpoint. Save or revert those changes before rewinding."
    )
  }

  const safetyRef = await commitTree({
    label: "AstraFlow rewind safety checkpoint",
    projectPath: canonicalPath,
    refName: `safety/${Date.now()}-${randomUUID()}`,
    repositoryPath,
    tree: currentTree,
  })

  await restoreRef({
    projectPath: canonicalPath,
    repositoryPath,
    targetRef,
  })

  return { safetyRef }
}

export async function restorePiWorkspaceHistorySafety({
  projectPath,
  safetyRef,
  sessionId,
}: {
  projectPath: string
  safetyRef: string
  sessionId: string
}) {
  const canonicalPath = await canonicalProjectPath(projectPath)
  const repositoryPath = await ensureHistoryRepository(sessionId)

  await restoreRef({
    projectPath: canonicalPath,
    repositoryPath,
    targetRef: safetyRef,
  })
}
