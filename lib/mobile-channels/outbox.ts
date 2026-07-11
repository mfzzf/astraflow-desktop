import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"

import { getStudioDatabase } from "@/lib/studio-db"
import {
  decryptSettingValue,
  encryptSettingValue,
} from "@/lib/studio-db/helpers"

import type {
  MobileChannelOutboundFile,
  MobileChannelOutboundImage,
  MobileChannelOutboundVideo,
} from "./adapter"
import type { MobileChannelOutboundTarget } from "./types"

export type MobileChannelOutboxPayload =
  | { kind: "text"; text: string }
  | { kind: "image"; image: MobileChannelOutboundImage }
  | { kind: "video"; video: MobileChannelOutboundVideo }
  | { kind: "file"; file: MobileChannelOutboundFile }

export type MobileChannelOutboxRecord = {
  id: string
  connectionId: string
  kind: MobileChannelOutboxPayload["kind"]
  target: MobileChannelOutboundTarget
  textContent: string | null
  filePath: string | null
  fileName: string | null
  mimeType: string | null
  durationSeconds: number | null
  attempts: number
}

type MobileChannelOutboxRow = {
  id: string
  connection_id: string
  kind: string
  target: string
  text_content: string | null
  file_path: string | null
  file_name: string | null
  mime_type: string | null
  duration_seconds: number | null
  attempts: number
}

const MOBILE_CHANNEL_OUTBOX_MAX_RETRY_DELAY_MS = 5 * 60_000

function nowIso() {
  return new Date().toISOString()
}

function outboxDirectory() {
  const filesRoot = process.env.ASTRAFLOW_STUDIO_FILES_PATH
  if (filesRoot) {
    return join(filesRoot, "mobile-outbox")
  }

  const sqlitePath = process.env.ASTRAFLOW_SQLITE_PATH
  return join(sqlitePath ? dirname(sqlitePath) : join(process.cwd(), ".data"), "mobile-outbox")
}

export function storedMobileChannelOutboxTarget(
  target: MobileChannelOutboundTarget
) {
  return {
    connectionId: target.connectionId,
    provider: target.provider,
    externalUserId: target.externalUserId,
    conversationId: target.conversationId,
    replyContext: target.replyContext,
    ...(target.runId ? { runId: target.runId } : {}),
  }
}

function serializeTarget(target: MobileChannelOutboundTarget) {
  return encryptSettingValue(
    JSON.stringify(storedMobileChannelOutboxTarget(target))
  )
}

function parseTarget(value: string) {
  return JSON.parse(
    decryptSettingValue(value)
  ) as MobileChannelOutboundTarget
}

function mapRow(row: MobileChannelOutboxRow): MobileChannelOutboxRecord {
  return {
    id: row.id,
    connectionId: row.connection_id,
    kind: row.kind as MobileChannelOutboxPayload["kind"],
    target: parseTarget(row.target),
    textContent: row.text_content,
    filePath: row.file_path,
    fileName: row.file_name,
    mimeType: row.mime_type,
    durationSeconds: row.duration_seconds,
    attempts: row.attempts,
  }
}

function mediaPayload(payload: MobileChannelOutboxPayload) {
  switch (payload.kind) {
    case "image":
      return payload.image
    case "video":
      return payload.video
    case "file":
      return payload.file
    case "text":
      return null
  }
}

