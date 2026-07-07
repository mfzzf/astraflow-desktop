import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { listStudioLocalProjects } from "@/lib/studio-db"
import { runSafeGit } from "../safe-git"

export const runtime = "nodejs"

const GIT_TIMEOUT_MS = 2_000
const GIT_PUSH_TIMEOUT_MS = 30_000
const MAX_DIFF_FILES = 50
const MAX_UNTRACKED_DIFF_BYTES = 200 * 1024

const execGit = (path: string, args: string[], timeout = GIT_TIMEOUT_MS) =>
  runSafeGit(path, args, {
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  })

const gitActionSchema = z.object({
  id: z.string().trim().min(1),
  action: z.enum(["commit", "push", "commit-and-push"]),
  message: z.string().trim().max(2000).optional(),
})

type GitChangeKind = "create" | "edit" | "delete"

type GitFileChange = {
  path: string
  kind: GitChangeKind
  additions: number
  deletions: number
  diff: string | null
}

function findProject(id: string) {
  return listStudioLocalProjects().find((project) => project.id === id) ?? null
}

function parseStatusEntries(output: string) {
  const entries: { status: string; path: string }[] = []

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }

    const status = line.slice(0, 2)
    let path = line.slice(3).trim()

    // Renames come through as "old -> new"; show the new path.
    const renameIndex = path.indexOf(" -> ")

    if (renameIndex !== -1) {
      path = path.slice(renameIndex + 4)
    }

    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1)
    }

    entries.push({ status, path })
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

async function buildUntrackedDiff(root: string, path: string) {
  try {
    const content = await readFile(
      /* turbopackIgnore: true */ join(root, path),
      "utf8"
    )

    if (Buffer.byteLength(content, "utf8") > MAX_UNTRACKED_DIFF_BYTES) {
      return { additions: content.split(/\r?\n/).length, diff: null }
    }

    const lines = content.split(/\r?\n/)

    if (lines.at(-1) === "") {
      lines.pop()
    }

    if (lines.length === 0) {
      return { additions: 0, diff: null }
    }

    const diff = [
      `--- /dev/null`,
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join("\n")

    return { additions: lines.length, diff }
  } catch {
    return { additions: 0, diff: null }
  }
}

async function readUncommittedChanges(root: string): Promise<{
  files: GitFileChange[]
  truncated: boolean
}> {
  await execGit(root, ["rev-parse", "--is-inside-work-tree"])

  const [statusOutput, numstatOutput] = await Promise.all([
    execGit(root, ["status", "--porcelain"]),
    execGit(root, ["diff", "--numstat", "HEAD", "--"]),
  ])
  const statusEntries = parseStatusEntries(statusOutput)
  const numstatByPath = new Map<
    string,
    { additions: number; deletions: number }
  >()

  for (const line of numstatOutput.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }

    const [rawAdditions, rawDeletions, ...pathParts] = line.split(/\s+/)
    const path = pathParts.join(" ")

    if (!path) {
      continue
    }

    numstatByPath.set(path, {
      additions: Number.parseInt(rawAdditions, 10) || 0,
      deletions: Number.parseInt(rawDeletions, 10) || 0,
    })
  }

  const truncated = statusEntries.length > MAX_DIFF_FILES
  const visibleEntries = statusEntries.slice(0, MAX_DIFF_FILES)
  const files = await Promise.all(
    visibleEntries.map(async (entry): Promise<GitFileChange> => {
      const kind = getChangeKind(entry.status)

      if (entry.status === "??") {
        const untracked = await buildUntrackedDiff(root, entry.path)

        return {
          path: entry.path,
          kind,
          additions: untracked.additions,
          deletions: 0,
          diff: untracked.diff,
        }
      }

      const stats = numstatByPath.get(entry.path) ?? {
        additions: 0,
        deletions: 0,
      }
      let diff: string | null = null

      try {
        diff = await execGit(root, ["diff", "HEAD", "--", entry.path])
      } catch {
        diff = null
      }

      return {
        path: entry.path,
        kind,
        additions: stats.additions,
        deletions: stats.deletions,
        diff: diff?.trim() ? diff : null,
      }
    })
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
    const data = await readUncommittedChanges(project.path)

    return NextResponse.json({ ok: true, data })
  } catch (error) {
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
    await execGit(root, ["rev-parse", "--is-inside-work-tree"])

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
      output.push(
        await execGit(root, ["push"], GIT_PUSH_TIMEOUT_MS)
      )
    }

    return NextResponse.json({
      ok: true,
      data: { action, output: output.join("\n").trim() },
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Git command failed.",
      },
      { status: 500 }
    )
  }
}
