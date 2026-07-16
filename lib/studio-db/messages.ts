import { randomUUID } from "node:crypto"

import type { PromptMention } from "@/lib/agent/composer-types"
import type { StudioAttachment, StudioMessage } from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import { mapMessage, nowIso } from "./helpers"
import type {
  CreateMessageInput,
  DbMessageRow,
  UpdateMessageSnapshotInput,
} from "./types"

export function listStudioMessages(sessionId: string) {
  const rows = getDb()
    .prepare(
      `
        SELECT
          message.id,
          message.session_id,
          message.role,
          message.content,
          message.mentions,
          message.model,
          message.environment,
          message.version_group_id,
          message.version_index,
          CASE
            WHEN message.version_group_id IS NULL THEN 1
            ELSE (
              SELECT COUNT(*)
              FROM studio_messages AS version
              WHERE version.session_id = message.session_id
                AND version.role = 'assistant'
                AND version.version_group_id = message.version_group_id
                AND version.visible = 1
            )
          END AS version_count,
          message.active_version,
          message.visible,
          EXISTS (
            SELECT 1
            FROM studio_workspace_history_turns AS history
            WHERE history.assistant_message_id = message.id
              AND history.state = 'active'
          ) AS rewind_available,
          message.activities,
          message.parts,
          message.reasoning_content,
          message.reasoning_duration_ms,
          message.status,
          message.attachments,
          message.created_at
        FROM studio_messages AS message
        WHERE message.session_id = ?
          AND message.visible = 1
          AND (
            message.role != 'assistant'
            OR message.active_version = 1
          )
        ORDER BY
          CASE
            WHEN message.version_group_id IS NULL THEN message.created_at
            ELSE (
              SELECT MIN(version.created_at)
              FROM studio_messages AS version
              WHERE version.session_id = message.session_id
                AND version.role = 'assistant'
                AND version.version_group_id = message.version_group_id
            )
          END ASC,
          message.created_at ASC
      `
    )
    .all(sessionId) as DbMessageRow[]

  return rows.map(mapMessage)
}

export function listStudioMessageVersions(
  sessionId: string,
  versionGroupId: string
) {
  const rows = getDb()
    .prepare(
      `
        SELECT
          message.id,
          message.session_id,
          message.role,
          message.content,
          message.mentions,
          message.model,
          message.environment,
          message.version_group_id,
          message.version_index,
          CASE
            WHEN message.version_group_id IS NULL THEN 1
            ELSE (
              SELECT COUNT(*)
              FROM studio_messages AS version
              WHERE version.session_id = message.session_id
                AND version.role = 'assistant'
                AND version.version_group_id = message.version_group_id
                AND version.visible = 1
            )
          END AS version_count,
          message.active_version,
          message.visible,
          EXISTS (
            SELECT 1
            FROM studio_workspace_history_turns AS history
            WHERE history.assistant_message_id = message.id
              AND history.state = 'active'
          ) AS rewind_available,
          message.activities,
          message.parts,
          message.reasoning_content,
          message.reasoning_duration_ms,
          message.status,
          message.attachments,
          message.created_at
        FROM studio_messages AS message
        WHERE message.session_id = ?
          AND message.role = 'assistant'
          AND message.visible = 1
          AND (
            message.version_group_id = ?
            OR message.id = ?
          )
        ORDER BY message.version_index ASC, message.created_at ASC
      `
    )
    .all(sessionId, versionGroupId, versionGroupId) as DbMessageRow[]

  return rows.map(mapMessage)
}

