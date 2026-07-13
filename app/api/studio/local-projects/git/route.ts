import { lstat, readFile } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"
import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  isExactStudioGitWorkspaceRoot,
  resolveStudioLocalGitWorkspaceRoot,
  StudioGitWorkspaceBindingError,
} from "@/lib/studio-git-workspace"
import { getStudioWorkspace, listStudioLocalProjects } from "@/lib/studio-db"
import { runSafeGit } from "../safe-git"

export const runtime = "nodejs"

const GIT_TIMEOUT_MS = 2_000
const GIT_PUSH_TIMEOUT_MS = 30_000
const GIT_APPLY_TIMEOUT_MS = 10_000
const MAX_DIFF_FILES = 50
const MAX_UNTRACKED_DIFF_BYTES = 200 * 1024
const MAX_PATCH_BYTES = 4 * 1024 * 1024
const MAX_SINGLE_PATCH_BYTES = 1024 * 1024
const MAX_PATCH_PATH_LENGTH = 1024

const execGit = (
  path: string,
  args: string[],
  timeout = GIT_TIMEOUT_MS,
  input?: string
) =>
  runSafeGit(path, args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    input,
  })

function isSafePatchPath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const segments = normalized.split("/")

  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[a-zA-Z]:\//.test(normalized) &&
    !normalized.includes("\0") &&
    !normalized.includes("\n") &&
    !normalized.includes("\r") &&
    segments.every(
      (segment) => segment && segment !== "." && segment !== ".."
    ) &&
    !segments.includes(".git")
  )
}

const projectIdSchema = z.string().trim().min(1)
const standardGitActionSchema = z.object({
  id: projectIdSchema,
  action: z.enum(["commit", "push", "commit-and-push"]),
  message: z.string().trim().max(2000).optional(),
})
const branchNameSchema = z.string().trim().min(1).max(255)
const switchBranchActionSchema = z.object({
  id: projectIdSchema,
  action: z.literal("switch-branch"),
  branch: branchNameSchema,
})
const createBranchActionSchema = z.object({
  id: projectIdSchema,
  action: z.literal("create-branch"),
  branch: branchNameSchema,
})
const patchItemSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(MAX_PATCH_PATH_LENGTH)
    .refine(
      (path) => path === path.trim(),
      "Patch paths cannot have surrounding whitespace."
    )
    .refine(isSafePatchPath, "Patch paths must stay inside the project."),
  diff: z
    .string()
    .min(1)
    .max(MAX_SINGLE_PATCH_BYTES)
    .refine((diff) => Boolean(diff.trim()), "Patch content is required."),
})
const applyPatchActionSchema = z.object({
  id: projectIdSchema,
  action: z.literal("apply-patch"),
  direction: z.enum(["reverse", "forward"]),
  patches: z.array(patchItemSchema).min(1).max(MAX_DIFF_FILES),
})
const gitActionSchema = z.discriminatedUnion("action", [
  standardGitActionSchema,
  switchBranchActionSchema,
  createBranchActionSchema,
  applyPatchActionSchema,
])

type GitChangeKind = "create" | "edit" | "delete"

type GitFileChange = {
  path: string
  kind: GitChangeKind
  additions: number
  deletions: number
  diff: string | null
}

function normalizePatchPath(path: string) {
  return path.replaceAll("\\", "/")
}

function decodeGitQuotedPath(value: string) {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value
  }

  const source = value.slice(1, -1)
  const bytes: number[] = []
  const encoder = new TextEncoder()

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (character !== "\\") {
      bytes.push(...encoder.encode(character))
      continue
    }

    const escape = source[index + 1]

    if (!escape) {
      return null
    }

    if (/[0-7]/.test(escape)) {
      const match = source.slice(index + 1).match(/^[0-7]{1,3}/)?.[0]

      if (!match) {
        return null
      }

      bytes.push(Number.parseInt(match, 8))
      index += match.length
      continue
    }

    const escapedBytes: Record<string, number> = {
      a: 7,
      b: 8,
      t: 9,
      n: 10,
      v: 11,
      f: 12,
      r: 13,
      '"': 34,
      "\\": 92,
    }
    const byte = escapedBytes[escape]

    if (byte === undefined) {
      return null
    }

    bytes.push(byte)
    index += 1
  }

  return new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(bytes)
  )
}

