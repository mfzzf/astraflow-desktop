import { execFile } from "node:child_process"
import { lstat, readFile, realpath } from "node:fs/promises"
import path from "node:path"

const SAFE_GIT_CONFIG_ARGS = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
]
const SAFE_GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
}
const GIT_TIMEOUT_MS = 2_000
const MAX_DIFF_FILES = 50
const MAX_UNTRACKED_DIFF_BYTES = 200 * 1024

function runGit(root, args) {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [...SAFE_GIT_CONFIG_ARGS, "-C", root, ...args],
      {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, ...SAFE_GIT_ENV },
      },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }

        resolve(stdout.toString())
      }
    )
  })
}

function parseStatusEntries(output) {
  const entries = []
  const records = output.split("\0")

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]

    if (!record || record.length < 4) {
      continue
    }

    const status = record.slice(0, 2)
    entries.push({ status, path: record.slice(3) })

    if (status.includes("R") || status.includes("C")) {
      index += 1
    }
  }

  return entries
}

function getChangeKind(status) {
  if (status.includes("D")) {
    return "delete"
  }

  if (status === "??" || status.includes("A")) {
    return "create"
  }

  return "edit"
}

function quoteDiffPath(filePath) {
  return /[\s"\\\u0000-\u001f\u007f]/.test(filePath)
    ? JSON.stringify(filePath)
    : filePath
}

function getDiffStats(diff) {
  let additions = 0
  let deletions = 0

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue
    }

    if (line.startsWith("+")) {
      additions += 1
    } else if (line.startsWith("-")) {
      deletions += 1
    }
  }

  return { additions, deletions }
}

function getDiffChangeKind(diff, fallback) {
  if (diff.includes("\nnew file mode ")) {
    return "create"
  }

  if (diff.includes("\ndeleted file mode ")) {
    return "delete"
  }

  return fallback
}

function isInsideRoot(root, candidate) {
  const relativePath = path.relative(root, candidate)

  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  )
}

async function buildUntrackedDiff(root, relativePath) {
  try {
    const absolutePath = path.resolve(root, relativePath)

    if (!isInsideRoot(root, absolutePath)) {
      return null
    }

    const stats = await lstat(absolutePath)

    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.size > MAX_UNTRACKED_DIFF_BYTES
    ) {
      return { additions: 0, diff: null }
    }

    const buffer = await readFile(absolutePath)

    if (buffer.includes(0)) {
      return { additions: 0, diff: null }
    }

    const content = buffer.toString("utf8")
    const lines = content.split(/\r?\n/)
    const hasTrailingNewline = lines.at(-1) === ""

    if (hasTrailingNewline) {
      lines.pop()
    }

    const oldPath = quoteDiffPath(`a/${relativePath}`)
    const newPath = quoteDiffPath(`b/${relativePath}`)
    const diff = [
      `diff --git ${oldPath} ${newPath}`,
      "new file mode 100644",
      "--- /dev/null",
      `+++ ${newPath}`,
      ...(lines.length > 0
        ? [
            `@@ -0,0 +1,${lines.length} @@`,
            ...lines.map((line) => `+${line}`),
            ...(hasTrailingNewline ? [] : ["\\ No newline at end of file"]),
          ]
        : []),
    ].join("\n")

    return { additions: lines.length, diff: `${diff}\n` }
  } catch {
    return null
  }
}

async function isExactGitWorkspaceRoot(root) {
  try {
    const inside = (
      await runGit(root, ["rev-parse", "--is-inside-work-tree"])
    ).trim()
    const topLevel = await realpath(
      (await runGit(root, ["rev-parse", "--show-toplevel"])).trim()
    )

    return inside === "true" && topLevel === root
  } catch {
    return false
  }
}

async function readGitSummary(root) {
  const [branchResult, branchesResult, remotesResult, upstreamResult] =
    await Promise.allSettled([
      runGit(root, ["branch", "--show-current"]),
      runGit(root, ["branch", "--format=%(refname:short)"]),
      runGit(root, ["remote"]),
      runGit(root, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]),
    ])
  const branch =
    branchResult.status === "fulfilled"
      ? branchResult.value.trim() || null
      : null
  const branches =
    branchesResult.status === "fulfilled"
      ? branchesResult.value
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean)
      : []
  const remote =
    remotesResult.status === "fulfilled"
      ? remotesResult.value
          .split(/\r?\n/)
          .map((value) => value.trim())
          .find(Boolean) ?? null
      : null
  let ahead = null
  let behind = null

  if (upstreamResult.status === "fulfilled") {
    const [rawBehind, rawAhead] = upstreamResult.value.trim().split(/\s+/, 2)
    const parsedBehind = Number.parseInt(rawBehind, 10)
    const parsedAhead = Number.parseInt(rawAhead, 10)

    behind = Number.isFinite(parsedBehind) ? parsedBehind : null
    ahead = Number.isFinite(parsedAhead) ? parsedAhead : null
  }

  return { branch, branches, remote, ahead, behind }
}

async function readUncommittedChanges(root) {
  const headAvailable = await runGit(root, ["rev-parse", "--verify", "HEAD"])
    .then(() => true)
    .catch(() => false)
  const statusOutput = await runGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    ".",
  ])
  const statusEntries = parseStatusEntries(statusOutput)
  const truncated = statusEntries.length > MAX_DIFF_FILES
  const candidates = await Promise.all(
    statusEntries.slice(0, MAX_DIFF_FILES).map(async (entry) => {
      const fallbackKind = getChangeKind(entry.status)

      if (entry.status === "??" || !headAvailable) {
        const untracked = await buildUntrackedDiff(root, entry.path)

        return untracked
          ? {
              path: entry.path,
              kind: "create",
              additions: untracked.additions,
              deletions: 0,
              diff: untracked.diff,
            }
          : null
      }

      const diff = await runGit(root, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
        "--",
        `:(literal)${entry.path}`,
      ]).catch(() => null)

      if (!diff?.trim()) {
        return null
      }

      const stats = getDiffStats(diff)

      return {
        path: entry.path,
        kind: getDiffChangeKind(diff, fallbackKind),
        additions: stats.additions,
        deletions: stats.deletions,
        diff,
      }
    })
  )

  return { files: candidates.filter(Boolean), truncated }
}

export async function readWorkspaceGitReview(workspaceRoot) {
  if (!(await isExactGitWorkspaceRoot(workspaceRoot))) {
    return {
      files: [],
      truncated: false,
      gitAvailable: false,
      git: null,
    }
  }

  const [changes, git] = await Promise.all([
    readUncommittedChanges(workspaceRoot),
    readGitSummary(workspaceRoot),
  ])

  return { ...changes, gitAvailable: true, git }
}
