import { randomUUID } from "node:crypto"

import type { StudioAgentProviderEvent } from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import {
  mapAgentProviderEvent,
  nowIso,
  stringifyProviderEventPayload,
} from "./helpers"
import type {
  DbAgentProviderEventRow,
  ListAgentProviderEventsInput,
  RecordAgentProviderEventInput,
} from "./types"

export const STUDIO_ACP_SESSION_SELECTED_EVENT = "session_resume_selected"

type DbProviderSessionSelectionRow = {
  payload: string
  provider_session_id: string
  runtime_id: string
  session_id: string
}

function parseProviderSessionSelection(
  row: DbProviderSessionSelectionRow | undefined
) {
  if (!row) {
    return null
  }

  try {
    const payload = JSON.parse(row.payload) as unknown

    if (typeof payload !== "object" || payload === null) {
      return null
    }

    const value = payload as Record<string, unknown>
    const cwd = typeof value.cwd === "string" ? value.cwd.trim() : ""
    const sourceStudioSessionId =
      typeof value.sourceStudioSessionId === "string"
        ? value.sourceStudioSessionId.trim()
        : ""
    const stateOwnerStudioSessionId =
      typeof value.stateOwnerStudioSessionId === "string"
        ? value.stateOwnerStudioSessionId.trim()
        : sourceStudioSessionId

    if (!cwd || !sourceStudioSessionId || !stateOwnerStudioSessionId) {
      return null
    }

    return {
      studioSessionId: row.session_id,
      runtimeId: row.runtime_id,
      providerSessionId: row.provider_session_id,
      cwd,
      sourceStudioSessionId,
      stateOwnerStudioSessionId,
    }
  } catch {
    return null
  }
}

export function recordStudioAgentProviderEvent({
  id = randomUUID(),
  sessionId,
  runId = null,
  assistantMessageId = null,
  runtimeId,
  provider,
  direction,
  eventType,
  providerRef = null,
  providerSessionId = null,
  threadId = null,
  turnId = null,
  itemId = null,
  parentThreadId = null,
  schemaVersion = null,
  packageVersion = null,
  payload,
}: RecordAgentProviderEventInput): StudioAgentProviderEvent {
  const createdAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_agent_provider_events
          (id, session_id, run_id, assistant_message_id, runtime_id, provider,
           direction, event_type, provider_ref, provider_session_id, thread_id,
           turn_id, item_id, parent_thread_id, schema_version, package_version,
           payload, created_at)
        VALUES
          (@id, @sessionId, @runId, @assistantMessageId, @runtimeId, @provider,
           @direction, @eventType, @providerRef, @providerSessionId, @threadId,
           @turnId, @itemId, @parentThreadId, @schemaVersion, @packageVersion,
           @payload, @createdAt)
      `
    )
    .run({
      id,
      sessionId,
      runId,
      assistantMessageId,
      runtimeId,
      provider,
      direction,
      eventType,
      providerRef,
      providerSessionId,
      threadId,
      turnId,
      itemId,
      parentThreadId,
      schemaVersion,
      packageVersion,
      payload: stringifyProviderEventPayload(payload),
      createdAt,
    })

  return {
    id,
    sessionId,
    runId,
    assistantMessageId,
    runtimeId,
    provider,
    direction,
    eventType,
    providerRef,
    providerSessionId,
    threadId,
    turnId,
    itemId,
    parentThreadId,
    schemaVersion,
    packageVersion,
    payload,
    createdAt,
  }
}

export function listStudioAgentProviderEvents({
  sessionId,
  runId = null,
  runtimeId = null,
  limit = 500,
}: ListAgentProviderEventsInput): StudioAgentProviderEvent[] {
  const normalizedLimit = Math.min(Math.max(limit, 1), 5_000)
  const clauses = ["session_id = ?"]
  const params: unknown[] = [sessionId]

  if (runId) {
    clauses.push("run_id = ?")
    params.push(runId)
  }

  if (runtimeId) {
    clauses.push("runtime_id = ?")
    params.push(runtimeId)
  }

  const rows = getDb()
    .prepare(
      `
        SELECT id, session_id, run_id, assistant_message_id, runtime_id,
               provider, direction, event_type, provider_ref,
               provider_session_id, thread_id, turn_id, item_id,
               parent_thread_id, schema_version, package_version, payload,
               created_at
        FROM studio_agent_provider_events
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at ASC
        LIMIT ?
      `
    )
    .all(...params, normalizedLimit) as DbAgentProviderEventRow[]

  return rows.map(mapAgentProviderEvent)
}

export function getLatestStudioAcpSessionSelection(
  sessionId: string,
  runtimeId?: string
) {
  const clauses = [
    "session_id = ?",
    "event_type = ?",
    "provider_session_id IS NOT NULL",
    "provider_session_id != ''",
  ]
  const params: string[] = [sessionId, STUDIO_ACP_SESSION_SELECTED_EVENT]

  if (runtimeId) {
    clauses.push("runtime_id = ?")
    params.push(runtimeId)
  }

  const row = getDb()
    .prepare(
      `
        SELECT session_id, runtime_id, provider_session_id, payload
        FROM studio_agent_provider_events
        WHERE ${clauses.join(" AND ")}
        ORDER BY created_at DESC, rowid DESC
        LIMIT 1
      `
    )
    .get(...params) as DbProviderSessionSelectionRow | undefined

  return parseProviderSessionSelection(row)
}

export function findStudioSessionIdByAgentProviderSession(
  runtimeId: string,
  providerSessionId: string
) {
  const row = getDb()
    .prepare(
      `
        SELECT events.session_id
        FROM studio_agent_provider_events AS events
        INNER JOIN studio_sessions AS sessions
          ON sessions.id = events.session_id
        WHERE events.runtime_id = ?
          AND events.provider_session_id = ?
          AND sessions.archived_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM studio_scheduled_task_runs AS scheduled_runs
            WHERE scheduled_runs.session_id = sessions.id
          )
        ORDER BY events.created_at DESC, events.rowid DESC
        LIMIT 1
      `
    )
    .get(runtimeId, providerSessionId) as { session_id: string } | undefined

  return row?.session_id ?? null
}

export function countOtherStudioSessionsForAgentProviderSession(
  runtimeId: string,
  providerSessionId: string,
  excludedStudioSessionId: string
) {
  const row = getDb()
    .prepare(
      `
        SELECT COUNT(DISTINCT events.session_id) AS count
        FROM studio_agent_provider_events AS events
        INNER JOIN studio_sessions AS sessions
          ON sessions.id = events.session_id
        WHERE events.runtime_id = ?
          AND events.provider_session_id = ?
          AND events.session_id != ?
      `
    )
    .get(runtimeId, providerSessionId, excludedStudioSessionId) as
    | { count: number }
    | undefined

  return row?.count ?? 0
}
