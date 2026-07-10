import { lstat, open, realpath, stat } from "node:fs/promises"
import { basename, isAbsolute, resolve, sep } from "node:path"
import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  countStudioPermissionRules,
  createStudioLocalProject,
  deleteStudioPermissionRules,
  deleteStudioLocalProject,
  listStudioLocalProjects,
} from "@/lib/studio-db"
import type {
  StudioLocalProjectGitInfo,
  StudioLocalProjectWithGitInfo,
} from "@/lib/studio-types"
import { runSafeGit } from "./safe-git"

export const runtime = "nodejs"

const GIT_TIMEOUT_MS = 750
const GIT_DIFF_TIMEOUT_MS = 1_500
const MAX_UNTRACKED_STATS_FILES = 200
const MAX_UNTRACKED_STATS_FILE_BYTES = 2 * 1024 * 1024
const MAX_UNTRACKED_STATS_TOTAL_BYTES = 8 * 1024 * 1024

const createLocalProjectSchema = z.object({
  path: z.string().trim().min(1),
  name: z.string().trim().max(120).optional(),
})

const deleteLocalProjectSchema = z.object({
  id: z.string().trim().min(1),
  action: z.enum(["delete", "clearPermissionRules"]).default("delete"),
})

const execGit = (path: string, args: string[]) =>
  runSafeGit(path, args, {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  })

const execGitDiff = (path: string, args: string[]) =>
  runSafeGit(path, args, {
    timeout: GIT_DIFF_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  })

function parseGitStatusChangedFiles(output: string) {
  const records = output.split("\0")
  let changedFiles = 0

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]

    if (!record || record.length < 4) {
      continue
    }

    changedFiles += 1

    const status = record.slice(0, 2)

    if (status.includes("R") || status.includes("C")) {
      index += 1
    }
  }

  return changedFiles
}

function parseNumstat(output: string) {
  let additions = 0
  let deletions = 0

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }

    const [rawAdditions, rawDeletions] = line.split(/\s+/, 2)
    const nextAdditions = Number.parseInt(rawAdditions, 10)
    const nextDeletions = Number.parseInt(rawDeletions, 10)

    if (Number.isFinite(nextAdditions)) {
      additions += nextAdditions
    }

    if (Number.isFinite(nextDeletions)) {
      deletions += nextDeletions
    }
  }

  return { additions, deletions }
}

function parseNulSeparatedPaths(output: string) {
  return output.split("\0").filter(Boolean)
}

async function countTextFileLines(
  root: string,
  relativePath: string,
  maxBytes: number
) {
  const normalizedRoot = resolve(root)
  const absolutePath = resolve(normalizedRoot, relativePath)

  if (
    absolutePath !== normalizedRoot &&
    !absolutePath.startsWith(`${normalizedRoot}${sep}`)
  ) {
    return { additions: 0, bytesRead: 0 }
  }

  const stats = await lstat(absolutePath)

  if (!stats.isFile() || stats.isSymbolicLink()) {
    return { additions: 0, bytesRead: 0 }
  }

  if (stats.size > Math.min(maxBytes, MAX_UNTRACKED_STATS_FILE_BYTES)) {
    return { additions: 0, bytesRead: 0 }
  }

  const file = await open(absolutePath, "r")
  const buffer = Buffer.allocUnsafe(64 * 1024)
  const effectiveMaxBytes = Math.min(maxBytes, MAX_UNTRACKED_STATS_FILE_BYTES)
  let additions = 0
  let bytesReadTotal = 0
  let lastByte: number | null = null

  try {
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null)

      if (bytesRead === 0) {
        break
      }

      bytesReadTotal += bytesRead

      if (bytesReadTotal > effectiveMaxBytes) {
        return { additions: 0, bytesRead: effectiveMaxBytes }
      }

      for (let index = 0; index < bytesRead; index += 1) {
        const byte = buffer[index]

        // Match Git's binary numstat semantics instead of reporting a
        // misleading text line count for binary output files.
        if (byte === 0) {
          return { additions: 0, bytesRead: bytesReadTotal }
        }

        if (byte === 10) {
          additions += 1
        }

        lastByte = byte
      }
    }
  } finally {
    await file.close()
  }

  return {
    additions: additions + (lastByte !== null && lastByte !== 10 ? 1 : 0),
    bytesRead: bytesReadTotal,
  }
}

async function readUntrackedStats(root: string, output: string) {
  const paths = parseNulSeparatedPaths(output).slice(
    0,
    MAX_UNTRACKED_STATS_FILES
  )
  let additions = 0
  let remainingBytes = MAX_UNTRACKED_STATS_TOTAL_BYTES

  for (const path of paths) {
    if (remainingBytes <= 0) {
      break
    }

    try {
      const stats = await countTextFileLines(root, path, remainingBytes)
      additions += stats.additions
      remainingBytes -= stats.bytesRead
    } catch {
      // Ignore paths that disappear while Git metadata is being refreshed.
    }
  }

  return {
    additions,
    deletions: 0,
  }
}

