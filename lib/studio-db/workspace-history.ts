import { randomUUID } from "node:crypto"

import type { StudioWorkspaceHistoryTurn } from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import { nowIso } from "./helpers"

type DbWorkspaceHistoryTurn = {
  id: string
  session_id: string
  assistant_message_id: string
  user_message_id: string | null
  project_path: string
  before_ref: string
  after_ref: string
  state: StudioWorkspaceHistoryTurn["state"]
  created_at: string
  updated_at: string
}

function mapWorkspaceHistoryTurn(
  row: DbWorkspaceHistoryTurn
): StudioWorkspaceHistoryTurn {
  return {
    id: row.id,
    sessionId: row.session_id,
    assistantMessageId: row.assistant_message_id,
    userMessageId: row.user_message_id,
    projectPath: row.project_path,
    beforeRef: row.before_ref,
    afterRef: row.after_ref,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const selectWorkspaceHistoryTurn = `
  SELECT id, session_id, assistant_message_id, user_message_id, project_path,
         before_ref, after_ref, state, created_at, updated_at
  FROM studio_workspace_history_turns
`

export function listStudioWorkspaceHistoryTurns(sessionId: string) {
  const rows = getDb()
    .prepare(
      `
        ${selectWorkspaceHistoryTurn}
        WHERE session_id = ?
          AND state != 'abandoned'
        ORDER BY created_at ASC, id ASC
      `
    )
    .all(sessionId) as DbWorkspaceHistoryTurn[]

  return rows.map(mapWorkspaceHistoryTurn)
}

export function getStudioWorkspaceHistoryTurn(
  sessionId: string,
  assistantMessageId: string
) {
  const row = getDb()
    .prepare(
      `
        ${selectWorkspaceHistoryTurn}
        WHERE session_id = ?
          AND assistant_message_id = ?
        LIMIT 1
      `
    )
    .get(sessionId, assistantMessageId) as DbWorkspaceHistoryTurn | undefined

  return row ? mapWorkspaceHistoryTurn(row) : null
}

export function recordStudioWorkspaceHistoryTurn({
  afterRef,
  assistantMessageId,
  beforeRef,
  projectPath,
  sessionId,
  userMessageId,
}: {
  afterRef: string
  assistantMessageId: string
  beforeRef: string
  projectPath: string
  sessionId: string
  userMessageId: string | null
}) {
  const timestamp = nowIso()
  const id = randomUUID()

  getDb()
    .prepare(
      `
        INSERT INTO studio_workspace_history_turns
          (id, session_id, assistant_message_id, user_message_id, project_path,
           before_ref, after_ref, state, created_at, updated_at)
        VALUES
          (@id, @sessionId, @assistantMessageId, @userMessageId, @projectPath,
           @beforeRef, @afterRef, 'active', @createdAt, @updatedAt)
        ON CONFLICT(assistant_message_id) DO UPDATE SET
          user_message_id = excluded.user_message_id,
          project_path = excluded.project_path,
          before_ref = excluded.before_ref,
          after_ref = excluded.after_ref,
          state = 'active',
          updated_at = excluded.updated_at
      `
    )
    .run({
      id,
      sessionId,
      assistantMessageId,
      userMessageId,
      projectPath,
      beforeRef,
      afterRef,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

  return getStudioWorkspaceHistoryTurn(sessionId, assistantMessageId)
}

export function abandonUndoneStudioWorkspaceHistoryTurns(sessionId: string) {
  const timestamp = nowIso()

  return getDb()
    .prepare(
      `
        UPDATE studio_workspace_history_turns
        SET state = 'abandoned',
            updated_at = ?
        WHERE session_id = ?
          AND state = 'undone'
      `
    )
    .run(timestamp, sessionId).changes
}

export function updateStudioWorkspaceHistoryAfterRef({
  afterRef,
  assistantMessageId,
  projectPath,
  sessionId,
}: {
  afterRef: string
  assistantMessageId: string
  projectPath: string
  sessionId: string
}) {
  const result = getDb()
    .prepare(
      `
        UPDATE studio_workspace_history_turns
        SET after_ref = ?,
            project_path = ?,
            updated_at = ?
        WHERE session_id = ?
          AND assistant_message_id = ?
          AND state = 'active'
      `
    )
    .run(afterRef, projectPath, nowIso(), sessionId, assistantMessageId)

  return result.changes > 0
}

function restoreVisibleAssistantVersion(
  database: ReturnType<typeof getDb>,
  assistantMessageId: string
) {
  const row = database
    .prepare(
      `
        SELECT session_id, version_group_id
        FROM studio_messages
        WHERE id = ?
          AND role = 'assistant'
      `
    )
    .get(assistantMessageId) as
    | { session_id: string; version_group_id: string | null }
    | undefined

  if (!row?.version_group_id) {
    return
  }

  database
    .prepare(
      `
        UPDATE studio_messages
        SET active_version = CASE
          WHEN id = (
            SELECT id
            FROM studio_messages
            WHERE session_id = ?
              AND role = 'assistant'
              AND version_group_id = ?
              AND visible = 1
            ORDER BY version_index DESC, created_at DESC
            LIMIT 1
          ) THEN 1
          ELSE 0
        END
        WHERE session_id = ?
          AND role = 'assistant'
          AND version_group_id = ?
      `
    )
    .run(
      row.session_id,
      row.version_group_id,
      row.session_id,
      row.version_group_id
    )
}

export function markStudioWorkspaceHistoryUndone(
  sessionId: string,
  assistantMessageIds: string[]
) {
  if (assistantMessageIds.length === 0) {
    return
  }

  const database = getDb()
  const timestamp = nowIso()
  const placeholders = assistantMessageIds.map(() => "?").join(", ")

  database.transaction(() => {
    const affected = database
      .prepare(
        `
          SELECT assistant_message_id, user_message_id
          FROM studio_workspace_history_turns
          WHERE session_id = ?
            AND assistant_message_id IN (${placeholders})
            AND state = 'active'
        `
      )
      .all(sessionId, ...assistantMessageIds) as Array<{
      assistant_message_id: string
      user_message_id: string | null
    }>

    database
      .prepare(
        `
          UPDATE studio_workspace_history_turns
          SET state = 'undone',
              updated_at = ?
          WHERE session_id = ?
            AND assistant_message_id IN (${placeholders})
            AND state = 'active'
        `
      )
      .run(timestamp, sessionId, ...assistantMessageIds)

    for (const turn of affected) {
      database
        .prepare("UPDATE studio_messages SET visible = 0 WHERE id = ?")
        .run(turn.assistant_message_id)

      if (turn.user_message_id) {
        const stillActive = database
          .prepare(
            `
              SELECT 1
              FROM studio_workspace_history_turns
              WHERE session_id = ?
                AND user_message_id = ?
                AND state = 'active'
              LIMIT 1
            `
          )
          .get(sessionId, turn.user_message_id)

        if (!stillActive) {
          database
            .prepare("UPDATE studio_messages SET visible = 0 WHERE id = ?")
            .run(turn.user_message_id)
        }
      }

      restoreVisibleAssistantVersion(database, turn.assistant_message_id)
    }

    database
      .prepare("UPDATE studio_sessions SET updated_at = ? WHERE id = ?")
      .run(timestamp, sessionId)
  })()
}

export function markStudioWorkspaceHistoryRedone(
  sessionId: string,
  assistantMessageId: string
) {
  const database = getDb()
  const timestamp = nowIso()

  database.transaction(() => {
    const turn = database
      .prepare(
        `
          SELECT assistant_message_id, user_message_id
          FROM studio_workspace_history_turns
          WHERE session_id = ?
            AND assistant_message_id = ?
            AND state = 'undone'
        `
      )
      .get(sessionId, assistantMessageId) as
      | { assistant_message_id: string; user_message_id: string | null }
      | undefined

    if (!turn) {
      throw new Error("Workspace history turn is not available to redo.")
    }

    database
      .prepare(
        `
          UPDATE studio_workspace_history_turns
          SET state = 'active',
              updated_at = ?
          WHERE session_id = ?
            AND assistant_message_id = ?
        `
      )
      .run(timestamp, sessionId, assistantMessageId)

    if (turn.user_message_id) {
      database
        .prepare("UPDATE studio_messages SET visible = 1 WHERE id = ?")
        .run(turn.user_message_id)
    }

    database
      .prepare("UPDATE studio_messages SET visible = 1 WHERE id = ?")
      .run(turn.assistant_message_id)
    restoreVisibleAssistantVersion(database, turn.assistant_message_id)

    database
      .prepare("UPDATE studio_sessions SET updated_at = ? WHERE id = ?")
      .run(timestamp, sessionId)
  })()
}
