import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  readPlaintextMigrationFiles,
  readRuntimeStateRoot,
  readStateBackend,
  readStateEncryptionKey,
  readStateRoot,
} from "../src/agent.mjs"
import { ASTRAFLOW_ACP_STATE_SCHEMA_VERSION } from "../src/constants.mjs"
import {
  ASTRAFLOW_ACP_STATE_BROKER_METHODS,
  AstraflowBrokerSessionStore,
  AstraflowSessionStore,
} from "../src/session-store.mjs"

function sessionRecord(sessionId, cwd) {
  return {
    schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
    sessionId,
    cwd,
    history: [
      {
        role: "user",
        content: "private durable message",
        timestamp: Date.now(),
      },
    ],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(1).toISOString(),
    title: "private checkpoint title",
  }
}

test("encrypts durable ACP state and rejects authenticated tampering", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-encrypted-state-")
  )
  const key = randomBytes(32)
  const store = new AstraflowSessionStore({ encryptionKey: key, root })
  const record = sessionRecord("encrypted-session", root)

  try {
    await store.save(record)
    const file = store.filePath(record.sessionId)
    const raw = await readFile(file, "utf8")

    assert.doesNotMatch(raw, /private durable message/)
    assert.doesNotMatch(raw, /private checkpoint title/)
    assert.equal((await store.load(record.sessionId)).title, record.title)

    const envelope = JSON.parse(raw)
    envelope.ciphertext = `${envelope.ciphertext[0] === "A" ? "B" : "A"}${envelope.ciphertext.slice(1)}`
    await writeFile(file, JSON.stringify(envelope), "utf8")

    await assert.rejects(store.load(record.sessionId), /authentication failed/i)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("migrates a legacy plaintext checkpoint on first keyed load", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "astraflow-acp-legacy-state-"))
  const record = sessionRecord("legacy-session", root)
  const file = new AstraflowSessionStore({ root }).filePath(record.sessionId)
  const store = new AstraflowSessionStore({
    encryptionKey: randomBytes(32),
    plaintextMigrationFiles: [path.basename(file)],
    root,
  })

  try {
    await writeFile(file, JSON.stringify(record), {
      encoding: "utf8",
      mode: 0o600,
    })

    assert.equal(
      (await store.load(record.sessionId)).sessionId,
      record.sessionId
    )
    const migrated = await readFile(file, "utf8")
    assert.equal(JSON.parse(migrated).format, "astraflow-acp-aes-256-gcm")
    assert.doesNotMatch(migrated, /private durable message/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("rejects plaintext checkpoints outside the trusted migration list", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-plaintext-rejection-")
  )
  const record = sessionRecord("untrusted-plaintext-session", root)
  const store = new AstraflowSessionStore({
    encryptionKey: randomBytes(32),
    root,
  })

  try {
    await store.ensureReady()
    await writeFile(store.filePath(record.sessionId), JSON.stringify(record), {
      encoding: "utf8",
      mode: 0o600,
    })

    await assert.rejects(
      store.load(record.sessionId),
      /not an authorized legacy migration/i
    )
    assert.deepEqual(await store.list(), [])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("consumes state bootstrap metadata before coding tools inherit it", () => {
  const key = randomBytes(32).toString("hex")
  const checkpointName = `${"a".repeat(64)}.json`
  const runtimeStateRootValue = path.resolve("/private/runtime-state")
  const env = {
    ASTRAFLOW_ACP_PLAINTEXT_MIGRATION_FILES: JSON.stringify([checkpointName]),
    ASTRAFLOW_ACP_RUNTIME_STATE_ROOT: runtimeStateRootValue,
    ASTRAFLOW_ACP_STATE_BACKEND: "desktop",
    ASTRAFLOW_ACP_STATE_KEY: key,
    ASTRAFLOW_ACP_STATE_ROOT: "/private/checkpoints",
  }
  const migrations = readPlaintextMigrationFiles(env)
  const stateBackend = readStateBackend(env)
  const loaded = readStateEncryptionKey(env)
  const runtimeStateRoot = readRuntimeStateRoot(env)
  const stateRoot = readStateRoot(env)

  assert.deepEqual(migrations, [checkpointName])
  assert.equal(stateBackend, "desktop")
  assert.equal(loaded.toString("hex"), key)
  assert.equal(runtimeStateRoot, runtimeStateRootValue)
  assert.equal(stateRoot, "/private/checkpoints")
  assert.equal(env.ASTRAFLOW_ACP_PLAINTEXT_MIGRATION_FILES, undefined)
  assert.equal(env.ASTRAFLOW_ACP_RUNTIME_STATE_ROOT, undefined)
  assert.equal(env.ASTRAFLOW_ACP_STATE_BACKEND, undefined)
  assert.equal(env.ASTRAFLOW_ACP_STATE_KEY, undefined)
  assert.equal(env.ASTRAFLOW_ACP_STATE_ROOT, undefined)
  assert.throws(
    () =>
      readStateEncryptionKey({
        ASTRAFLOW_ACP_STATE_KEY: "not-a-valid-key",
      }),
    /32-byte hex/
  )
  assert.throws(
    () =>
      readStateBackend({
        ASTRAFLOW_ACP_STATE_BACKEND: "plaintext",
      }),
    /desktop or filesystem/
  )
})

test("brokered local or remote state uses scoped ACP requests without filesystem or keys", async () => {
  const record = sessionRecord("broker-session", "/workspace")
  const requests = []
  let saved = null
  const client = {
    async request(method, params) {
      requests.push({ method, params })

      if (method === ASTRAFLOW_ACP_STATE_BROKER_METHODS.save) {
        saved = params.record
        return {}
      }
      if (method === ASTRAFLOW_ACP_STATE_BROKER_METHODS.load) {
        return { record: saved }
      }
      if (method === ASTRAFLOW_ACP_STATE_BROKER_METHODS.list) {
        return { records: saved ? [saved] : [] }
      }
      if (method === ASTRAFLOW_ACP_STATE_BROKER_METHODS.delete) {
        saved = null
        return {}
      }

      throw new Error(`Unexpected broker method: ${method}`)
    },
  }
  const context = { client, desktopSessionId: "desktop-session" }
  const store = new AstraflowBrokerSessionStore()

  assert.deepEqual(Object.keys(store), [])
  await store.save(record, context)
  assert.equal((await store.load(record.sessionId, context)).sessionId, record.sessionId)
  assert.equal((await store.list(context))[0].sessionId, record.sessionId)
  await store.delete(record.sessionId, context)
  assert.equal(await store.load(record.sessionId, context), null)
  assert.equal(
    requests.every(
      ({ params }) => params.desktopSessionId === "desktop-session"
    ),
    true
  )
  await assert.rejects(
    store.list({ client: {}, desktopSessionId: "desktop-session" }),
    /scoped Desktop client/
  )
})
