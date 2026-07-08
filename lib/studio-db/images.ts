import { randomUUID } from "node:crypto"

import type {
  StudioImageGeneration,
  StudioImageOutput,
  StudioSavedImageOutput,
} from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import {
  isTerminalImageStatus,
  mapImageGeneration,
  mapImageOutput,
  nowIso,
} from "./helpers"
import { createGeneratedMediaSessionFile } from "./media"
import type {
  CreateImageGenerationInput,
  CreateImageOutputInput,
  DbImageGenerationRow,
  DbImageOutputRow,
  DbSavedImageOutputRow,
  UpdateImageGenerationInput,
} from "./types"

export function listStudioImageGenerations(sessionId: string) {
  const database = getDb()
  const rows = database
    .prepare(
      `
        SELECT id, session_id, model_square_id, model_name, manufacturer,
               openapi_file, operation_id, prompt, params, status,
               phase, progress, raw_status, attempt, last_polled_at,
               next_poll_at, lease_owner, lease_expires_at, error_message,
               raw_response, created_at, completed_at
        FROM studio_image_generations
        WHERE session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(sessionId) as DbImageGenerationRow[]

  if (rows.length === 0) {
    return []
  }

  const outputRows = database
    .prepare(
      `
        SELECT id, generation_id, output_index, url, NULL AS data_url,
               storage_path, mime_type, width, height, metadata, saved_at,
               created_at
        FROM studio_image_outputs
        WHERE generation_id IN (${rows.map(() => "?").join(",")})
        ORDER BY generation_id, output_index ASC
      `
    )
    .all(...rows.map((row) => row.id)) as DbImageOutputRow[]

  const outputsByGeneration = new Map<string, StudioImageOutput[]>()

  for (const output of outputRows) {
    const bucket = outputsByGeneration.get(output.generation_id) ?? []
    bucket.push(mapImageOutput(output))
    outputsByGeneration.set(output.generation_id, bucket)
  }

  return rows.map((row) =>
    mapImageGeneration(row, outputsByGeneration.get(row.id) ?? [])
  )
}

export function createStudioImageGeneration(
  input: CreateImageGenerationInput
): StudioImageGeneration {
  const database = getDb()
  const createdAt = nowIso()
  const id = randomUUID()
  const status = input.status ?? "running"

  const transaction = database.transaction(() => {
    database
      .prepare(
        `
          INSERT INTO studio_image_generations
            (id, session_id, model_square_id, model_name, manufacturer,
             openapi_file, operation_id, prompt, params, status,
             phase, progress, raw_status, attempt, last_polled_at,
             next_poll_at, lease_owner, lease_expires_at, error_message,
             raw_response, created_at, completed_at)
          VALUES
            (@id, @sessionId, @modelSquareId, @modelName, @manufacturer,
             @openapiFile, @operationId, @prompt, @params, @status,
             @phase, @progress, @rawStatus, @attempt, @lastPolledAt,
             @nextPollAt, @leaseOwner, @leaseExpiresAt, NULL, NULL,
             @createdAt, NULL)
        `
      )
      .run({
        id,
        sessionId: input.sessionId,
        modelSquareId: input.modelSquareId,
        modelName: input.modelName,
        manufacturer: input.manufacturer ?? null,
        openapiFile: input.openapiFile ?? null,
        operationId: input.operationId ?? null,
        prompt: input.prompt,
        params: JSON.stringify(input.params),
        status,
        phase: input.phase ?? null,
        progress: input.progress ?? null,
        rawStatus: input.rawStatus ?? null,
        attempt: input.attempt ?? 0,
        lastPolledAt: input.lastPolledAt ?? null,
        nextPollAt: input.nextPollAt ?? null,
        leaseOwner: input.leaseOwner ?? null,
        leaseExpiresAt: input.leaseExpiresAt ?? null,
        createdAt,
      })

    database
      .prepare(
        `
          UPDATE studio_sessions
          SET updated_at = ?
          WHERE id = ?
        `
      )
      .run(createdAt, input.sessionId)
  })

  transaction()

  return {
    id,
    sessionId: input.sessionId,
    modelSquareId: input.modelSquareId,
    modelName: input.modelName,
    manufacturer: input.manufacturer ?? null,
    openapiFile: input.openapiFile ?? null,
    operationId: input.operationId ?? null,
    prompt: input.prompt,
    params: input.params,
    status,
    phase: input.phase ?? null,
    progress: input.progress ?? null,
    rawStatus: input.rawStatus ?? null,
    attempt: input.attempt ?? 0,
    lastPolledAt: input.lastPolledAt ?? null,
    nextPollAt: input.nextPollAt ?? null,
    leaseOwner: input.leaseOwner ?? null,
    leaseExpiresAt: input.leaseExpiresAt ?? null,
    errorMessage: null,
    createdAt,
    completedAt: null,
    outputs: [],
  }
}

export function updateStudioImageGeneration(
  generationId: string,
  input: UpdateImageGenerationInput
) {
  const completedAt =
    input.completedAt ?? (isTerminalImageStatus(input.status) ? nowIso() : null)

  getDb()
    .prepare(
      `
        UPDATE studio_image_generations
        SET status = ?,
            phase = COALESCE(?, phase),
            progress = COALESCE(?, progress),
            raw_status = COALESCE(?, raw_status),
            attempt = COALESCE(?, attempt),
            last_polled_at = COALESCE(?, last_polled_at),
            next_poll_at = COALESCE(?, next_poll_at),
            lease_owner = COALESCE(?, lease_owner),
            lease_expires_at = COALESCE(?, lease_expires_at),
            error_message = ?,
            raw_response = COALESCE(?, raw_response),
            completed_at = COALESCE(?, completed_at)
        WHERE id = ?
      `
    )
    .run(
      input.status,
      input.phase ?? null,
      input.progress ?? null,
      input.rawStatus ?? null,
      input.attempt ?? null,
      input.lastPolledAt ?? null,
      input.nextPollAt ?? null,
      input.leaseOwner ?? null,
      input.leaseExpiresAt ?? null,
      input.errorMessage ?? null,
      input.rawResponse === undefined
        ? null
        : JSON.stringify(input.rawResponse),
      completedAt,
      generationId
    )
}

export function createStudioImageOutput(
  input: CreateImageOutputInput
): StudioImageOutput {
  const id = input.id ?? randomUUID()
  const createdAt = nowIso()
  const savedAt = input.autoSave ? createdAt : null

  getDb()
    .prepare(
      `
        INSERT INTO studio_image_outputs
          (id, generation_id, output_index, url, data_url, storage_path,
           mime_type, width, height, metadata, saved_at, created_at)
        VALUES
          (@id, @generationId, @index, @url, @dataUrl, @storagePath,
           @mimeType, @width, @height, @metadata, @savedAt, @createdAt)
      `
    )
    .run({
      id,
      generationId: input.generationId,
      index: input.index,
      url: input.url ?? null,
      dataUrl: input.dataUrl ?? null,
      storagePath: input.storagePath ?? null,
      mimeType: input.mimeType ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      metadata:
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
      savedAt,
      createdAt,
    })

  if (input.storagePath) {
    try {
      const generation = getDb()
        .prepare(
          `
            SELECT session_id
            FROM studio_image_generations
            WHERE id = ?
          `
        )
        .get(input.generationId) as { session_id: string } | undefined

      if (generation?.session_id) {
        createGeneratedMediaSessionFile({
          generationId: input.generationId,
          kind: "image",
          mimeType: input.mimeType ?? null,
          outputId: id,
          outputIndex: input.index,
          savedAt: savedAt ?? createdAt,
          sessionId: generation.session_id,
          storagePath: input.storagePath,
        })
      }
    } catch {
      // Session-file registration is best-effort; the media output row is the source of truth.
    }
  }

  return {
    id,
    generationId: input.generationId,
    index: input.index,
    src: input.dataUrl ?? input.url ?? "",
    url: input.url ?? null,
    dataUrl: input.dataUrl ?? null,
    storagePath: input.storagePath ?? null,
    mimeType: input.mimeType ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    savedAt,
    createdAt,
  }
}

export function getStudioImageOutput(outputId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, generation_id, output_index, url, data_url, storage_path,
               mime_type, width, height, metadata, saved_at, created_at
        FROM studio_image_outputs
        WHERE id = ?
      `
    )
    .get(outputId) as DbImageOutputRow | undefined

  return row ? mapImageOutput(row) : null
}

