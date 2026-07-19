import type Database from "better-sqlite3"
import { randomUUID } from "node:crypto"

import { getStudioDatabase as getDb } from "./connection"
import { nowIso } from "./helpers"

export type StudioSyncEntityType =
  "workspace" | "session" | "message" | "agent_run_event"

export type StudioSyncOperation = "create" | "update" | "append"

export type StudioSyncOutboxItem = {
  id: string
  entityType: StudioSyncEntityType
  entityId: string
  operation: StudioSyncOperation
  payload: Record<string, unknown>
  attempts: number
  createdAt: string
}

type StudioSyncOutboxRow = {
  id: string
  entity_type: StudioSyncEntityType
  entity_id: string
  operation: StudioSyncOperation
  payload: string
  attempts: number
  created_at: string
}

export function enqueueStudioSyncMutation(
  database: Database.Database,
  input: {
    id?: string
    entityType: StudioSyncEntityType
    entityId: string
    operation: StudioSyncOperation
    payload: Record<string, unknown>
    createdAt?: string
  }
) {
  const id = input.id ?? randomUUID()
  const createdAt = input.createdAt ?? nowIso()
  database
    .prepare(
      `
        INSERT INTO studio_sync_outbox (
          id, entity_type, entity_id, operation, payload, status,
          attempts, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `
    )
    .run(
      id,
      input.entityType,
      input.entityId,
      input.operation,
      JSON.stringify(input.payload),
      createdAt,
      createdAt,
      createdAt
    )
  return id
}

export function claimStudioSyncOutbox(limit = 25): StudioSyncOutboxItem[] {
  const database = getDb()
  const now = nowIso()
  const staleBefore = new Date(Date.now() - 2 * 60_000).toISOString()
  return database.transaction(() => {
    database
      .prepare(
        `
          UPDATE studio_sync_outbox
          SET status = 'pending', next_attempt_at = ?, updated_at = ?
          WHERE status = 'processing' AND updated_at < ?
        `
      )
      .run(now, now, staleBefore)

    const rows = database
      .prepare(
        `
          SELECT id, entity_type, entity_id, operation, payload, attempts, created_at
          FROM studio_sync_outbox
          WHERE status = 'pending' AND next_attempt_at <= ?
          ORDER BY created_at, rowid
          LIMIT ?
        `
      )
      .all(now, Math.max(1, Math.min(limit, 100))) as StudioSyncOutboxRow[]

    const markProcessing = database.prepare(
      `
        UPDATE studio_sync_outbox
        SET status = 'processing', attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND status = 'pending'
      `
    )
    const claimed: StudioSyncOutboxItem[] = []
    for (const row of rows) {
      if (markProcessing.run(now, row.id).changes === 0) continue
      claimed.push({
        id: row.id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        operation: row.operation,
        payload: parsePayload(row.payload),
        attempts: row.attempts + 1,
        createdAt: row.created_at,
      })
    }
    return claimed
  })()
}

