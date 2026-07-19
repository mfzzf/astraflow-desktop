import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"
import { after, test } from "node:test"

register("./helpers/typescript-alias-loader.mjs", import.meta.url)

const testDirectory = mkdtempSync(join(tmpdir(), "astraflow-sync-"))
process.env.ASTRAFLOW_SQLITE_PATH = join(testDirectory, "studio.sqlite")

const studioDb = await import("../lib/studio-db.ts")

after(() => {
  studioDb.getStudioDatabase().close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test("writes session and message mutations in the local outbox", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Synced session",
  })
  studioDb.createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: "hello",
    parts: [
      {
        type: "artifact",
        name: "result.txt",
        storagePath: "/private/result.txt",
      },
    ],
  })
  studioDb.updateStudioSessionTitle(session.id, "Renamed")

  const items = studioDb.claimStudioSyncOutbox(10)
  assert.deepEqual(
    items.map((item) => [item.entityType, item.operation]),
    [
      ["session", "create"],
      ["message", "create"],
      ["session", "update"],
    ]
  )
  const message = items.find((item) => item.entityType === "message")
  assert.equal(message.payload.content.text, "hello")
  assert.equal(message.payload.parts[0].name, "result.txt")
  assert.equal("storagePath" in message.payload.parts[0], false)
})

test("deduplicates inbox cursors and device commands", () => {
  const database = studioDb.getStudioDatabase()
  assert.equal(
    studioDb.recordStudioSyncEvent(database, {
      eventId: "event-1",
      cursor: 4,
    }),
    true
  )
  assert.equal(
    studioDb.recordStudioSyncEvent(database, {
      eventId: "event-1",
      cursor: 4,
    }),
    false
  )
  assert.equal(studioDb.getStudioSyncCursor(), 4)
  studioDb.setStudioSyncCursor(database, 40)
  assert.equal(studioDb.getStudioSyncCursor(), 40)
  assert.throws(() => studioDb.setStudioSyncCursor(database, -1))

  assert.equal(studioDb.hasProcessedDeviceCommand("command-1"), false)
  studioDb.recordDeviceCommandResult("command-1", "completed", { ok: true })
  assert.equal(studioDb.hasProcessedDeviceCommand("command-1"), true)
})

test("persists Desktop run events for retry after a network interruption", () => {
  const database = studioDb.getStudioDatabase()
  studioDb.enqueueStudioSyncMutation(database, {
    id: "run-event-1",
    entityType: "agent_run_event",
    entityId: "run-1",
    operation: "append",
    payload: {
      runId: "run-1",
      runStatus: "completed",
      event: {
        eventId: "run-event-1",
        seq: "1",
        type: "agent.run.snapshot",
        payload: { status: "completed" },
        producerType: "desktop",
        producerId: "desktop-1",
      },
    },
  })
  const [item] = studioDb.claimStudioSyncOutbox(1)
  assert.equal(item.entityType, "agent_run_event")
  assert.equal(item.payload.runStatus, "completed")
  studioDb.acknowledgeStudioSyncOutbox(item.id, item.entityType, item.entityId)
})
