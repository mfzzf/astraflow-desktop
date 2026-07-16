import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

const testDirectory = mkdtempSync(join(tmpdir(), "astraflow-compaction-"))

process.env.ASTRAFLOW_SQLITE_PATH = join(testDirectory, "studio.sqlite")

const studioDb = await import("../lib/studio-db.ts")

after(() => {
  rmSync(testDirectory, { recursive: true, force: true })
})

test("persists, replaces, and clears a Studio Pi compaction checkpoint", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Compaction",
    workspaceId: null,
    chatRuntimeId: "astraflow",
  })

  const first = studioDb.upsertStudioSessionCompaction({
    sessionId: session.id,
    runtimeId: "astraflow",
    summary: "First summary",
    firstKeptMessageId: "message-2",
    throughMessageId: "message-4",
    tokensBefore: 12_000,
    estimatedTokensAfter: 2_000,
  })

  assert.equal(first?.summary, "First summary")
  assert.equal(first?.firstKeptMessageId, "message-2")

  const replacement = studioDb.upsertStudioSessionCompaction({
    sessionId: session.id,
    runtimeId: "astraflow",
    summary: "Replacement summary",
    firstKeptMessageId: "message-4",
    throughMessageId: "message-8",
    tokensBefore: 24_000,
    estimatedTokensAfter: 3_000,
  })

  assert.equal(replacement?.summary, "Replacement summary")
  assert.equal(replacement?.createdAt, first?.createdAt)
  assert.equal(
    studioDb.getStudioSessionCompaction(session.id)?.throughMessageId,
    "message-8"
  )
  assert.equal(studioDb.clearStudioSessionCompaction(session.id), true)
  assert.equal(studioDb.getStudioSessionCompaction(session.id), null)
})
