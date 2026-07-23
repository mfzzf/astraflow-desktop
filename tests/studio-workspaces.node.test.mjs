import { after, test } from "node:test"
import assert from "node:assert/strict"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
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
    workspace_id TEXT,
    project_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (workspace_id)
      REFERENCES studio_workspaces(id)
      ON DELETE SET NULL
  );

  CREATE TABLE studio_workspaces (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK (type IN ('local', 'sandbox')),
    name TEXT NOT NULL,
    root_path TEXT NOT NULL,
    local_project_id TEXT,
    sandbox_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT,
    CHECK (
      (type = 'local' AND local_project_id IS NOT NULL AND sandbox_id IS NULL)
      OR
      (type = 'sandbox' AND sandbox_id IS NOT NULL AND local_project_id IS NULL)
    )
  );

  CREATE TABLE studio_session_sandboxes (
    session_id TEXT PRIMARY KEY,
    sandbox_id TEXT NOT NULL
  );
`)
legacyDb
  .prepare(
    `
      INSERT INTO studio_workspaces
        (id, type, name, root_path, local_project_id, sandbox_id,
         created_at, updated_at, last_opened_at)
      VALUES (?, 'local', ?, ?, ?, NULL, ?, ?, NULL)
    `
  )
  .run(
    "legacy-workspace",
    "Legacy local",
    "/tmp/legacy-local",
    "legacy-project",
    "2026-07-13T00:00:00.000Z",
    "2026-07-13T00:00:00.000Z"
  )
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
process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH = join(
  testDirectory,
  "managed-workspaces"
)
process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH = join(
  testDirectory,
  "acp-attachments"
)

const studioDb = await import("../lib/studio-db.ts")
const acpAttachments = await import("../lib/agent/acp/attachments.ts")
const managedWorkspace = await import("../lib/studio-managed-workspace.ts")
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
      origin: workspace.origin,
      localProjectId:
        workspace.type === "local" ? workspace.localProjectId : null,
      rootPath: workspace.rootPath,
    },
    {
      type: "local",
      origin: "selected_local",
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

test("allocates one idempotent managed workspace on the first Agent run", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Managed task",
    workspaceId: null,
  })

  const first = managedWorkspace.ensureStudioManagedWorkspace(session.id)
  const second = managedWorkspace.ensureStudioManagedWorkspace(session.id)

  assert.equal(first.id, second.id)
  assert.equal(first.origin, "managed_local")
  assert.equal(first.createdBySessionId, session.id)
  assert.equal(first.localProjectId, null)
  assert.equal(
    first.rootPath.startsWith(
      `${realpathSync(process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH)}/`
    ),
    true
  )
  assert.match(
    basename(first.rootPath),
    /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[a-f0-9]{8}$/
  )
  assert.equal(basename(first.rootPath).includes(session.id), false)
  assert.equal(existsSync(first.rootPath), true)
  assert.equal(studioDb.getStudioSession(session.id)?.workspaceId, first.id)
})

test("fails closed when a bound managed or legacy root becomes unsafe", () => {
  const managedSession = studioDb.createStudioSession({
    mode: "chat",
    title: "Missing managed root",
  })
  const managed =
    managedWorkspace.ensureStudioManagedWorkspace(managedSession.id)
  const legacyRoot = join(testDirectory, "missing-legacy-root")

  mkdirSync(legacyRoot, { recursive: true })
  const legacy = studioDb.createStudioLegacyWorkspace({
    name: "Missing legacy root",
    rootPath: realpathSync(legacyRoot),
    allocationKey: `missing-legacy:${managedSession.id}`,
  })
  const legacySession = studioDb.createStudioSession({
    mode: "chat",
    title: "Missing legacy root",
    workspaceId: legacy.id,
  })

  for (const [sessionId, rootPath] of [
    [managedSession.id, managed.rootPath],
    [legacySession.id, legacy.rootPath],
  ]) {
    rmSync(rootPath, { recursive: true })

    assert.throws(
      () =>
        workspaceContext.getStudioSessionWorkspaceExecutionTarget(sessionId),
      /workspace is unavailable/i
    )
    assert.equal(existsSync(rootPath), false)
  }

  writeFileSync(managed.rootPath, "not a directory")
  assert.throws(
    () =>
      workspaceContext.getStudioSessionWorkspaceExecutionTarget(
        managedSession.id
      ),
    /workspace is not a directory/i
  )
  rmSync(managed.rootPath)

  if (process.platform !== "win32") {
    const symlinkTarget = join(testDirectory, "managed-symlink-target")

    mkdirSync(symlinkTarget, { recursive: true })
    symlinkSync(symlinkTarget, managed.rootPath, "dir")
    assert.throws(
      () =>
        workspaceContext.getStudioSessionWorkspaceExecutionTarget(
          managedSession.id
        ),
      /workspace cannot be a symbolic link/i
    )
    unlinkSync(managed.rootPath)
  }
})

test("reconciles an orphaned managed directory after an allocation crash", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Interrupted managed allocation",
    workspaceId: null,
  })
  const allocated = managedWorkspace.ensureStudioManagedWorkspace(session.id)
  const database = studioDb.getStudioDatabase()

  database.transaction(() => {
    database
      .prepare(
        `
          UPDATE studio_sessions
          SET workspace_id = NULL
          WHERE id = ?
        `
      )
      .run(session.id)
    database
      .prepare("DELETE FROM studio_workspaces WHERE id = ?")
      .run(allocated.id)
  })()

  assert.equal(existsSync(allocated.rootPath), true)
  assert.equal(studioDb.getStudioSession(session.id)?.workspaceId, null)
  assert.equal(managedWorkspace.reconcileStudioManagedWorkspaceAllocations(), 1)

  const rebound = studioDb.getStudioSessionWorkspace(session.id)

  assert.ok(rebound)
  assert.equal(rebound.origin, "managed_local")
  assert.equal(rebound.createdBySessionId, session.id)
  assert.equal(rebound.rootPath, allocated.rootPath)
  assert.equal(
    readdirSync(process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH).some((entry) =>
      entry.startsWith(".allocating-")
    ),
    false
  )
})

test("adopts a safe legacy Agent cwd without moving or deleting it", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Legacy Agent task",
  })
  const studioFilesRoot = join(
    testDirectory,
    "legacy-user-data",
    "studio-files"
  )
  const legacyRoot = join(
    testDirectory,
    "legacy-user-data",
    "acp-workspaces",
    session.id
  )

  process.env.ASTRAFLOW_STUDIO_FILES_PATH = studioFilesRoot
  mkdirSync(legacyRoot, { recursive: true })
  writeFileSync(join(legacyRoot, "legacy.txt"), "legacy")
  studioDb.recordStudioAgentProviderEvent({
    sessionId: session.id,
    runtimeId: "astraflow",
    provider: "pi",
    direction: "internal",
    eventType: studioDb.STUDIO_ACP_SESSION_SELECTED_EVENT,
    providerSessionId: "provider-session",
    payload: {
      cwd: legacyRoot,
      sourceStudioSessionId: session.id,
      stateOwnerStudioSessionId: session.id,
    },
  })

  const workspace = managedWorkspace.ensureStudioManagedWorkspace(session.id)

  assert.equal(workspace.origin, "legacy_local")
  assert.equal(workspace.rootPath, realpathSync(legacyRoot))
  assert.equal(
    readFileSync(join(workspace.rootPath, "legacy.txt"), "utf8"),
    "legacy"
  )
  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(
      session.id,
      "astraflow"
    ),
    "provider-session"
  )
  assert.equal(studioDb.getStudioSession(session.id)?.permissionMode, "default")
})

test("never adopts an arbitrary historical cwd and clears its continuation", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Arbitrary historical cwd",
  })
  const arbitraryRoot = join(testDirectory, "user-project")

  mkdirSync(arbitraryRoot, { recursive: true })
  writeFileSync(join(arbitraryRoot, "user-file.txt"), "do not adopt")
  studioDb.recordStudioAgentProviderEvent({
    sessionId: session.id,
    runtimeId: "astraflow",
    provider: "pi",
    direction: "internal",
    eventType: studioDb.STUDIO_ACP_SESSION_SELECTED_EVENT,
    providerSessionId: "arbitrary-provider-session",
    payload: {
      cwd: arbitraryRoot,
      sourceStudioSessionId: session.id,
      stateOwnerStudioSessionId: "old-state-owner",
    },
  })

  const workspace = managedWorkspace.ensureStudioManagedWorkspace(session.id)

  assert.equal(workspace.origin, "managed_local")
  assert.notEqual(workspace.rootPath, realpathSync(arbitraryRoot))
  assert.equal(
    workspace.rootPath.startsWith(
      `${realpathSync(process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH)}/`
    ),
    true
  )
  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(
      session.id,
      "astraflow"
    ),
    null
  )
  assert.equal(
    studioDb.getLatestStudioAcpSessionSelection(session.id, "astraflow"),
    null
  )
  assert.equal(
    readFileSync(join(arbitraryRoot, "user-file.txt"), "utf8"),
    "do not adopt"
  )
})

test("deleting a task never deletes its managed workspace files", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Keep my files",
  })
  const workspace = managedWorkspace.ensureStudioManagedWorkspace(session.id)
  const artifactPath = join(workspace.rootPath, "artifact.txt")

  writeFileSync(artifactPath, "still here")

  assert.equal(studioDb.deleteStudioSession(session.id), true)
  assert.equal(existsSync(artifactPath), true)
  assert.equal(readFileSync(artifactPath, "utf8"), "still here")
  assert.equal(studioDb.getStudioWorkspace(workspace.id)?.id, workspace.id)
})

test("deleting a task removes only its private ACP attachments", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Private attachments",
  })
  const otherSession = studioDb.createStudioSession({
    mode: "chat",
    title: "Other private attachments",
  })
  const attachmentDirectory =
    acpAttachments.ensureAcpAttachmentDirectory(session.id)
  const otherAttachmentDirectory =
    acpAttachments.ensureAcpAttachmentDirectory(otherSession.id)

  writeFileSync(join(attachmentDirectory, "secret.txt"), "secret")
  writeFileSync(join(otherAttachmentDirectory, "keep.txt"), "keep")

  assert.equal(studioDb.deleteStudioSession(session.id), true)
  assert.equal(existsSync(attachmentDirectory), false)
  assert.equal(existsSync(join(otherAttachmentDirectory, "keep.txt")), true)
  assert.throws(
    () => acpAttachments.removeAcpAttachmentDirectory(".."),
    /invalid ACP attachment session id/i
  )
  assert.equal(existsSync(join(testDirectory, "acp-attachments")), true)
})

test("migrates legacy permission rows fail-closed", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Legacy permissions",
  })
  const database = studioDb.getStudioDatabase()

  database
    .prepare(
      `
        UPDATE studio_sessions
        SET permission_mode = 'ask',
            permission_schema_version = 1
        WHERE id = ?
      `
    )
    .run(session.id)
  assert.deepEqual(
    {
      mode: studioDb.getStudioSession(session.id)?.permissionMode,
      migration: studioDb.getStudioSession(session.id)
        ?.requiresPermissionMigration,
    },
    { mode: "default", migration: true }
  )

  database
    .prepare(
      `
        UPDATE studio_sessions
        SET permission_mode = 'readonly',
            permission_schema_version = 1
        WHERE id = ?
      `
    )
    .run(session.id)
  assert.equal(
    studioDb.getStudioSession(session.id)?.permissionMode,
    "legacy_readonly"
  )

  database
    .prepare(
      `
        UPDATE studio_sessions
        SET permission_mode = 'full_access',
            permission_schema_version = 1,
            local_full_access_grant_version = NULL,
            local_full_access_granted_at = NULL,
            local_full_access_grant_scope = NULL
        WHERE id = ?
      `
    )
    .run(session.id)
  assert.equal(studioDb.getStudioSession(session.id)?.permissionMode, "default")

  database
    .prepare(
      `
        UPDATE studio_sessions
        SET permission_mode = 'unknown_future_mode',
            permission_schema_version = 99
        WHERE id = ?
      `
    )
    .run(session.id)
  assert.equal(
    studioDb.getStudioSession(session.id)?.permissionMode,
    "legacy_readonly"
  )
})

test("requires and scopes a local Full Access confirmation", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Permission grant",
  })

  assert.throws(
    () => studioDb.updateStudioSessionPermissionMode(session.id, "full_access"),
    /explicit confirmation/i
  )

  const granted = studioDb.updateStudioSessionPermissionMode(
    session.id,
    "full_access",
    { confirmLocalFullAccess: true }
  )

  assert.equal(granted?.permissionMode, "full_access")
  assert.equal(granted?.localFullAccessGranted, true)

  const workspace = managedWorkspace.ensureStudioManagedWorkspace(session.id)
  const rebound = studioDb.getStudioSession(session.id)

  assert.equal(workspace.origin, "managed_local")
  assert.equal(rebound?.permissionMode, "full_access")
  assert.equal(rebound?.localFullAccessGranted, true)

  const selected = studioDb.getStudioWorkspaceForLocalProject("legacy-project")
  assert.ok(selected)
  const moved = studioDb.updateStudioSessionWorkspace(session.id, selected.id)

  assert.equal(moved?.permissionMode, "default")
  assert.equal(moved?.storedPermissionMode, "default")
  assert.equal(moved?.localFullAccessGranted, false)
})

test("updates workspace, permission, and continuation atomically", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Atomic session settings",
  })
  const originalWorkspace =
    managedWorkspace.ensureStudioManagedWorkspace(session.id)
  const selected = studioDb.getStudioWorkspaceForLocalProject("legacy-project")

  assert.ok(selected)
  studioDb.recordStudioAgentProviderEvent({
    sessionId: session.id,
    runtimeId: "astraflow",
    provider: "pi",
    direction: "internal",
    eventType: studioDb.STUDIO_ACP_SESSION_SELECTED_EVENT,
    providerSessionId: "atomic-provider-session",
    payload: {
      cwd: originalWorkspace.rootPath,
      sourceStudioSessionId: session.id,
      stateOwnerStudioSessionId: session.id,
    },
  })

  assert.throws(
    () =>
      studioDb.updateStudioSessionConfiguration(session.id, {
        workspaceId: selected.id,
        permissionMode: "full_access",
      }),
    /explicit confirmation/i
  )
  assert.equal(
    studioDb.getStudioSession(session.id)?.workspaceId,
    originalWorkspace.id
  )
  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(
      session.id,
      "astraflow"
    ),
    "atomic-provider-session"
  )

  assert.throws(
    () =>
      studioDb.updateStudioSessionConfiguration(session.id, {
        workspaceId: selected.id,
        permissionMode: "full_access",
        confirmLocalFullAccess: true,
        confirmedLocalFullAccessGrantScope: `managed:${session.id}`,
      }),
    /exact workspace/i
  )
  assert.equal(
    studioDb.getStudioSession(session.id)?.workspaceId,
    originalWorkspace.id
  )
  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(
      session.id,
      "astraflow"
    ),
    "atomic-provider-session"
  )

  const updated = studioDb.updateStudioSessionConfiguration(session.id, {
    workspaceId: selected.id,
    permissionMode: "full_access",
    confirmLocalFullAccess: true,
    confirmedLocalFullAccessGrantScope: `workspace:${selected.id}`,
  })

  assert.equal(updated?.session?.workspaceId, selected.id)
  assert.equal(updated?.session?.permissionMode, "full_access")
  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(
      session.id,
      "astraflow"
    ),
    null
  )
})

test("direct workspace rebinding invalidates provider continuation atomically", () => {
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Direct workspace rebind",
  })
  const originalWorkspace =
    managedWorkspace.ensureStudioManagedWorkspace(session.id)
  const selected = studioDb.getStudioWorkspaceForLocalProject("legacy-project")

  assert.ok(selected)
  studioDb.recordStudioAgentProviderEvent({
    sessionId: session.id,
    runtimeId: "astraflow",
    provider: "pi",
    direction: "internal",
    eventType: studioDb.STUDIO_ACP_SESSION_SELECTED_EVENT,
    providerSessionId: "direct-provider-session",
    payload: {
      cwd: originalWorkspace.rootPath,
      sourceStudioSessionId: session.id,
      stateOwnerStudioSessionId: session.id,
    },
  })

  const rebound = studioDb.updateStudioSessionWorkspace(
    session.id,
    selected.id
  )
  const resetRow = studioDb
    .getStudioDatabase()
    .prepare(
      `
        SELECT provider_session_reset_at
        FROM studio_sessions
        WHERE id = ?
      `
    )
    .get(session.id)

  assert.equal(rebound?.workspaceId, selected.id)
  assert.equal(rebound?.projectId, selected.localProjectId)
  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(
      session.id,
      "astraflow"
    ),
    null
  )
  assert.equal(
    studioDb.getLatestStudioAcpSessionSelection(session.id, "astraflow"),
    null
  )
  assert.equal(
    typeof resetRow?.provider_session_reset_at,
    "string"
  )

  studioDb.recordStudioAgentProviderEvent({
    sessionId: session.id,
    runtimeId: "astraflow",
    provider: "pi",
    direction: "internal",
    eventType: studioDb.STUDIO_ACP_SESSION_SELECTED_EVENT,
    providerSessionId: "same-workspace-provider-session",
    payload: {
      cwd: selected.rootPath,
      sourceStudioSessionId: session.id,
      stateOwnerStudioSessionId: session.id,
    },
  })

  studioDb.updateStudioSessionWorkspace(session.id, selected.id)

  assert.equal(
    studioDb.getLatestStudioAgentProviderSessionId(
      session.id,
      "astraflow"
    ),
    "same-workspace-provider-session"
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