export function acknowledgeStudioSyncOutbox(
  id: string,
  entityType: StudioSyncEntityType,
  entityId: string,
  serverVersion?: number
) {
  const database = getDb()
  const timestamp = nowIso()
  database.transaction(() => {
    database
      .prepare(
        `
          UPDATE studio_sync_outbox
          SET status = 'acknowledged', last_error = NULL, updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, id)
    if (entityType === "session") {
      database
        .prepare(
          `
            UPDATE studio_sessions
            SET cloud_version = CASE WHEN ? IS NULL THEN cloud_version ELSE ? END,
                cloud_synced_at = ?
            WHERE id = ?
          `
        )
        .run(serverVersion ?? null, serverVersion ?? null, timestamp, entityId)
    } else if (entityType === "workspace") {
      database
        .prepare(
          `UPDATE studio_workspaces SET cloud_synced_at = ? WHERE id = ?`
        )
        .run(timestamp, entityId)
    } else if (entityType === "message") {
      database
        .prepare(`UPDATE studio_messages SET cloud_synced_at = ? WHERE id = ?`)
        .run(timestamp, entityId)
    }
  })()
}

export function failStudioSyncOutbox(
  item: Pick<StudioSyncOutboxItem, "id" | "attempts">,
  error: unknown
) {
  const attempts = item.attempts
  const terminal = attempts >= 10
  const delayMs = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempts, 8))
  const timestamp = nowIso()
  getDb()
    .prepare(
      `
        UPDATE studio_sync_outbox
        SET status = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      terminal ? "failed" : "pending",
      new Date(Date.now() + delayMs).toISOString(),
      errorMessage(error).slice(0, 2000),
      timestamp,
      item.id
    )
}

export function getStudioSyncCursor(streamKey = "account") {
  const row = getDb()
    .prepare(`SELECT cursor FROM studio_sync_cursors WHERE stream_key = ?`)
    .get(streamKey) as { cursor: number } | undefined
  return row?.cursor ?? 0
}

export function setStudioSyncCursor(
  database: Database.Database,
  cursor: number,
  streamKey = "account"
) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("Sync cursor is invalid.")
  }
  database
    .prepare(
      `
        INSERT INTO studio_sync_cursors (stream_key, cursor, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(stream_key) DO UPDATE SET
          cursor = excluded.cursor,
          updated_at = excluded.updated_at
      `
    )
    .run(streamKey, cursor, nowIso())
}

export function recordStudioSyncEvent(
  database: Database.Database,
  input: { eventId: string; cursor: number; streamKey?: string }
) {
  const timestamp = nowIso()
  const inserted = database
    .prepare(
      `
        INSERT INTO studio_sync_inbox_dedup (event_id, cursor, applied_at)
        VALUES (?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
      `
    )
    .run(input.eventId, input.cursor, timestamp)
  if (inserted.changes === 0) return false
  database
    .prepare(
      `
        INSERT INTO studio_sync_cursors (stream_key, cursor, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(stream_key) DO UPDATE SET
          cursor = MAX(studio_sync_cursors.cursor, excluded.cursor),
          updated_at = excluded.updated_at
      `
    )
    .run(input.streamKey ?? "account", input.cursor, timestamp)
  return true
}

export function hasProcessedDeviceCommand(commandId: string) {
  return Boolean(
    getDb()
      .prepare(`SELECT 1 FROM studio_device_command_dedup WHERE command_id = ?`)
      .get(commandId)
  )
}

export function getDeviceCommandResult(commandId: string) {
  const row = getDb()
    .prepare(
      `SELECT status, result FROM studio_device_command_dedup WHERE command_id = ?`
    )
    .get(commandId) as { status: string; result: string } | undefined
  if (!row) return null
  return { status: row.status, result: parsePayload(row.result) }
}

export function recordDeviceCommandResult(
  commandId: string,
  status: "received" | "running" | "completed" | "failed",
  result: Record<string, unknown> = {}
) {
  const timestamp = nowIso()
  getDb()
    .prepare(
      `
        INSERT INTO studio_device_command_dedup (
          command_id, status, result, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(command_id) DO UPDATE SET
          status = excluded.status, result = excluded.result, updated_at = excluded.updated_at
      `
    )
    .run(commandId, status, JSON.stringify(result), timestamp, timestamp)
}

const blockedSyncKeys = new Set([
  "authorization",
  "cwd",
  "env",
  "environmentVariables",
  "filePath",
  "path",
  "raw",
  "reasoning",
  "reasoningContent",
  "rootPath",
  "secret",
  "storagePath",
  "token",
])

export function sanitizeForCrossDeviceSync(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeForCrossDeviceSync)
  }
  if (typeof value !== "object" || value === null) {
    return value
  }
  const output: Record<string, unknown> = {}
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (blockedSyncKeys.has(key) || /(?:token|secret|password)$/i.test(key)) {
      continue
    }
    output[key] = sanitizeForCrossDeviceSync(nested)
  }
  return output
}

function parsePayload(raw: string) {
  try {
    const value = JSON.parse(raw) as unknown
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    // The row will fail visibly in the coordinator and enter retry handling.
  }
  return {}
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
