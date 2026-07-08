import { randomUUID } from "node:crypto"

import { statStudioFile } from "@/lib/studio-file-storage"
import type { StudioGenericLibraryFile } from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import { mapSessionFile, nowIso } from "./helpers"
import type { CreateSessionFileInput, DbSessionFileRow } from "./types"

export function createStudioSessionFile({
  id = randomUUID(),
  sessionId,
  messageId = null,
  kind,
  originalName,
  mimeType = null,
  size = null,
  storagePath,
  sandboxPath = null,
  sourceToolCallId = null,
  savedAt = null,
}: CreateSessionFileInput) {
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_session_files
          (id, session_id, message_id, kind, original_name, mime_type, size,
           storage_path, sandbox_path, source_tool_call_id, saved_at,
           created_at, updated_at)
        VALUES
          (@id, @sessionId, @messageId, @kind, @originalName, @mimeType, @size,
           @storagePath, @sandboxPath, @sourceToolCallId, @savedAt,
           @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          message_id = excluded.message_id,
          kind = excluded.kind,
          original_name = excluded.original_name,
          mime_type = excluded.mime_type,
          size = excluded.size,
          storage_path = excluded.storage_path,
          sandbox_path = excluded.sandbox_path,
          source_tool_call_id = excluded.source_tool_call_id,
          saved_at = excluded.saved_at,
          updated_at = excluded.updated_at
      `
    )
    .run({
      id,
      sessionId,
      messageId,
      kind,
      originalName,
      mimeType,
      size,
      storagePath,
      sandboxPath,
      sourceToolCallId,
      savedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

  return getStudioSessionFile(id)
}

export function getGeneratedMediaSessionFileId(
  kind: "image" | "video",
  outputId: string
) {
  return `${kind}-output-${outputId}`
}

function generatedMediaFileExtension(mimeType: string | null) {
  if (mimeType === "image/jpeg") return "jpg"
  if (mimeType === "image/webp") return "webp"
  if (mimeType === "image/gif") return "gif"
  if (mimeType === "video/mp4") return "mp4"
  if (mimeType === "video/webm") return "webm"
  if (mimeType === "video/quicktime") return "mov"
  return mimeType?.startsWith("video/") ? "mp4" : "png"
}

export function createGeneratedMediaSessionFile({
  generationId,
  kind,
  mimeType,
  outputId,
  outputIndex,
  savedAt = nowIso(),
  sessionId,
  storagePath,
}: {
  generationId: string
  kind: "image" | "video"
  mimeType: string | null
  outputId: string
  outputIndex: number
  savedAt?: string | null
  sessionId: string
  storagePath: string
}) {
  let size: number | null = null

  try {
    size = statStudioFile(storagePath).size
  } catch {
    size = null
  }

  return createStudioSessionFile({
    id: getGeneratedMediaSessionFileId(kind, outputId),
    sessionId,
    kind: "generated",
    originalName: `${kind}-${outputIndex + 1}-${outputId}.${generatedMediaFileExtension(
      mimeType
    )}`,
    mimeType,
    size,
    storagePath,
    sourceToolCallId: generationId,
    savedAt,
  })
}

export function getStudioSessionFile(fileId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, session_id, message_id, kind, original_name, mime_type, size,
               storage_path, sandbox_path, source_tool_call_id, saved_at,
               created_at, updated_at
        FROM studio_session_files
        WHERE id = ?
      `
    )
    .get(fileId) as DbSessionFileRow | undefined

  return row ? mapSessionFile(row) : null
}

export function listStudioSessionFiles(sessionId: string) {
  const rows = getDb()
    .prepare(
      `
        SELECT id, session_id, message_id, kind, original_name, mime_type, size,
               storage_path, sandbox_path, source_tool_call_id, saved_at,
               created_at, updated_at
        FROM studio_session_files
        WHERE session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(sessionId) as DbSessionFileRow[]

  return rows.map(mapSessionFile)
}

export function updateStudioSessionFileSandboxPath(
  fileId: string,
  sandboxPath: string
) {
  getDb()
    .prepare(
      `
        UPDATE studio_session_files
        SET sandbox_path = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(sandboxPath, nowIso(), fileId)
}

export function listStudioSavedGenericFiles(): StudioGenericLibraryFile[] {
  const rows = getDb()
    .prepare(
      `
        SELECT id, session_id, message_id, kind, original_name, mime_type, size,
               storage_path, sandbox_path, source_tool_call_id, saved_at,
               created_at, updated_at
        FROM studio_session_files
        WHERE kind = 'generated'
          AND saved_at IS NOT NULL
        ORDER BY saved_at DESC, created_at DESC
      `
    )
    .all() as DbSessionFileRow[]

  return rows.map((row) => ({
    id: row.id,
    kind: "file",
    sessionId: row.session_id,
    messageId: row.message_id,
    name: row.original_name,
    prompt: row.original_name,
    modelName: "AstraFlow Sandbox",
    manufacturer: "AstraFlow",
    mimeType: row.mime_type,
    size: row.size,
    sandboxPath: row.sandbox_path,
    downloadUrl: `/api/studio/files/${row.id}/content?download=1`,
    canOpenFolder: true,
    savedAt: row.saved_at ?? row.created_at,
    createdAt: row.created_at,
  }))
}