export async function enqueueMobileChannelOutbox({
  target,
  payload,
}: {
  target: MobileChannelOutboundTarget
  payload: MobileChannelOutboxPayload
}) {
  const id = randomUUID()
  const timestamp = nowIso()
  const media = mediaPayload(payload)
  let filePath: string | null = null

  if (media) {
    const directory = outboxDirectory()
    await mkdir(directory, { recursive: true })
    filePath = join(directory, `${id}.payload`)
    await writeFile(filePath, media.buffer, { flag: "wx" })
  }

  try {
    getStudioDatabase()
      .prepare(
        `
          INSERT INTO mobile_channel_outbox (
            id, connection_id, external_user_id, conversation_id, kind,
            target, text_content, file_path, file_name, mime_type,
            duration_seconds, attempts, next_attempt_at, last_error,
            created_at, updated_at
          ) VALUES (
            @id, @connectionId, @externalUserId, @conversationId, @kind,
            @target, @textContent, @filePath, @fileName, @mimeType,
            @durationSeconds, 0, @nextAttemptAt, NULL, @createdAt, @updatedAt
          )
        `
      )
      .run({
        id,
        connectionId: target.connectionId,
        externalUserId: target.externalUserId,
        conversationId: target.conversationId,
        kind: payload.kind,
        target: serializeTarget(target),
        textContent: payload.kind === "text" ? payload.text : null,
        filePath,
        fileName: media?.fileName ?? null,
        mimeType: media?.mimeType ?? null,
        durationSeconds:
          payload.kind === "video"
            ? (payload.video.durationSeconds ?? null)
            : null,
        nextAttemptAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
  } catch (error) {
    if (filePath) {
      await unlink(filePath).catch(() => undefined)
    }
    throw error
  }

  return id
}

export function listDueMobileChannelOutbox({
  force = false,
  limit = 20,
}: {
  force?: boolean
  limit?: number
} = {}) {
  const rows = getStudioDatabase()
    .prepare(
      `
        SELECT id, connection_id, kind, target, text_content, file_path,
               file_name, mime_type, duration_seconds, attempts
        FROM mobile_channel_outbox
        ${force ? "" : "WHERE next_attempt_at <= ?"}
        ORDER BY created_at ASC
        LIMIT ?
      `
    )
    .all(...(force ? [limit] : [nowIso(), limit])) as MobileChannelOutboxRow[]

  return rows.map(mapRow)
}

export async function readMobileChannelOutboxPayload(
  record: MobileChannelOutboxRecord
): Promise<MobileChannelOutboxPayload> {
  if (record.kind === "text") {
    return { kind: "text", text: record.textContent ?? "" }
  }
  if (!record.filePath || !record.fileName || !record.mimeType) {
    throw new Error("Mobile channel outbox media payload is incomplete.")
  }

  const buffer = await readFile(record.filePath)
  if (record.kind === "image") {
    return {
      kind: "image",
      image: { buffer, fileName: record.fileName, mimeType: record.mimeType },
    }
  }
  if (record.kind === "video") {
    return {
      kind: "video",
      video: {
        buffer,
        fileName: record.fileName,
        mimeType: record.mimeType,
        durationSeconds: record.durationSeconds,
      },
    }
  }

  return {
    kind: "file",
    file: {
      buffer,
      fileName: record.fileName,
      mimeType: record.mimeType,
      size: buffer.length,
    },
  }
}

export async function completeMobileChannelOutbox(id: string) {
  const row = getStudioDatabase()
    .prepare("SELECT file_path FROM mobile_channel_outbox WHERE id = ?")
    .get(id) as { file_path: string | null } | undefined

  getStudioDatabase()
    .prepare("DELETE FROM mobile_channel_outbox WHERE id = ?")
    .run(id)

  if (row?.file_path) {
    await unlink(row.file_path).catch(() => undefined)
  }
}

export function failMobileChannelOutbox(id: string, error: string) {
  const row = getStudioDatabase()
    .prepare("SELECT attempts FROM mobile_channel_outbox WHERE id = ?")
    .get(id) as { attempts: number } | undefined

  if (!row) {
    return
  }

  const attempts = row.attempts + 1
  const delayMs = mobileChannelOutboxRetryDelayMs(attempts)
  const timestamp = nowIso()

  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_outbox
        SET attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      attempts,
      new Date(Date.now() + delayMs).toISOString(),
      error.slice(0, 2_000),
      timestamp,
      id
    )
}

export function mobileChannelOutboxRetryDelayMs(attempts: number) {
  return Math.min(
    MOBILE_CHANNEL_OUTBOX_MAX_RETRY_DELAY_MS,
    1_000 * 2 ** Math.min(Math.max(0, attempts), 9)
  )
}

export function mergeMobileChannelOutboxTarget(
  previous: MobileChannelOutboundTarget,
  current: MobileChannelOutboundTarget
) {
  return storedMobileChannelOutboxTarget({
    ...current,
    runId: previous.runId,
  })
}

export function refreshMobileChannelOutboxTargets(
  target: MobileChannelOutboundTarget
) {
  const rows = getStudioDatabase()
    .prepare(
      `
        SELECT id, target
        FROM mobile_channel_outbox
        WHERE connection_id = ? AND external_user_id = ? AND conversation_id = ?
      `
    )
    .all(
      target.connectionId,
      target.externalUserId,
      target.conversationId
    ) as Array<{ id: string; target: string }>

  const statement = getStudioDatabase().prepare(
    "UPDATE mobile_channel_outbox SET target = ?, updated_at = ? WHERE id = ?"
  )
  const timestamp = nowIso()
  for (const row of rows) {
    const previous = parseTarget(row.target)
    statement.run(
      serializeTarget(mergeMobileChannelOutboxTarget(previous, target)),
      timestamp,
      row.id
    )
  }

  return rows.length
}

export async function purgeMobileChannelOutbox(connectionId: string) {
  const rows = getStudioDatabase()
    .prepare(
      "SELECT file_path FROM mobile_channel_outbox WHERE connection_id = ?"
    )
    .all(connectionId) as Array<{ file_path: string | null }>

  getStudioDatabase()
    .prepare("DELETE FROM mobile_channel_outbox WHERE connection_id = ?")
    .run(connectionId)
  await Promise.all(
    rows.map((row) =>
      row.file_path ? unlink(row.file_path).catch(() => undefined) : undefined
    )
  )
}