async function readGitInfo(path: string): Promise<StudioLocalProjectGitInfo> {
  try {
    const insideWorkTree = (
      await execGit(path, ["rev-parse", "--is-inside-work-tree"])
    ).trim()

    if (insideWorkTree !== "true") {
      throw new Error("Not a Git working tree.")
    }

    const headAvailable = await execGit(path, ["rev-parse", "--verify", "HEAD"])
      .then(() => true)
      .catch(() => false)

    const [
      branchResult,
      statusResult,
      trackedNumstatResult,
      stagedNumstatResult,
      remoteResult,
      branchesResult,
      untrackedResult,
    ] = await Promise.allSettled([
      execGit(path, ["branch", "--show-current"]),
      execGit(path, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]),
      headAvailable
        ? execGitDiff(path, ["diff", "--numstat", "HEAD", "--"])
        : execGitDiff(path, ["diff", "--numstat", "--"]),
      headAvailable
        ? Promise.resolve("")
        : execGitDiff(path, ["diff", "--cached", "--numstat", "--"]),
      execGit(path, ["remote"]),
      execGit(path, ["branch", "--format=%(refname:short)"]),
      execGit(path, ["ls-files", "--others", "--exclude-standard", "-z"]),
    ])
    const statusOutput =
      statusResult.status === "fulfilled" ? statusResult.value : null
    const trackedDiffStats =
      trackedNumstatResult.status === "fulfilled"
        ? parseNumstat(trackedNumstatResult.value)
        : null
    const stagedDiffStats =
      stagedNumstatResult.status === "fulfilled"
        ? parseNumstat(stagedNumstatResult.value)
        : null
    const untrackedDiffStats =
      untrackedResult.status === "fulfilled"
        ? await readUntrackedStats(path, untrackedResult.value)
        : null
    const diffStats =
      trackedDiffStats || stagedDiffStats || untrackedDiffStats
        ? {
            additions:
              (trackedDiffStats?.additions ?? 0) +
              (stagedDiffStats?.additions ?? 0) +
              (untrackedDiffStats?.additions ?? 0),
            deletions:
              (trackedDiffStats?.deletions ?? 0) +
              (stagedDiffStats?.deletions ?? 0),
          }
        : null
    const remote =
      remoteResult.status === "fulfilled"
        ? (remoteResult.value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)[0] ?? null)
        : null
    let remoteUrl: string | null = null

    if (remote) {
      try {
        remoteUrl = (await execGit(path, ["remote", "get-url", remote])).trim()
      } catch {
        remoteUrl = null
      }
    }

    const branches =
      branchesResult.status === "fulfilled"
        ? branchesResult.value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        : null
    let ahead: number | null = null
    let behind: number | null = null

    try {
      const revListOutput = await execGit(path, [
        "rev-list",
        "--left-right",
        "--count",
        "@{upstream}...HEAD",
      ])
      const [rawBehind, rawAhead] = revListOutput.trim().split(/\s+/, 2)
      const nextBehind = Number.parseInt(rawBehind, 10)
      const nextAhead = Number.parseInt(rawAhead, 10)

      behind = Number.isFinite(nextBehind) ? nextBehind : null
      ahead = Number.isFinite(nextAhead) ? nextAhead : null
    } catch {
      ahead = null
      behind = null
    }

    return {
      gitAvailable: true,
      branch:
        branchResult.status === "fulfilled"
          ? branchResult.value.trim() || null
          : null,
      isDirty: statusOutput === null ? null : statusOutput.trim().length > 0,
      changedFiles:
        statusOutput === null ? null : parseGitStatusChangedFiles(statusOutput),
      additions: diffStats?.additions ?? null,
      deletions: diffStats?.deletions ?? null,
      remote,
      remoteUrl,
      branches,
      ahead,
      behind,
    }
  } catch {
    return {
      gitAvailable: false,
      branch: null,
      isDirty: null,
      changedFiles: null,
      additions: null,
      deletions: null,
      remote: null,
      remoteUrl: null,
      branches: null,
      ahead: null,
      behind: null,
    }
  }
}

async function withGitInfo(
  project: ReturnType<typeof listStudioLocalProjects>[number]
): Promise<StudioLocalProjectWithGitInfo> {
  return {
    ...project,
    git: await readGitInfo(project.path),
    permissionRuleCount: countStudioPermissionRules(project.id),
  }
}

export async function GET() {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  const projects = await Promise.all(listStudioLocalProjects().map(withGitInfo))

  return NextResponse.json({ ok: true, data: projects })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = createLocalProjectSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const requestedPath = parsed.data.path

  if (!isAbsolute(requestedPath)) {
    return NextResponse.json(
      { ok: false, error: "Project path must be absolute." },
      { status: 400 }
    )
  }

  let normalizedPath: string

  try {
    const stats = await stat(/* turbopackIgnore: true */ requestedPath)

    if (!stats.isDirectory()) {
      return NextResponse.json(
        { ok: false, error: "Project path must be a directory." },
        { status: 400 }
      )
    }

    normalizedPath = await realpath(/* turbopackIgnore: true */ requestedPath)
  } catch {
    return NextResponse.json(
      { ok: false, error: "Project directory was not found." },
      { status: 400 }
    )
  }

  const name = parsed.data.name || basename(normalizedPath) || normalizedPath
  const project = createStudioLocalProject({ name, path: normalizedPath })

  return NextResponse.json(
    { ok: true, data: await withGitInfo(project) },
    { status: 201 }
  )
}

export async function DELETE(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = deleteLocalProjectSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (parsed.data.action === "clearPermissionRules") {
    const deleted = deleteStudioPermissionRules(parsed.data.id)

    return NextResponse.json({
      ok: true,
      data: { id: parsed.data.id, deleted },
    })
  }

  deleteStudioLocalProject(parsed.data.id)

  return NextResponse.json({ ok: true, data: { id: parsed.data.id } })
}