export function getStudioMessage(messageId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT
          message.id,
          message.session_id,
          message.role,
          message.content,
          message.mentions,
          message.model,
          message.environment,
          message.version_group_id,
          message.version_index,
          CASE
            WHEN message.version_group_id IS NULL THEN 1
            ELSE (
              SELECT COUNT(*)
              FROM studio_messages AS version
              WHERE version.session_id = message.session_id
                AND version.role = 'assistant'
                AND version.version_group_id = message.version_group_id
                AND version.visible = 1
            )
          END AS version_count,
          message.active_version,
          message.visible,
          EXISTS (
            SELECT 1
            FROM studio_workspace_history_turns AS history
            WHERE history.assistant_message_id = message.id
              AND history.state = 'active'
          ) AS rewind_available,
          message.activities,
          message.parts,
          message.reasoning_content,
          message.reasoning_duration_ms,
          message.status,
          message.attachments,
          message.created_at
        FROM studio_messages AS message
        WHERE message.id = ?
      `
    )
    .get(messageId) as DbMessageRow | undefined

  return row ? mapMessage(row) : null
}

export function createStudioMessage({
  id,
  sessionId,
  role,
  content,
  mentions = [],
  model = null,
  environment = null,
  versionGroupId = null,
  replacesMessageId = null,
  activities = [],
  parts = [],
  reasoningContent = "",
  reasoningDurationMs = null,
  status = "complete",
  attachments = [],
}: CreateMessageInput) {
  const database = getDb()
  const createdAt = nowIso()
  const messageId = id ?? randomUUID()

  const createMessageTransaction = database.transaction(() => {
    let resolvedVersionGroupId: string | null = null
    let versionIndex = 1

    if (role === "assistant") {
      const replacement = replacesMessageId
        ? (database
            .prepare(
              `
                SELECT id, version_group_id
                FROM studio_messages
                WHERE id = ?
                  AND session_id = ?
                  AND role = 'assistant'
              `
            )
            .get(replacesMessageId, sessionId) as
            { id: string; version_group_id: string | null } | undefined)
        : undefined

      resolvedVersionGroupId =
        replacement?.version_group_id ?? versionGroupId ?? messageId

      if (replacement && !replacement.version_group_id) {
        database
          .prepare(
            `
              UPDATE studio_messages
              SET version_group_id = ?,
                  version_index = 1
              WHERE id = ?
            `
          )
          .run(resolvedVersionGroupId, replacement.id)
      }

      if (replacesMessageId || versionGroupId) {
        database
          .prepare(
            `
              UPDATE studio_messages
              SET active_version = 0
              WHERE session_id = ?
                AND role = 'assistant'
                AND version_group_id = ?
            `
          )
          .run(sessionId, resolvedVersionGroupId)
      }

      const latestVersion = database
        .prepare(
          `
            SELECT MAX(version_index) AS version_index
            FROM studio_messages
            WHERE session_id = ?
              AND role = 'assistant'
              AND version_group_id = ?
          `
        )
        .get(sessionId, resolvedVersionGroupId) as
        { version_index: number | null } | undefined

      versionIndex =
        typeof latestVersion?.version_index === "number"
          ? latestVersion.version_index + 1
          : 1
    }

    const message: StudioMessage = {
      id: messageId,
      sessionId,
      role,
      content,
      mentions,
      model,
      environment,
      versionGroupId: resolvedVersionGroupId,
      versionIndex,
      versionCount: versionIndex,
      isActiveVersion: true,
      rewindAvailable: false,
      activities,
      parts,
      reasoningContent,
      reasoningDurationMs,
      status,
      attachments,
      createdAt,
    }

    database
      .prepare(
        `
          INSERT INTO studio_messages
            (
              id,
              session_id,
              role,
              content,
              mentions,
              model,
              environment,
              version_group_id,
              version_index,
              active_version,
              visible,
              activities,
              parts,
              reasoning_content,
              reasoning_duration_ms,
              status,
              attachments,
              created_at
            )
          VALUES
            (
              @id,
              @sessionId,
              @role,
              @content,
              @mentions,
              @model,
              @environment,
              @versionGroupId,
              @versionIndex,
              1,
              1,
              @activities,
              @parts,
              @reasoningContent,
              @reasoningDurationMs,
              @status,
              @attachments,
              @createdAt
            )
        `
      )
      .run({
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        mentions: mentions.length ? JSON.stringify(mentions) : null,
        model: message.model,
        environment: message.environment,
        versionGroupId: message.versionGroupId,
        versionIndex: message.versionIndex,
        activities: activities.length ? JSON.stringify(activities) : null,
        parts: parts.length ? JSON.stringify(parts) : null,
        reasoningContent: message.reasoningContent,
        reasoningDurationMs: message.reasoningDurationMs,
        status: message.status,
        attachments: attachments.length ? JSON.stringify(attachments) : null,
        createdAt: message.createdAt,
      })

    database
      .prepare(
        `
          UPDATE studio_sessions
          SET updated_at = ?
          WHERE id = ?
        `
      )
      .run(createdAt, sessionId)

    return message
  })

  return createMessageTransaction()
}

export function updateStudioMessageMentions(
  messageId: string,
  mentions: PromptMention[]
) {
  getDb()
    .prepare(
      `
        UPDATE studio_messages
        SET mentions = ?
        WHERE id = ?
      `
    )
    .run(mentions.length ? JSON.stringify(mentions) : null, messageId)
}

export function updateStudioMessageSnapshot({
  messageId,
  sessionId,
  content,
  activities,
  parts,
  reasoningContent,
  reasoningDurationMs,
  status,
}: UpdateMessageSnapshotInput) {
  const database = getDb()
  const current = getStudioMessage(messageId)

  if (!current || (sessionId && current.sessionId !== sessionId)) {
    return null
  }

  const nextContent = content ?? current.content
  const nextActivities = activities ?? current.activities
  const nextParts = parts ?? current.parts
  const nextReasoningContent = reasoningContent ?? current.reasoningContent
  const nextReasoningDurationMs =
    reasoningDurationMs === undefined
      ? current.reasoningDurationMs
      : reasoningDurationMs
  const nextStatus = status ?? current.status
  const updatedAt = nowIso()

  const updateTransaction = database.transaction(() => {
    database
      .prepare(
        `
          UPDATE studio_messages
          SET content = ?,
              activities = ?,
              parts = ?,
              reasoning_content = ?,
              reasoning_duration_ms = ?,
              status = ?
          WHERE id = ?
        `
      )
      .run(
        nextContent,
        nextActivities.length ? JSON.stringify(nextActivities) : null,
        nextParts.length ? JSON.stringify(nextParts) : null,
        nextReasoningContent,
        nextReasoningDurationMs,
        nextStatus,
        messageId
      )

    database
      .prepare(
        `
          UPDATE studio_sessions
          SET updated_at = ?
          WHERE id = ?
        `
      )
      .run(updatedAt, current.sessionId)

    // When a retry finalizes to an empty error, the newly created version has
    // already hidden the previous answer (active_version = 0 for the group).
    // Fall back to the most recent complete version so a working answer is not
    // replaced by a blank failure.
    if (
      nextStatus === "error" &&
      current.role === "assistant" &&
      current.versionGroupId &&
      nextContent.trim().length === 0
    ) {
      const fallback = database
        .prepare(
          `
            SELECT id
            FROM studio_messages
            WHERE session_id = ?
              AND role = 'assistant'
              AND version_group_id = ?
              AND id != ?
              AND status = 'complete'
            ORDER BY version_index DESC
            LIMIT 1
          `
        )
        .get(current.sessionId, current.versionGroupId, messageId) as
        { id: string } | undefined

      if (fallback) {
        database
          .prepare(
            `
              UPDATE studio_messages
              SET active_version = 0
              WHERE session_id = ?
                AND role = 'assistant'
                AND version_group_id = ?
            `
          )
          .run(current.sessionId, current.versionGroupId)

        database
          .prepare(
            `
              UPDATE studio_messages
              SET active_version = 1
              WHERE id = ?
            `
          )
          .run(fallback.id)
      }
    }
  })

  updateTransaction()

  return getStudioMessage(messageId)
}

export function updateStudioMessageAttachments(
  messageId: string,
  attachments: StudioAttachment[]
) {
  getDb()
    .prepare(
      `
        UPDATE studio_messages
        SET attachments = ?
        WHERE id = ?
      `
    )
    .run(attachments.length ? JSON.stringify(attachments) : null, messageId)
}