function getUnifiedDiffHeaderPath(line: string) {
  const rawValue = line.slice(4).split("\t", 1)[0]?.trim()

  if (!rawValue) {
    return null
  }

  const decoded = decodeGitQuotedPath(rawValue)

  if (!decoded || decoded === "/dev/null") {
    return decoded
  }

  return normalizePatchPath(decoded.replace(/^[ab]\//, ""))
}

function isUnifiedDiffForPath(diff: string, expectedPath: string) {
  const lines = diff.split(/\r?\n/)
  const firstHunkIndex = lines.findIndex((line) => line.startsWith("@@ "))
  const hasAdditionalFileSection = lines.some(
    (line, index) =>
      index > firstHunkIndex &&
      line.startsWith("--- ") &&
      lines[index + 1]?.startsWith("+++ ")
  )
  const headerLines = firstHunkIndex >= 0 ? lines.slice(0, firstHunkIndex) : []
  const oldHeaders = headerLines.filter((line) => line.startsWith("--- "))
  const newHeaders = headerLines.filter((line) => line.startsWith("+++ "))

  if (
    oldHeaders.length !== 1 ||
    newHeaders.length !== 1 ||
    firstHunkIndex < 0 ||
    hasAdditionalFileSection ||
    lines.filter((line) => line.startsWith("diff --git ")).length > 1
  ) {
    return false
  }

  let oldPath: string | null
  let newPath: string | null

  try {
    oldPath = getUnifiedDiffHeaderPath(oldHeaders[0])
    newPath = getUnifiedDiffHeaderPath(newHeaders[0])
  } catch {
    return false
  }
  const normalizedExpectedPath = normalizePatchPath(expectedPath)

  return (
    oldPath !== null &&
    newPath !== null &&
    (oldPath === normalizedExpectedPath || oldPath === "/dev/null") &&
    (newPath === normalizedExpectedPath || newPath === "/dev/null") &&
    (oldPath === normalizedExpectedPath || newPath === normalizedExpectedPath)
  )
}

function buildPatchBatch({
  patches,
  direction,
}: {
  patches: { path: string; diff: string }[]
  direction: "reverse" | "forward"
}) {
  const orderedPatches =
    direction === "reverse" ? patches.toReversed() : patches

  return orderedPatches
    .map((patch) =>
      patch.diff.endsWith("\n") ? patch.diff : `${patch.diff}\n`
    )
    .join("")
}

function findProject(id: string) {
  return listStudioLocalProjects().find((project) => project.id === id) ?? null
}

function parseNulSeparatedPaths(output: string) {
  return output.split("\0").filter(Boolean)
}

function pathsOverlap(left: string, right: string) {
  return (
    left === right ||
    left.startsWith(`${right}/`) ||
    right.startsWith(`${left}/`)
  )
}

function formatConflictPath(path: string) {
  const sanitized = path.replace(/[\u0000-\u001f\u007f]/g, "�")
  return sanitized.length > 160 ? `${sanitized.slice(0, 157)}…` : sanitized
}

async function isValidBranchName(root: string, branch: string) {
  try {
    const normalizedBranch = (
      await execGit(root, ["check-ref-format", "--branch", branch])
    ).trim()
    return normalizedBranch === branch
  } catch {
    return false
  }
}

async function localBranchExists(root: string, branch: string) {
  try {
    await execGit(root, ["rev-parse", "--verify", `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

async function readDirtyPaths(root: string) {
  const results = await Promise.allSettled([
    execGit(root, ["diff", "--name-only", "-z", "--"]),
    execGit(root, ["diff", "--cached", "--name-only", "-z", "--"]),
    execGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ])
  const paths = new Set<string>()

  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue
    }

    for (const path of parseNulSeparatedPaths(result.value)) {
      paths.add(path)
    }
  }

  return [...paths]
}

async function readTargetChangedPaths(root: string, branch: string) {
  const hasHead = await execGit(root, ["rev-parse", "--verify", "HEAD"])
    .then(() => true)
    .catch(() => false)
  const output = hasHead
    ? await execGit(root, [
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        "HEAD",
        `refs/heads/${branch}`,
        "--",
      ])
    : await execGit(root, [
        "ls-tree",
        "-r",
        "--name-only",
        "-z",
        `refs/heads/${branch}`,
      ])

  return parseNulSeparatedPaths(output)
}

async function findBranchSwitchConflicts(root: string, branch: string) {
  const dirtyPaths = await readDirtyPaths(root)

  if (dirtyPaths.length === 0) {
    return []
  }

  const targetChangedPaths = await readTargetChangedPaths(root, branch)

  return dirtyPaths.filter((dirtyPath) =>
    targetChangedPaths.some((targetPath) => pathsOverlap(dirtyPath, targetPath))
  )
}

function parseStatusEntries(output: string) {
  const entries: { status: string; path: string }[] = []
  const records = output.split("\0")

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]

    if (!record || record.length < 4) {
      continue
    }

    const status = record.slice(0, 2)
    const path = record.slice(3)

    entries.push({ status, path })

    // In porcelain v1 -z output, rename/copy records are followed by the
    // original path as a second NUL-delimited field. The first path is the
    // destination that should be reviewed.
    if (status.includes("R") || status.includes("C")) {
      index += 1
    }
  }

  return entries
}

function getChangeKind(status: string): GitChangeKind {
  if (status.includes("D")) {
    return "delete"
  }

  if (status === "??" || status.includes("A")) {
    return "create"
  }

  return "edit"
}

function quoteDiffPath(path: string) {
  return /[\s"\\\u0000-\u001f\u007f]/.test(path)
    ? JSON.stringify(path)
    : path
}

function getDiffStats(diff: string) {
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

function getDiffChangeKind(diff: string, fallback: GitChangeKind) {
  if (diff.includes("\nnew file mode ")) {
    return "create" as const
  }

  if (diff.includes("\ndeleted file mode ")) {
    return "delete" as const
  }

  return fallback
}

async function buildUntrackedDiff(root: string, path: string) {
  try {
    const normalizedRoot = resolve(root)
    const absolutePath = resolve(normalizedRoot, path)

    if (
      absolutePath !== normalizedRoot &&
      !absolutePath.startsWith(`${normalizedRoot}${sep}`)
    ) {
      return null
    }

    const stats = await lstat(/* turbopackIgnore: true */ absolutePath)

    if (!stats.isFile() || stats.isSymbolicLink()) {
      return { additions: 0, diff: null }
    }

    if (stats.size > MAX_UNTRACKED_DIFF_BYTES) {
      return { additions: 0, diff: null }
    }

    const buffer = await readFile(/* turbopackIgnore: true */ absolutePath)

    if (buffer.includes(0)) {
      return { additions: 0, diff: null }
    }

    const content = buffer.toString("utf8")

    const lines = content.split(/\r?\n/)
    const hasTrailingNewline = lines.at(-1) === ""

    if (hasTrailingNewline) {
      lines.pop()
    }

    const oldPath = quoteDiffPath(`a/${path}`)
    const newPath = quoteDiffPath(`b/${path}`)
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

async function readGitSummary(root: string) {
  const [branchResult, branchesResult, remotesResult, upstreamResult] =
    await Promise.allSettled([
      execGit(root, ["branch", "--show-current"]),
      execGit(root, ["branch", "--format=%(refname:short)"]),
      execGit(root, ["remote"]),
      execGit(root, [
        "rev-list",
        "--left-right",
        "--count",
        "@{upstream}...HEAD",
      ]),
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
      ? (remotesResult.value
          .split(/\r?\n/)
          .map((value) => value.trim())
          .find(Boolean) ?? null)
      : null
  let ahead: number | null = null
  let behind: number | null = null

  if (upstreamResult.status === "fulfilled") {
    const [rawBehind, rawAhead] = upstreamResult.value.trim().split(/\s+/, 2)
    const nextBehind = Number.parseInt(rawBehind, 10)
    const nextAhead = Number.parseInt(rawAhead, 10)

    behind = Number.isFinite(nextBehind) ? nextBehind : null
    ahead = Number.isFinite(nextAhead) ? nextAhead : null
  }

  return { branch, branches, remote, ahead, behind }
}

async function getPatchApplyContext(projectRoot: string) {
  let repositoryRoot: string

  try {
    repositoryRoot = resolve(
      (await execGit(projectRoot, ["rev-parse", "--show-toplevel"])).trim()
    )
  } catch {
    // `git apply` also supports ordinary non-repository directories. In that
    // case paths remain relative to the bound project itself.
    return { cwd: resolve(projectRoot), directory: null }
  }

  const normalizedProjectRoot = resolve(projectRoot)
  const projectPrefix = relative(repositoryRoot, normalizedProjectRoot)

  if (
    projectPrefix === ".." ||
    projectPrefix.startsWith(`..${sep}`) ||
    isAbsolute(projectPrefix)
  ) {
    throw new Error("Project path is outside its Git repository root.")
  }

  return {
    cwd: repositoryRoot,
    directory:
      projectPrefix.length > 0 ? projectPrefix.replaceAll("\\", "/") : null,
  }
}

async function readUncommittedChanges(root: string): Promise<{
  files: GitFileChange[]
  truncated: boolean
}> {
  const headAvailable = await execGit(root, ["rev-parse", "--verify", "HEAD"])
    .then(() => true)
    .catch(() => false)
  const statusOutput = await execGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ])
  const statusEntries = parseStatusEntries(statusOutput)

  const truncated = statusEntries.length > MAX_DIFF_FILES
  const visibleEntries = statusEntries.slice(0, MAX_DIFF_FILES)
  const fileCandidates = await Promise.all(
    visibleEntries.map(async (entry): Promise<GitFileChange | null> => {
      const fallbackKind = getChangeKind(entry.status)

      if (entry.status === "??" || !headAvailable) {
        const untracked = await buildUntrackedDiff(root, entry.path)

        if (!untracked) {
          return null
        }

        return {
          path: entry.path,
          kind: "create",
          additions: untracked.additions,
          deletions: 0,
          diff: untracked.diff,
        }
      }

      let diff: string | null = null

      try {
        diff = await execGit(root, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "HEAD",
          "--",
          `:(literal)${entry.path}`,
        ])
      } catch {
        diff = null
      }

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
  const files = fileCandidates.filter(
    (file): file is GitFileChange => file !== null
  )

  return { files, truncated }
}

async function readCommitIdentityArgs(root: string) {
  try {
    await execGit(root, ["config", "user.name"])
    await execGit(root, ["config", "user.email"])
    return []
  } catch {
    return [
      "-c",
      "user.name=AstraFlow Desktop",
      "-c",
      "user.email=astraflow@localhost",
    ]
  }
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const id = new URL(request.url).searchParams.get("id")?.trim()
  const project = id ? findProject(id) : null

  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Project was not found." },
      { status: 404 }
    )
  }

  try {
    const workspaceId = new URL(request.url).searchParams
      .get("workspaceId")
      ?.trim()
    let root = project.path

    if (workspaceId) {
      const workspace = getStudioWorkspace(workspaceId)

      if (!workspace) {
        return NextResponse.json(
          { ok: false, error: "Workspace was not found." },
          { status: 404 }
        )
      }

      root = await resolveStudioLocalGitWorkspaceRoot({ project, workspace })
    }

    // Not being a git repository is a supported state, not an error: report
    // it so the client can fall back to session-derived changes.
    if (!(await isExactStudioGitWorkspaceRoot(root))) {
      return NextResponse.json({
        ok: true,
        data: {
          files: [],
          truncated: false,
          gitAvailable: false,
          git: null,
        },
      })
    }

    const [data, git] = await Promise.all([
      readUncommittedChanges(root),
      readGitSummary(root),
    ])

    return NextResponse.json({
      ok: true,
      data: { ...data, gitAvailable: true, git },
    })
  } catch (error) {
    if (error instanceof StudioGitWorkspaceBindingError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status }
      )
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to read git diff.",
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = gitActionSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const project = findProject(parsed.data.id)

  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Project was not found." },
      { status: 404 }
    )
  }

  const { action } = parsed.data
  const root = project.path

  try {
    if (
      action !== "apply-patch" &&
      !(await isExactStudioGitWorkspaceRoot(root))
    ) {
      return NextResponse.json(
        { ok: false, error: "This project is not a Git working tree." },
        { status: 400 }
      )
    }

    if (action === "switch-branch" || action === "create-branch") {
      const branch = parsed.data.branch

      if (!(await isValidBranchName(root, branch))) {
        return NextResponse.json(
          { ok: false, error: `“${branch}” is not a valid Git branch name.` },
          { status: 400 }
        )
      }

      const branchExists = await localBranchExists(root, branch)

      if (action === "switch-branch" && !branchExists) {
        return NextResponse.json(
          { ok: false, error: `The branch “${branch}” does not exist.` },
          { status: 404 }
        )
      }

      if (action === "create-branch" && branchExists) {
        return NextResponse.json(
          { ok: false, error: `The branch “${branch}” already exists.` },
          { status: 409 }
        )
      }

      const currentBranch = (
        await execGit(root, ["branch", "--show-current"])
      ).trim()

      if (action === "switch-branch" && currentBranch === branch) {
        return NextResponse.json({
          ok: true,
          data: { action, branch, changed: false },
        })
      }

      if (action === "switch-branch") {
        const conflicts = await findBranchSwitchConflicts(root, branch)

        if (conflicts.length > 0) {
          const visibleConflicts = conflicts
            .slice(0, 3)
            .map(formatConflictPath)
            .join(", ")
          const overflow =
            conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ""

          return NextResponse.json(
            {
              ok: false,
              error: `Cannot switch to “${branch}” because local changes to ${visibleConflicts}${overflow} would be overwritten. Commit or move those changes first; the working tree was left unchanged.`,
            },
            { status: 409 }
          )
        }
      }

      try {
        await execGit(
          root,
          action === "create-branch"
            ? ["switch", "-c", branch]
            : ["switch", branch]
        )
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "Git refused the branch change."

        throw new Error(
          `Could not ${action === "create-branch" ? "create and switch to" : "switch to"} “${branch}”. Git left the working tree unchanged. ${reason}`
        )
      }

      return NextResponse.json({
        ok: true,
        data: { action, branch, changed: true },
      })
    }

    if (action === "apply-patch") {
      const paths = new Set<string>()

      for (const patch of parsed.data.patches) {
        const normalizedPath = normalizePatchPath(patch.path)

        if (paths.has(normalizedPath)) {
          return NextResponse.json(
            { ok: false, error: "Each patch must target a unique file." },
            { status: 400 }
          )
        }

        if (!isUnifiedDiffForPath(patch.diff, normalizedPath)) {
          return NextResponse.json(
            {
              ok: false,
              error: `The saved patch for ${patch.path} is incomplete or targets a different file.`,
            },
            { status: 400 }
          )
        }

        if (Buffer.byteLength(patch.diff, "utf8") > MAX_SINGLE_PATCH_BYTES) {
          return NextResponse.json(
            {
              ok: false,
              error: `The saved patch for ${patch.path} is too large to apply safely.`,
            },
            { status: 400 }
          )
        }

        paths.add(normalizedPath)
      }

      const patchBytes = parsed.data.patches.reduce(
        (total, patch) => total + Buffer.byteLength(patch.diff, "utf8"),
        0
      )

      if (patchBytes > MAX_PATCH_BYTES) {
        return NextResponse.json(
          { ok: false, error: "The saved patch is too large to apply safely." },
          { status: 400 }
        )
      }

      const batch = buildPatchBatch(parsed.data)
      const reverseArgs =
        parsed.data.direction === "reverse" ? ["--reverse"] : []
      const applyContext = await getPatchApplyContext(root)
      const directoryArgs = applyContext.directory
        ? [`--directory=${applyContext.directory}`]
        : []
      const applyArgs = [
        "apply",
        ...reverseArgs,
        ...directoryArgs,
        "--whitespace=nowarn",
      ]

      // Check the complete ordered batch before changing the worktree. Git
      // rejects stale context and unsafe paths here, so a conflict never
      // partially overwrites the user's current edits.
      await execGit(
        applyContext.cwd,
        [...applyArgs, "--check"],
        GIT_APPLY_TIMEOUT_MS,
        batch
      )
      await execGit(
        applyContext.cwd,
        applyArgs,
        GIT_APPLY_TIMEOUT_MS,
        batch
      )

      return NextResponse.json({
        ok: true,
        data: {
          action,
          direction: parsed.data.direction,
          files: parsed.data.patches.length,
        },
      })
    }

    const output: string[] = []

    if (action === "commit" || action === "commit-and-push") {
      const message = parsed.data.message?.trim()

      if (!message) {
        return NextResponse.json(
          { ok: false, error: "Commit message is required." },
          { status: 400 }
        )
      }

      const identityArgs = await readCommitIdentityArgs(root)

      await execGit(root, ["add", "-A"])
      output.push(
        await execGit(root, [...identityArgs, "commit", "-m", message])
      )
    }

    if (action === "push" || action === "commit-and-push") {
      output.push(await execGit(root, ["push"], GIT_PUSH_TIMEOUT_MS))
    }

    return NextResponse.json({
      ok: true,
      data: { action, output: output.join("\n").trim() },
    })
  } catch (error) {
    if (action === "apply-patch") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "These files have changed since the patch was recorded. Review the current changes and try again.",
        },
        { status: 409 }
      )
    }

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Git command failed.",
      },
      { status: 500 }
    )
  }
}
