import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"
import { after, test } from "node:test"

register("./helpers/server-route-loader.mjs", import.meta.url)

const testRoot = mkdtempSync(join(tmpdir(), "astraflow-run-selection-"))
const previousSqlitePath = process.env.ASTRAFLOW_SQLITE_PATH

process.env.ASTRAFLOW_SQLITE_PATH = join(testRoot, "studio.sqlite")

const studioDb = await import("../lib/studio-db.ts")
const runOrchestrator =
  await import("../lib/agent/run-orchestrator.ts")

function runtime(id) {
  return {
    info: {
      id,
      label: id,
      description: id,
      capabilities: {
        hitl: false,
        resume: false,
        subagents: false,
        plan: false,
        sandbox: false,
        mcp: false,
        skills: false,
        compact: false,
      },
    },
    async *startRun() {
      yield { type: "done" }
    },
  }
}

after(() => {
  studioDb.getStudioDatabase().close()

  if (previousSqlitePath === undefined) {
    delete process.env.ASTRAFLOW_SQLITE_PATH
  } else {
    process.env.ASTRAFLOW_SQLITE_PATH = previousSqlitePath
  }

  rmSync(testRoot, { recursive: true, force: true })
})

test("startAgentRun rejects stale execution snapshots before queueing", () => {
  const workspace = studioDb.createStudioSandboxWorkspace({
    name: "Current workspace",
    rootPath: "/workspace/current",
    sandboxId: "run-selection-sandbox",
  })
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Stale run selection",
    workspaceId: workspace.id,
    permissionMode: "full_access",
    chatRuntimeId: "astraflow",
  })
  let createMessagesCalls = 0

  for (const stale of [
    {
      workspaceId: "workspace-stale",
      permissionMode: "full_access",
      runtime: runtime("astraflow"),
    },
    {
      workspaceId: workspace.id,
      permissionMode: "default",
      runtime: runtime("astraflow"),
    },
    {
      workspaceId: workspace.id,
      permissionMode: "full_access",
      runtime: runtime("codex"),
    },
  ]) {
    assert.throws(
      () =>
        runOrchestrator.startAgentRun({
          createMessages() {
            createMessagesCalls += 1
            return []
          },
          model: "gpt-5.6-sol",
          permissionMode: stale.permissionMode,
          runtime: stale.runtime,
          sessionId: session.id,
          workspaceId: stale.workspaceId,
          workspaceRoot: workspace.rootPath,
        }),
      /Session workspace, runtime, or permissions changed/
    )
    assert.equal(runOrchestrator.getAgentRun(session.id), null)
  }

  assert.equal(createMessagesCalls, 0)
})
