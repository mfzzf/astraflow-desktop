import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { createHmac, randomBytes } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"

register("./helpers/server-route-loader.mjs", import.meta.url)

const testRoot = mkdtempSync(join(tmpdir(), "astraflow-session-route-grant-"))
const secretKey = "44".repeat(32)
const deviceId = "managed-workspace-route-device"
const previousEnvironment = {
  ASTRAFLOW_DEVICE_ID: process.env.ASTRAFLOW_DEVICE_ID,
  ASTRAFLOW_SECRET_KEY: process.env.ASTRAFLOW_SECRET_KEY,
  ASTRAFLOW_SQLITE_PATH: process.env.ASTRAFLOW_SQLITE_PATH,
}

process.env.ASTRAFLOW_DEVICE_ID = deviceId
process.env.ASTRAFLOW_SECRET_KEY = secretKey
process.env.ASTRAFLOW_SQLITE_PATH = join(testRoot, "studio.sqlite")

const studioDb = await import("../lib/studio-db.ts")
const mobilePreferences =
  await import("../lib/mobile-channels/preferences.ts")
const sessionRoute =
  await import("../app/api/studio/sessions/[sessionId]/route.ts")

function createLocalFullAccessGrant({ sessionId, workspaceId }) {
  const now = Date.now()
  const payload = {
    version: 1,
    policyVersion: 2,
    sessionId,
    workspaceId,
    environment: "local",
    deviceId,
    nonce: randomBytes(32).toString("hex"),
    issuedAt: now,
    expiresAt: now + 60_000,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  )
  const signature = createHmac("sha256", Buffer.from(secretKey, "hex"))
    .update(encodedPayload)
    .digest("base64url")

  return `${encodedPayload}.${signature}`
}