export function listStudioSavedImageOutputs(): StudioSavedImageOutput[] {
  const rows = getDb()
    .prepare(
      `
        SELECT outputs.id, outputs.generation_id, generations.session_id,
               outputs.output_index, generations.prompt, generations.model_name,
               generations.manufacturer, outputs.mime_type, outputs.width,
               outputs.height, outputs.storage_path, outputs.saved_at,
               outputs.created_at
        FROM studio_image_outputs AS outputs
        INNER JOIN studio_image_generations AS generations
          ON generations.id = outputs.generation_id
        WHERE outputs.saved_at IS NOT NULL
        ORDER BY outputs.saved_at DESC, outputs.created_at DESC
      `
    )
    .all() as DbSavedImageOutputRow[]

  return rows.map((row) => ({
    id: row.id,
    generationId: row.generation_id,
    sessionId: row.session_id,
    index: row.output_index,
    prompt: row.prompt,
    modelName: row.model_name,
    manufacturer: row.manufacturer,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    storagePath: row.storage_path,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }))
}

export function saveStudioImageOutputStorage(
  outputId: string,
  storagePath: string,
  mimeType?: string | null
) {
  const savedAt = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_image_outputs
        SET storage_path = ?,
            data_url = NULL,
            mime_type = COALESCE(?, mime_type),
            saved_at = ?
        WHERE id = ?
      `
    )
    .run(storagePath, mimeType ?? null, savedAt, outputId)

  return getStudioImageOutput(outputId)
}
