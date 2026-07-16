import { getStudioDatabase as getDb } from "./connection"
import { nowIso } from "./helpers"

export type StudioSessionCompaction = {
  sessionId: string
  runtimeId: string
  summary: string
  firstKeptMessageId: string
  throughMessageId: string
  tokensBefore: number
  estimatedTokensAfter: number | null
  createdAt: string
  updatedAt: string
}

type DbStudioSessionCompactionRow = {
  session_id: string
  runtime_id: string
  summary: string
  first_kept_message_id: string
  through_message_id: string
  tokens_before: number
  estimated_tokens_after: number | null
  created_at: string
  updated_at: string
}

function mapStudioSessionCompaction(
  row: DbStudioSessionCompactionRow
): StudioSessionCompaction {
  return {
    sessionId: row.session_id,
    runtimeId: row.runtime_id,
    summary: row.summary,
    firstKeptMessageId: row.first_kept_message_id,
    throughMessageId: row.through_message_id,
    tokensBefore: row.tokens_before,
    estimatedTokensAfter: row.estimated_tokens_after,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getStudioSessionCompaction(sessionId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT
          session_id,
          runtime_id,
          summary,
          first_kept_message_id,
          through_message_id,
          tokens_before,
          estimated_tokens_after,
          created_at,
          updated_at
        FROM studio_session_compactions
        WHERE session_id = ?
      `
    )
    .get(sessionId) as DbStudioSessionCompactionRow | undefined

  return row ? mapStudioSessionCompaction(row) : null
}

export function upsertStudioSessionCompaction(
  input: Omit<StudioSessionCompaction, "createdAt" | "updatedAt">
) {
  const now = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_session_compactions (
          session_id,
          runtime_id,
          summary,
          first_kept_message_id,
          through_message_id,
          tokens_before,
          estimated_tokens_after,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          runtime_id = excluded.runtime_id,
          summary = excluded.summary,
          first_kept_message_id = excluded.first_kept_message_id,
          through_message_id = excluded.through_message_id,
          tokens_before = excluded.tokens_before,
          estimated_tokens_after = excluded.estimated_tokens_after,
          updated_at = excluded.updated_at
      `
    )
    .run(
      input.sessionId,
      input.runtimeId,
      input.summary,
      input.firstKeptMessageId,
      input.throughMessageId,
      input.tokensBefore,
      input.estimatedTokensAfter,
      now,
      now
    )

  return getStudioSessionCompaction(input.sessionId)
}

export function clearStudioSessionCompaction(sessionId: string) {
  return (
    getDb()
      .prepare(
        `
          DELETE FROM studio_session_compactions
          WHERE session_id = ?
        `
      )
      .run(sessionId).changes > 0
  )
}
