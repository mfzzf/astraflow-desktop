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
