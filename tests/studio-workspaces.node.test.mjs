import { after, test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"

import Database from "better-sqlite3"

register("./helpers/typescript-alias-loader.mjs", import.meta.url)

const testDirectory = mkdtempSync(join(tmpdir(), "astraflow-workspaces-"))
const databasePath = join(testDirectory, "studio.sqlite")
const legacyDb = new Database(databasePath)

legacyDb.exec(`
  CREATE TABLE studio_local_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT
  );

  CREATE TABLE studio_sessions (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    title TEXT NOT NULL,
    project_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE studio_session_sandboxes (
    session_id TEXT PRIMARY KEY,
    sandbox_id TEXT NOT NULL
  );
`)
legacyDb
  .prepare(
    `
      INSERT INTO studio_local_projects
        (id, name, path, created_at, updated_at, last_opened_at)
      VALUES (?, ?, ?, ?, ?, NULL)
    `
  )
  .run(
    "legacy-project",
    "Legacy local",
    "/tmp/legacy-local",
    "2026-07-13T00:00:00.000Z",
    "2026-07-13T00:00:00.000Z"
  )
legacyDb
  .prepare(
    `
      INSERT INTO studio_sessions
        (id, mode, title, project_id, created_at, updated_at)
      VALUES (?, 'chat', ?, ?, ?, ?)
    `
  )
  .run(
    "legacy-session",
    "Legacy local task",
    "legacy-project",
    "2026-07-13T00:00:00.000Z",
    "2026-07-13T00:00:00.000Z"
  )
legacyDb
  .prepare(
    `
      INSERT INTO studio_session_sandboxes (session_id, sandbox_id)
      VALUES (?, ?)
    `
  )
  .run("legacy-session", "polluted-sandbox")
legacyDb.close()

process.env.ASTRAFLOW_SQLITE_PATH = databasePath

const studioDb = await import("../lib/studio-db.ts")
const remoteWorkspace = await import("../lib/studio-remote-workspace.ts")
const workspaceContext = await import("../lib/studio-workspace-context.ts")

after(() => {
  studioDb.getStudioDatabase().close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test("migrates local projects and keeps polluted local sessions local", async () => {
  const workspace = studioDb.getStudioWorkspaceForLocalProject("legacy-project")
  const session = studioDb.getStudioSession("legacy-session")

  assert.deepEqual(
    workspace && {
      type: workspace.type,
      localProjectId:
        workspace.type === "local" ? workspace.localProjectId : null,
      rootPath: workspace.rootPath,
    },
    {
      type: "local",
      localProjectId: "legacy-project",
      rootPath: "/tmp/legacy-local",
    }
  )
  assert.equal(session?.workspaceId, workspace?.id)
  assert.equal(
    remoteWorkspace.getStudioRemoteWorkspaceSummary("legacy-session"),
    null
  )
  await assert.rejects(
    remoteWorkspace.ensureStudioRemoteWorkspace("legacy-session"),
    (error) => {
      assert.ok(
        error instanceof remoteWorkspace.StudioWorkspaceTypeMismatchError
      )
      assert.equal(
        remoteWorkspace.getStudioRemoteWorkspaceErrorStatus(error),
        409
      )
      return true
    }
  )
})

test("keeps general chat sessions valid without a workspace binding", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "General chat",
    workspaceId: null,
  })

  assert.equal(session.workspaceId, null)
  assert.equal(session.projectId, null)
  assert.equal(
    workspaceContext.getStudioSessionWorkspaceExecutionContext(session.id),
    null
  )
  assert.deepEqual(
    workspaceContext.getStudioSessionWorkspaceExecutionTarget(session.id),
    {
      context: null,
      environment: "local",
      workspaceId: null,
      workspaceRoot: null,
    }
  )
})

test("derives sandbox summary only from an explicit sandbox workspace", async () => {
  studioDb.saveStudioModelverseApiKey({
    id: "test-key",
    name: "Test key",
    key: "test-secret",
    projectId: "test-project",
  })
  studioDb.saveStudioOAuthTokens({
    accessToken: "test-token",
    refreshToken: null,
    tokenType: "Bearer",
    expiresAt: null,
    email: "test@example.com",
  })
  studioDb.upsertCodeBoxSandboxRecord({
    sandboxId: "sandbox-explicit",
    name: "Existing sandbox",
    ownerKey: "test@example.com:test-project",
    ownerEmail: "test@example.com",
    companyId: "test@example.com",
    projectId: "test-project",
    template: "template-test",
    status: "paused",
    codeServerPort: 8080,
    workspacePath: "/workspace",
  })
  const workspace = studioDb.createStudioSandboxWorkspace({
    name: "Project A",
    rootPath: "/workspace/project-a",
    sandboxId: "sandbox-explicit",
  })
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Sandbox task",
    workspaceId: workspace.id,
  })
  const localWorkspace =
    studioDb.getStudioWorkspaceForLocalProject("legacy-project")

  assert.ok(localWorkspace)
  assert.throws(
    () =>
      studioDb.createStudioSession({
        mode: "chat",
        workspaceId: workspace.id,
        projectId: "legacy-project",
      }),
    /sandbox workspace cannot bind a local project/i
  )
  const reboundSession = studioDb.createStudioSession({
    mode: "chat",
    workspaceId: localWorkspace.id,
  })
  assert.equal(reboundSession.projectId, "legacy-project")
  assert.deepEqual(
    studioDb.updateStudioSessionWorkspace(reboundSession.id, workspace.id) && {
      workspaceId: studioDb.getStudioSession(reboundSession.id)?.workspaceId,
      projectId: studioDb.getStudioSession(reboundSession.id)?.projectId,
    },
    { workspaceId: workspace.id, projectId: null }
  )

  assert.deepEqual(
    remoteWorkspace.getStudioRemoteWorkspaceSummary(session.id),
    {
      workspaceId: workspace.id,
      sandboxId: "sandbox-explicit",
      status: "paused",
      template: "template-test",
      workspacePath: "/workspace/project-a",
    }
  )
  assert.deepEqual(
    await remoteWorkspace.ensureStudioRemoteWorkspace(session.id),
    {
      sessionId: session.id,
      workspaceId: workspace.id,
      sandboxId: "sandbox-explicit",
      gatewayPath: "/workspace",
      workspacePath: "/workspace/project-a",
    }
  )
  assert.equal(
    remoteWorkspace.toStudioRemoteRelativePath(
      "/workspace/project-a/src",
      "/workspace/project-a",
      "/workspace"
    ),
    "project-a/src"
  )
  assert.throws(() =>
    remoteWorkspace.toStudioRemoteRelativePath(
      "/workspace/project-b",
      "/workspace/project-a",
      "/workspace"
    )
  )
})

test("deleting a sandbox workspace never deletes its CodeBox record", () => {
  const workspace = studioDb.createStudioSandboxWorkspace({
    name: "Disposable binding",
    rootPath: "/workspace/disposable",
    sandboxId: "sandbox-explicit",
  })

  assert.equal(studioDb.deleteStudioWorkspace(workspace.id), true)
  assert.equal(studioDb.getStudioWorkspace(workspace.id), null)
  assert.equal(
    studioDb.getCodeBoxSandboxRecord("sandbox-explicit")?.sandboxId,
    "sandbox-explicit"
  )
})
