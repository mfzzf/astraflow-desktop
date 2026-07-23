import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"
import { after, test } from "node:test"

register("./helpers/typescript-alias-loader.mjs", import.meta.url)

const root = mkdtempSync(join(tmpdir(), "astraflow-acp-local-sandbox-"))
process.env.ASTRAFLOW_SQLITE_PATH = join(root, "studio.sqlite")
process.env.ASTRAFLOW_USER_DATA_PATH = join(root, "user-data")
process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH = join(root, "AstraFlow")
process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(root, "sandbox-workspaces")
process.env.ASTRAFLOW_ACP_ATTACHMENTS_PATH = join(root, "acp-attachments")
process.env.ASTRAFLOW_SECRET_KEY = "33".repeat(32)
process.env.ASTRAFLOW_INTERNAL_ORIGIN = "http://127.0.0.1:3000"

const studioDb = await import("../lib/studio-db.ts")
const {
  resolveAstraflowAcpConfiguration,
  resolveAstraflowAcpLocalCommand,
  resolveAstraflowAcpStateBroker,
} =
  await import("../lib/agent/astraflow-acp-config.ts")
const { getLegacyAcpWorkspacePath } =
  await import("../lib/agent/acp/workspace.ts")
studioDb.saveStudioModelverseApiKey({
  id: "sandbox-test-key",
  name: "Sandbox test",
  key: "real-api-key",
  projectId: "sandbox-test-project",
})

after(() => {
  studioDb.getStudioDatabase().close()
  rmSync(root, { force: true, recursive: true })
})

function input(permissionMode) {
  return {
    environment: "local",
    messages: [],
    model: "gpt-5.6-sol",
    permissionMode,
    sessionId: `session-${permissionMode}`,
    signal: new AbortController().signal,
  }
}

test("Default starts the whole local Pi ACP process in the OS sandbox", () => {
  const command = resolveAstraflowAcpLocalCommand(input("default"))

  assert.equal(command.env.ASTRAFLOW_PERMISSION_MODE, "workspace_auto")
  assert.equal(command.env.ASTRAFLOW_ACP_STATE_KEY, undefined)
  assert.equal(command.env.ASTRAFLOW_ACP_STATE_ROOT, undefined)
  assert.equal(command.stateBroker?.constructor.name, "AcpStateBroker")
  assert.equal(JSON.stringify(command.stateBroker), "{}")
  assert.equal(command.env.ASTRAFLOW_MODELVERSE_API_KEY.length, 43)
  assert.notEqual(command.env.ASTRAFLOW_MODELVERSE_API_KEY, "real-api-key")
  assert.equal(
    command.providerProxyToken,
    command.env.ASTRAFLOW_MODELVERSE_API_KEY
  )
  assert.deepEqual(command.sandbox.allowedNetworkDomains, [])
  assert.deepEqual(command.sandbox.allowedNetworkEndpoints, [
    { host: "127.0.0.1", port: 3000 },
  ])
  const readOnlyRoots = JSON.parse(command.env.ASTRAFLOW_ACP_READ_ONLY_ROOTS)
  assert.deepEqual(readOnlyRoots, [
    join(root, "acp-attachments", "session-default"),
  ])
  assert.equal(
    command.sandbox.additionalReadRoots.includes(readOnlyRoots[0]),
    true
  )
  assert.equal(command.sandbox.stateRoot, undefined)
  assert.equal(
    command.sandbox.runtimeStateRoot,
    command.env.ASTRAFLOW_ACP_RUNTIME_STATE_ROOT
  )
})

test("Default keeps the workspace-scoped runtime policy for remote execution", () => {
  const configuration = resolveAstraflowAcpConfiguration({
    ...input("default"),
    environment: "remote",
  })

  assert.equal(
    configuration.env.ASTRAFLOW_PERMISSION_MODE,
    "workspace_auto"
  )
})

test("remote Pi checkpoints stay Desktop-brokered and encrypted at rest", async () => {
  const desktopSessionId = "session-remote-broker-storage"
  const acpSessionId = "remote-broker-storage-acp-session"
  const stateBroker = resolveAstraflowAcpStateBroker({
    ...input("default"),
    environment: "remote",
    sessionId: desktopSessionId,
  })
  const record = {
    schemaVersion: 2,
    sessionId: acpSessionId,
    cwd: "/workspace",
    history: [
      {
        role: "user",
        content: "remote-checkpoint-must-not-be-plaintext",
        timestamp: 1,
      },
    ],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(1).toISOString(),
  }
  const request = {
    desktopSessionId,
    sessionId: acpSessionId,
  }
  const checkpointName = `${createHash("sha256").update(acpSessionId).digest("hex")}.json`
  const checkpointPath = join(
    root,
    "user-data",
    "acp-state",
    desktopSessionId,
    checkpointName
  )

  await stateBroker.save({ ...request, record })
  const encrypted = readFileSync(checkpointPath, "utf8")

  assert.equal(JSON.parse(encrypted).format, "astraflow-acp-aes-256-gcm")
  assert.doesNotMatch(encrypted, /remote-checkpoint-must-not-be-plaintext/)
  assert.equal(stateBroker.load(request).record.sessionId, acpSessionId)
})

