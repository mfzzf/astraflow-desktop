import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"
import { after, test } from "node:test"

register("./helpers/typescript-alias-loader.mjs", import.meta.url)

const testDirectory = mkdtempSync(
  join(tmpdir(), "astraflow-workspace-history-db-")
)
process.env.ASTRAFLOW_SQLITE_PATH = join(testDirectory, "studio.sqlite")

const studioDb = await import("../lib/studio-db.ts")

after(() => {
  studioDb.getStudioDatabase().close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test("workspace history hides and restores the matching conversation turns", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Workspace history",
  })
  const firstUser = studioDb.createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: "first",
  })
  const firstAssistant = studioDb.createStudioMessage({
    sessionId: session.id,
    role: "assistant",
    content: "first answer",
  })
  const secondUser = studioDb.createStudioMessage({
    sessionId: session.id,
    role: "user",
    content: "second",
  })
  const secondAssistant = studioDb.createStudioMessage({
    sessionId: session.id,
    role: "assistant",
    content: "second answer",
  })

  studioDb.recordStudioWorkspaceHistoryTurn({
    sessionId: session.id,
    userMessageId: firstUser.id,
    assistantMessageId: firstAssistant.id,
    projectPath: "/tmp/project",
    beforeRef: "before-1",
    afterRef: "after-1",
  })
  studioDb.recordStudioWorkspaceHistoryTurn({
    sessionId: session.id,
    userMessageId: secondUser.id,
    assistantMessageId: secondAssistant.id,
    projectPath: "/tmp/project",
    beforeRef: "before-2",
    afterRef: "after-2",
  })

  assert.deepEqual(
    studioDb
      .listStudioMessages(session.id)
      .filter((message) => message.role === "assistant")
      .map((message) => message.rewindAvailable),
    [true, true]
  )

  studioDb.markStudioWorkspaceHistoryUndone(session.id, [secondAssistant.id])
  assert.deepEqual(
    studioDb.listStudioMessages(session.id).map((message) => message.content),
    ["first", "first answer"]
  )

  studioDb.markStudioWorkspaceHistoryRedone(session.id, secondAssistant.id)
  assert.deepEqual(
    studioDb.listStudioMessages(session.id).map((message) => message.content),
    ["first", "first answer", "second", "second answer"]
  )
})

test("provider resume ids are invalidated without hiding later ids", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Provider reset",
  })

  studioDb.recordStudioAgentProviderEvent({
    sessionId: session.id,
    runtimeId: "astraflow",
    provider: "acp",
    direction: "output",
    eventType: "session",
    providerSessionId: "before-reset",
    payload: {},
  })
  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(session.id, "astraflow"),
    "before-reset"
  )

  studioDb.resetStudioSessionProviderResume(session.id)
  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(session.id, "astraflow"),
    null
  )

  studioDb.recordStudioAgentProviderEvent({
    sessionId: session.id,
    runtimeId: "astraflow",
    provider: "acp",
    direction: "output",
    eventType: "session",
    providerSessionId: "after-reset",
    payload: {},
  })
  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(session.id, "astraflow"),
    "after-reset"
  )
})
