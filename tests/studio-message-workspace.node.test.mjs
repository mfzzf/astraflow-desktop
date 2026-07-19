import assert from "node:assert/strict"
import Database from "better-sqlite3"
import { mkdtempSync, rmSync } from "node:fs"
import { register } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

register("./helpers/typescript-alias-loader.mjs", import.meta.url)

const testDirectory = mkdtempSync(join(tmpdir(), "astraflow-message-workspace-"))
process.env.ASTRAFLOW_SQLITE_PATH = join(testDirectory, "studio.sqlite")

const legacyDatabase = new Database(process.env.ASTRAFLOW_SQLITE_PATH)
legacyDatabase.exec(`
  CREATE TABLE studio_workspaces (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    local_project_id TEXT,
    sandbox_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT
  );
  CREATE TABLE studio_sessions (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    title TEXT NOT NULL,
    workspace_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE studio_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    environment TEXT,
    created_at TEXT NOT NULL
  );
`)
legacyDatabase
  .prepare(
    `INSERT INTO studio_workspaces
      (id, type, name, root_path, local_project_id, sandbox_id, created_at, updated_at)
     VALUES (?, 'sandbox', ?, ?, NULL, ?, ?, ?)`
  )
  .run(
    "legacy-workspace",
    "Legacy workspace",
    "/workspace/legacy",
    "legacy-sandbox",
    new Date().toISOString(),
    new Date().toISOString()
  )
legacyDatabase
  .prepare(
    `INSERT INTO studio_sessions
      (id, mode, title, workspace_id, created_at, updated_at)
     VALUES (?, 'chat', ?, ?, ?, ?)`
  )
  .run(
    "legacy-session",
    "Legacy session",
    "legacy-workspace",
    new Date().toISOString(),
    new Date().toISOString()
  )
legacyDatabase
  .prepare(
    `INSERT INTO studio_messages
      (id, session_id, role, content, environment, created_at)
     VALUES (?, ?, 'assistant', ?, 'remote', ?)`
  )
  .run(
    "legacy-message",
    "legacy-session",
    "Generated legacy-report.pdf",
    new Date().toISOString()
  )
legacyDatabase.close()

const studioDb = await import("../lib/studio-db.ts")

after(() => {
  studioDb.getStudioDatabase().close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test("persists the exact execution workspace with every message", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Workspace snapshot",
  })
  const workspace = {
    id: "sandbox-workspace-1",
    type: "sandbox",
    rootPath: "/workspace/project-a",
  }
  const message = studioDb.createStudioMessage({
    sessionId: session.id,
    role: "assistant",
    content: "Generated report.pptx",
    environment: "remote",
    workspace,
  })

  assert.deepEqual(message.workspace, workspace)
  assert.deepEqual(studioDb.getStudioMessage(message.id)?.workspace, workspace)
  assert.deepEqual(studioDb.listStudioMessages(session.id)[0]?.workspace, workspace)
})

test("does not guess an execution workspace for messages created before snapshots", () => {
  assert.equal(studioDb.getStudioMessage("legacy-message")?.workspace, null)
})

test("preserves an explicit null workspace instead of using the session binding", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Explicitly unbound",
    workspaceId: "legacy-workspace",
  })
  const message = studioDb.createStudioMessage({
    sessionId: session.id,
    role: "assistant",
    content: "No addressable file workspace",
    environment: "remote",
    workspace: null,
  })

  assert.equal(message.workspace, null)
})