test("Full Access is explicit direct execution and legacy readonly stays sandboxed", () => {
  const fullAccess = resolveAstraflowAcpLocalCommand(input("full_access"))
  const legacyReadonly = resolveAstraflowAcpLocalCommand(
    input("legacy_readonly")
  )

  assert.equal(fullAccess.sandbox, undefined)
  assert.equal(fullAccess.providerProxyToken.length, 43)
  assert.equal(fullAccess.env.ASTRAFLOW_PERMISSION_MODE, "full_access")
  assert.equal(fullAccess.env.ASTRAFLOW_ACP_STATE_KEY, undefined)
  assert.equal(fullAccess.env.ASTRAFLOW_ACP_STATE_ROOT, undefined)
  assert.equal(fullAccess.stateBroker?.constructor.name, "AcpStateBroker")
  assert.equal(legacyReadonly.sandbox?.kind, "astraflow-local")
  assert.equal(legacyReadonly.env.ASTRAFLOW_PERMISSION_MODE, "readonly")
})

test("Desktop broker encrypts, scopes, lists, and atomically deletes local state", async () => {
  const desktopSessionId = "session-broker-storage"
  const acpSessionId = "broker-storage-acp-session"
  const command = resolveAstraflowAcpLocalCommand({
    ...input("default"),
    sessionId: desktopSessionId,
  })
  const record = {
    schemaVersion: 2,
    sessionId: acpSessionId,
    cwd: root,
    history: [
      {
        role: "user",
        content: "parent-only-checkpoint-secret",
        timestamp: 1,
      },
    ],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(1).toISOString(),
  }
  const request = {
    desktopSessionId,
    sessionId: acpSessionId,
  }
  const checkpointName = `${createHash("sha256").update(acpSessionId).digest("hex")}.json`
  const checkpointPath = join(
    root,
    "user-data",
    "acp-state",
    desktopSessionId,
    checkpointName
  )

  await command.stateBroker.save({ ...request, record })
  const encrypted = readFileSync(checkpointPath, "utf8")

  assert.equal(JSON.parse(encrypted).format, "astraflow-acp-aes-256-gcm")
  assert.doesNotMatch(encrypted, /parent-only-checkpoint-secret/)
  assert.equal(command.stateBroker.load(request).record.sessionId, acpSessionId)
  assert.equal(
    command.stateBroker.list({ desktopSessionId }).records[0].sessionId,
    acpSessionId
  )
  await assert.rejects(
    command.stateBroker.save({
      ...request,
      desktopSessionId: "wrong-desktop-session",
      record,
    }),
    /does not belong/
  )
  await command.stateBroker.delete(request)
  assert.equal(existsSync(checkpointPath), false)
})

test("encrypts legacy plaintext checkpoints before Pi loads them", async () => {
  const sessionId = "session-with-legacy-state"
  const legacyStateRoot = join(
    getLegacyAcpWorkspacePath(sessionId),
    ".astraflow-acp-state"
  )
  const acpSessionId = "legacy-acp-session"
  const checkpointName = `${createHash("sha256").update(acpSessionId).digest("hex")}.json`
  const legacyFile = join(legacyStateRoot, checkpointName)
  const legacyRecord = {
    schemaVersion: 2,
    sessionId: acpSessionId,
    cwd: root,
    history: [],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(1).toISOString(),
  }

  mkdirSync(legacyStateRoot, { recursive: true })
  writeFileSync(legacyFile, JSON.stringify(legacyRecord), { mode: 0o600 })

  const command = resolveAstraflowAcpLocalCommand({
    ...input("default"),
    sessionId,
  })
  const migrated = join(
    root,
    "user-data",
    "acp-state",
    sessionId,
    checkpointName
  )

  assert.equal(existsSync(legacyFile), false)
  assert.equal(existsSync(migrated), true)
  assert.equal(
    JSON.parse(readFileSync(migrated, "utf8")).format,
    "astraflow-acp-aes-256-gcm"
  )
  assert.equal(
    command.stateBroker.load({
      desktopSessionId: sessionId,
      sessionId: acpSessionId,
    }).record.sessionId,
    acpSessionId
  )
  assert.throws(
    () =>
      command.stateBroker.load({
        desktopSessionId: "another-studio-session",
        sessionId: acpSessionId,
      }),
    /does not belong/
  )
})