function patchSession(sessionId, body) {
  return sessionRoute.PATCH(
    new Request(`http://127.0.0.1/api/studio/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ sessionId }) }
  )
}

before(() => {
  studioDb.saveStudioModelverseApiKey({
    id: "workspace-route-key",
    name: "Workspace route key",
    key: "workspace-route-secret",
    projectId: "workspace-route-project",
  })
  studioDb.saveStudioAstraFlowApiKeySession()
})

after(() => {
  studioDb.getStudioDatabase().close()

  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = value
    }
  }

  rmSync(testRoot, { force: true, recursive: true })
})

test("rejects a project-only rebind with a token scoped to the unbound task", async () => {
  const projectRoot = join(testRoot, "rejected-project")

  mkdirSync(projectRoot, { recursive: true })
  const project = studioDb.createStudioLocalProject({
    name: "Rejected project",
    path: projectRoot,
  })
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Rejected project-only Full Access",
    workspaceId: null,
  })
  const response = await patchSession(session.id, {
    projectId: project.id,
    permissionMode: "full_access",
    localFullAccessGrant: createLocalFullAccessGrant({
      sessionId: session.id,
      workspaceId: null,
    }),
  })

  assert.equal(response.status, 403)
  assert.equal(studioDb.getStudioSession(session.id)?.workspaceId, null)
  assert.equal(
    studioDb.getStudioSession(session.id)?.permissionMode,
    "default"
  )
})

test("accepts a project-only rebind with a token scoped to its effective workspace", async () => {
  const projectRoot = join(testRoot, "accepted-project")

  mkdirSync(projectRoot, { recursive: true })
  const project = studioDb.createStudioLocalProject({
    name: "Accepted project",
    path: projectRoot,
  })
  const projectWorkspace =
    studioDb.getStudioWorkspaceForLocalProject(project.id)
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Accepted project-only Full Access",
    workspaceId: null,
  })

  assert.ok(projectWorkspace)

  const response = await patchSession(session.id, {
    projectId: project.id,
    permissionMode: "full_access",
    localFullAccessGrant: createLocalFullAccessGrant({
      sessionId: session.id,
      workspaceId: projectWorkspace.id,
    }),
  })
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.data.workspaceId, projectWorkspace.id)
  assert.equal(body.data.projectId, project.id)
  assert.equal(body.data.permissionMode, "full_access")
  assert.equal(body.data.localFullAccessGranted, true)
})

test("allows metadata updates but rejects execution rebinding during an active run", async () => {
  const projectRoot = join(testRoot, "active-run-project")

  mkdirSync(projectRoot, { recursive: true })
  const project = studioDb.createStudioLocalProject({
    name: "Active run project",
    path: projectRoot,
  })
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Active run",
    workspaceId: null,
  })
  const now = new Date().toISOString()

  globalThis.astraflowStudioChatRuns ??= new Map()
  globalThis.astraflowStudioChatRuns.set(session.id, {
    runId: "active-route-run",
    sessionId: session.id,
    assistantMessageId: "active-route-assistant",
    status: "running",
    error: null,
    usage: null,
    startedAt: now,
    updatedAt: now,
  })

  try {
    const titleResponse = await patchSession(session.id, {
      title: "Renamed during run",
    })
    const projectResponse = await patchSession(session.id, {
      projectId: project.id,
    })
    const runtimeResponse = await patchSession(session.id, {
      chatRuntimeId: "codex",
    })

    assert.equal(titleResponse.status, 200)
    assert.equal(
      studioDb.getStudioSession(session.id)?.title,
      "Renamed during run"
    )
    assert.equal(projectResponse.status, 409)
    assert.equal(runtimeResponse.status, 409)
    assert.equal(studioDb.getStudioSession(session.id)?.workspaceId, null)
    assert.equal(studioDb.getStudioSession(session.id)?.projectId, null)
    assert.equal(studioDb.getStudioSession(session.id)?.chatRuntimeId, null)
  } finally {
    globalThis.astraflowStudioChatRuns.delete(session.id)
  }
})

test("mobile project rebinding clears provider continuation in the same update", () => {
  const firstProjectRoot = join(testRoot, "mobile-first-project")
  const secondProjectRoot = join(testRoot, "mobile-second-project")

  mkdirSync(firstProjectRoot, { recursive: true })
  mkdirSync(secondProjectRoot, { recursive: true })
  const firstProject = studioDb.createStudioLocalProject({
    name: "Mobile first project",
    path: firstProjectRoot,
  })
  const secondProject = studioDb.createStudioLocalProject({
    name: "Mobile second project",
    path: secondProjectRoot,
  })
  const firstWorkspace =
    studioDb.getStudioWorkspaceForLocalProject(firstProject.id)
  const secondWorkspace =
    studioDb.getStudioWorkspaceForLocalProject(secondProject.id)

  assert.ok(firstWorkspace)
  assert.ok(secondWorkspace)

  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Mobile project rebind",
    workspaceId: firstWorkspace.id,
    chatRuntimeId: "astraflow",
    chatModel: "gpt-5.6-sol",
    chatReasoningEffort: "medium",
  })

  studioDb.recordStudioAgentProviderEvent({
    sessionId: session.id,
    runtimeId: "astraflow",
    provider: "pi",
    direction: "internal",
    eventType: studioDb.STUDIO_ACP_SESSION_SELECTED_EVENT,
    providerSessionId: "mobile-provider-session",
    payload: {
      cwd: firstWorkspace.rootPath,
      sourceStudioSessionId: session.id,
      stateOwnerStudioSessionId: session.id,
    },
  })

  const updated = mobilePreferences.syncMobileChannelConnectionToSession(
    {
      agentRuntimeId: "astraflow",
      chatModel: "gpt-5.6-sol",
      reasoningEffort: "medium",
      permissionMode: "default",
      defaultProjectId: secondProject.id,
    },
    session.id
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

  assert.equal(updated?.workspaceId, secondWorkspace.id)
  assert.equal(updated?.projectId, secondProject.id)
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
  assert.equal(typeof resetRow?.provider_session_reset_at, "string")
})

test("mobile synchronization cannot downgrade a remote Full Access session", () => {
  const workspace = studioDb.createStudioSandboxWorkspace({
    name: "Remote Full Access",
    rootPath: "/workspace/remote-full-access",
    sandboxId: "remote-full-access-sandbox",
  })
  const session = studioDb.createStudioSession({
    mode: "chat",
    title: "Remote Full Access mobile conflict",
    workspaceId: workspace.id,
    permissionMode: "full_access",
    chatRuntimeId: "astraflow",
    chatModel: "gpt-5.6-sol",
  })

  assert.throws(
    () =>
      mobilePreferences.syncMobileChannelConnectionToSession(
        {
          agentRuntimeId: "codex",
          chatModel: "gpt-5.4",
          reasoningEffort: "medium",
          permissionMode: "default",
          defaultProjectId: null,
        },
        session.id
      ),
    /cannot take over a remote Sandbox task while it is in Full Access/
  )

  assert.deepEqual(
    {
      permissionMode:
        studioDb.getStudioSession(session.id)?.permissionMode,
      workspaceId: studioDb.getStudioSession(session.id)?.workspaceId,
      chatRuntimeId:
        studioDb.getStudioSession(session.id)?.chatRuntimeId,
      chatModel: studioDb.getStudioSession(session.id)?.chatModel,
    },
    {
      permissionMode: "full_access",
      workspaceId: workspace.id,
      chatRuntimeId: "astraflow",
      chatModel: "gpt-5.6-sol",
    }
  )
})
