import * as SQLite from "expo-sqlite"

import type {
  AstraflowV1AgentAction,
  AstraflowV1AgentRun,
  AstraflowV1AgentRunEvent,
  AstraflowV1Artifact,
  AstraflowV1Device,
  AstraflowV1GetSyncSnapshotResponse,
  AstraflowV1Message,
  AstraflowV1Session,
  AstraflowV1SyncEventEnvelope,
  AstraflowV1Workspace,
} from "@/generated/astraflow-api"

const databasePromise = SQLite.openDatabaseAsync("astraflow-mobile.db")
let initialized: Promise<void> | null = null

async function database() {
  const db = await databasePromise
  if (!initialized) {
    initialized = db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS mobile_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_sessions (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_devices (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_workspaces (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cached_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cached_runs_session
        ON cached_runs(session_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS cached_actions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cached_actions_run
        ON cached_actions(run_id, status);
      CREATE TABLE IF NOT EXISTS cached_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cached_messages_session
        ON cached_messages(session_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS cached_run_events (
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        payload TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE TABLE IF NOT EXISTS cached_artifacts (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cached_artifacts_session
        ON cached_artifacts(session_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS sync_event_dedup (
        event_id TEXT PRIMARY KEY,
        cursor INTEGER NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS drafts (
        key TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mobile_outbox (
        id TEXT PRIMARY KEY,
        operation TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_outbox_delivery
        ON mobile_outbox(status, next_attempt_at, created_at);
    `)
  }
  await initialized
  return db
}

function parseRows<T>(rows: Array<{ payload: string }>) {
  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.payload) as T]
    } catch {
      return []
    }
  })
}

function updatedAt(value: { updatedAt?: string; createdAt?: string }) {
  return value.updatedAt || value.createdAt || new Date().toISOString()
}

function camelizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(camelizeKeys)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      camelizeKeys(child),
    ])
  )
}

async function replaceProjection<
  T extends { id?: string; updatedAt?: string; createdAt?: string },
>(
  table: "cached_sessions" | "cached_devices" | "cached_workspaces",
  values: T[]
) {
  const db = await database()
  await db.runAsync(`DELETE FROM ${table}`)
  for (const value of values) {
    if (!value.id) continue
    await db.runAsync(
      `INSERT INTO ${table} (id, payload, updated_at) VALUES (?, ?, ?)`,
      value.id,
      JSON.stringify(value),
      updatedAt(value)
    )
  }
}

export async function persistSyncSnapshot(
  snapshot: AstraflowV1GetSyncSnapshotResponse
) {
  await replaceProjection("cached_devices", snapshot.devices ?? [])
  await replaceProjection("cached_workspaces", snapshot.workspaces ?? [])
  await replaceProjection("cached_sessions", snapshot.sessions ?? [])
  const db = await database()
  await db.runAsync("DELETE FROM cached_runs")
  await db.runAsync("DELETE FROM cached_actions")
  for (const run of snapshot.activeRuns ?? []) await cacheRun(run)
  for (const action of snapshot.pendingActions ?? []) await cacheAction(action)
  await setSyncCursor(Number(snapshot.cursor ?? 0))
}

export async function readCachedSessions() {
  const db = await database()
  return parseRows<AstraflowV1Session>(
    await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM cached_sessions ORDER BY updated_at DESC"
    )
  )
}

export async function readCachedDevices() {
  const db = await database()
  return parseRows<AstraflowV1Device>(
    await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM cached_devices ORDER BY updated_at DESC"
    )
  )
}

export async function readCachedWorkspaces() {
  const db = await database()
  return parseRows<AstraflowV1Workspace>(
    await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM cached_workspaces ORDER BY updated_at DESC"
    )
  )
}

export async function readCachedRuns(sessionId?: string) {
  const db = await database()
  const rows = sessionId
    ? await db.getAllAsync<{ payload: string }>(
        "SELECT payload FROM cached_runs WHERE session_id = ? ORDER BY updated_at DESC",
        sessionId
      )
    : await db.getAllAsync<{ payload: string }>(
        "SELECT payload FROM cached_runs ORDER BY updated_at DESC"
      )
  return parseRows<AstraflowV1AgentRun>(rows)
}

export async function cacheMessages(
  sessionId: string,
  messages: AstraflowV1Message[]
) {
  const db = await database()
  for (const message of messages) {
    if (!message.id) continue
    await db.runAsync(
      `INSERT INTO cached_messages (id, session_id, payload, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      message.id,
      sessionId,
      JSON.stringify(message),
      message.createdAt || new Date().toISOString()
    )
  }
}

export async function readCachedMessages(sessionId: string) {
  const db = await database()
  return parseRows<AstraflowV1Message>(
    await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM cached_messages WHERE session_id = ? ORDER BY created_at DESC",
      sessionId
    )
  )
}

export async function cacheRunEvents(
  runId: string,
  events: AstraflowV1AgentRunEvent[]
) {
  const db = await database()
  for (const event of events) {
    const seq = Number(event.seq ?? 0)
    if (!event.eventId || seq <= 0) continue
    await db.runAsync(
      `INSERT INTO cached_run_events (run_id, seq, event_id, payload)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(run_id, seq) DO UPDATE SET event_id = excluded.event_id, payload = excluded.payload`,
      runId,
      seq,
      event.eventId,
      JSON.stringify(event)
    )
  }
}

export async function readCachedRunEvents(runId: string) {
  const db = await database()
  return parseRows<AstraflowV1AgentRunEvent>(
    await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM cached_run_events WHERE run_id = ? ORDER BY seq",
      runId
    )
  )
}

export async function cacheRun(run: AstraflowV1AgentRun) {
  if (!run.id || !run.sessionId) return
  const db = await database()
  await db.runAsync(
    `INSERT INTO cached_runs (id, session_id, payload, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, payload = excluded.payload, updated_at = excluded.updated_at`,
    run.id,
    run.sessionId,
    JSON.stringify(run),
    updatedAt(run)
  )
}

export async function cacheAction(action: AstraflowV1AgentAction) {
  if (!action.id || !action.runId) return
  const db = await database()
  await db.runAsync(
    `INSERT INTO cached_actions (id, run_id, status, payload, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, payload = excluded.payload, updated_at = excluded.updated_at`,
    action.id,
    action.runId,
    action.status || "pending",
    JSON.stringify(action),
    new Date().toISOString()
  )
}

export async function cacheActions(actions: AstraflowV1AgentAction[]) {
  for (const action of actions) await cacheAction(action)
}

export async function readCachedActions(runId: string) {
  const db = await database()
  return parseRows<AstraflowV1AgentAction>(
    await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM cached_actions WHERE run_id = ? ORDER BY updated_at DESC",
      runId
    )
  )
}

export async function cacheArtifacts(artifacts: AstraflowV1Artifact[]) {
  const db = await database()
  for (const artifact of artifacts) {
    if (!artifact.id || !artifact.sessionId) continue
    await db.runAsync(
      `INSERT INTO cached_artifacts (id, session_id, run_id, payload, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET run_id = excluded.run_id, payload = excluded.payload, created_at = excluded.created_at`,
      artifact.id,
      artifact.sessionId,
      artifact.runId || "",
      JSON.stringify(artifact),
      artifact.createdAt || new Date().toISOString()
    )
  }
}

export async function readCachedArtifacts(sessionId: string) {
  const db = await database()
  return parseRows<AstraflowV1Artifact>(
    await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM cached_artifacts WHERE session_id = ? ORDER BY created_at DESC",
      sessionId
    )
  )
}

async function upsertProjection(
  table: "cached_sessions" | "cached_devices" | "cached_workspaces",
  payload: Record<string, unknown>
) {
  const id = typeof payload.id === "string" ? payload.id : ""
  if (!id) return
  const db = await database()
  const timestamp =
    typeof payload.updatedAt === "string"
      ? payload.updatedAt
      : new Date().toISOString()
  await db.runAsync(
    `INSERT INTO ${table} (id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    id,
    JSON.stringify(payload),
    timestamp
  )
}

export async function applySyncEvent(event: AstraflowV1SyncEventEnvelope) {
  const eventId = event.eventId
  const cursor = Number(event.cursor ?? 0)
  if (!eventId || cursor <= 0) return false
  const db = await database()
  const seen = await db.getFirstAsync<{ event_id: string }>(
    "SELECT event_id FROM sync_event_dedup WHERE event_id = ?",
    eventId
  )
  if (seen) {
    await setSyncCursor(cursor)
    return false
  }
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const normalized = camelizeKeys(payload) as Record<string, unknown>
  switch (event.aggregateType) {
    case "session":
      await upsertProjection("cached_sessions", normalized)
      break
    case "device":
      await upsertProjection("cached_devices", normalized)
      break
    case "workspace":
      await upsertProjection("cached_workspaces", normalized)
      break
    case "agent_run":
      await cacheRun(normalized as AstraflowV1AgentRun)
      break
    case "agent_action":
      await cacheAction(normalized as AstraflowV1AgentAction)
      break
    case "message":
      await cacheMessages(String(normalized.sessionId ?? ""), [
        normalized as AstraflowV1Message,
      ])
      break
    case "artifact":
      await cacheArtifacts([normalized as AstraflowV1Artifact])
      break
  }
  await db.runAsync(
    "INSERT INTO sync_event_dedup (event_id, cursor, received_at) VALUES (?, ?, ?)",
    eventId,
    cursor,
    new Date().toISOString()
  )
  await setSyncCursor(cursor)
  return true
}

export async function getSyncCursor() {
  const db = await database()
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM mobile_meta WHERE key = 'sync_cursor'"
  )
  return Number(row?.value ?? 0)
}

export async function setSyncCursor(cursor: number) {
  if (!Number.isFinite(cursor) || cursor < 0) return
  const db = await database()
  await db.runAsync(
    `INSERT INTO mobile_meta (key, value) VALUES ('sync_cursor', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    String(cursor)
  )
}

export async function readDraft(key: string) {
  const db = await database()
  return (
    (
      await db.getFirstAsync<{ prompt: string }>(
        "SELECT prompt FROM drafts WHERE key = ?",
        key
      )
    )?.prompt ?? ""
  )
}

export async function saveDraft(key: string, prompt: string) {
  const db = await database()
  if (!prompt.trim()) {
    await db.runAsync("DELETE FROM drafts WHERE key = ?", key)
    return
  }
  await db.runAsync(
    `INSERT INTO drafts (key, prompt, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET prompt = excluded.prompt, updated_at = excluded.updated_at`,
    key,
    prompt,
    new Date().toISOString()
  )
}

export type MobileOutboxItem = {
  id: string
  operation: string
  payload: Record<string, unknown>
  attempts: number
}

export async function enqueueOutbox(
  id: string,
  operation: string,
  payload: Record<string, unknown>
) {
  const db = await database()
  const now = new Date().toISOString()
  await db.runAsync(
    `INSERT OR IGNORE INTO mobile_outbox
      (id, operation, payload, next_attempt_at, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    id,
    operation,
    JSON.stringify(payload),
    now,
    now
  )
}

export async function claimOutbox() {
  const db = await database()
  const rows = await db.getAllAsync<{
    id: string
    operation: string
    payload: string
    attempts: number
  }>(
    `SELECT id, operation, payload, attempts FROM mobile_outbox
     WHERE status = 'pending' AND next_attempt_at <= ?
     ORDER BY created_at LIMIT 10`,
    new Date().toISOString()
  )
  return rows.flatMap((row) => {
    try {
      return [
        { ...row, payload: JSON.parse(row.payload) } satisfies MobileOutboxItem,
      ]
    } catch {
      return []
    }
  })
}

export async function completeOutbox(id: string) {
  const db = await database()
  await db.runAsync("DELETE FROM mobile_outbox WHERE id = ?", id)
}

export async function failOutbox(item: MobileOutboxItem, error: unknown) {
  const db = await database()
  const attempts = item.attempts + 1
  const retryAt = new Date(
    Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6))
  ).toISOString()
  await db.runAsync(
    `UPDATE mobile_outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?`,
    attempts,
    retryAt,
    error instanceof Error ? error.message.slice(0, 500) : "sync failed",
    item.id
  )
}
