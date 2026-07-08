import { getStudioDatabase as getDb } from "./connection"
import { nowIso } from "./helpers"
import type {
  DbExpertCatalogCacheRow,
  DbExpertDetailCacheRow,
  DbSessionExpertRow,
} from "./types"

export type StudioExpertCatalogCache = {
  key: string
  catalogHash: string
  catalogVersion: string
  updatedAt: string
  categories: unknown[]
  experts: unknown[]
  cachedAt: string
}

export type UpsertStudioExpertCatalogCacheInput = {
  key?: string
  catalogHash: string
  catalogVersion: string
  updatedAt: string
  categories: unknown[]
  experts: unknown[]
}

export type StudioExpertDetailCache = {
  expertId: string
  runtimeHash: string
  detail: unknown
  updatedAt: string
  cachedAt: string
}

export type UpsertStudioExpertDetailCacheInput = {
  expertId: string
  runtimeHash: string
  detail: unknown
  updatedAt: string
}

export type StudioSessionExpert = {
  sessionId: string
  expertId: string
  expertType: string
  runtimeHash: string
  snapshot: unknown
  selectedAt: string
}

export type UpsertStudioSessionExpertInput = {
  sessionId: string
  expertId: string
  expertType: string
  runtimeHash: string
  snapshot: unknown
}

const defaultCatalogCacheKey = "default"

export function getStudioExpertCatalogCache(
  key = defaultCatalogCacheKey
): StudioExpertCatalogCache | null {
  const row = getDb()
    .prepare(
      `
        SELECT
          key,
          catalog_hash,
          catalog_version,
          updated_at,
          categories_json,
          experts_json,
          cached_at
        FROM studio_expert_catalog_cache
        WHERE key = ?
      `
    )
    .get(key) as DbExpertCatalogCacheRow | undefined

  return row ? mapExpertCatalogCache(row) : null
}

export function upsertStudioExpertCatalogCache({
  key = defaultCatalogCacheKey,
  catalogHash,
  catalogVersion,
  updatedAt,
  categories,
  experts,
}: UpsertStudioExpertCatalogCacheInput) {
  const cachedAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_expert_catalog_cache
          (
            key,
            catalog_hash,
            catalog_version,
            updated_at,
            categories_json,
            experts_json,
            cached_at
          )
        VALUES
          (
            @key,
            @catalogHash,
            @catalogVersion,
            @updatedAt,
            @categoriesJson,
            @expertsJson,
            @cachedAt
          )
        ON CONFLICT(key) DO UPDATE SET
          catalog_hash = excluded.catalog_hash,
          catalog_version = excluded.catalog_version,
          updated_at = excluded.updated_at,
          categories_json = excluded.categories_json,
          experts_json = excluded.experts_json,
          cached_at = excluded.cached_at
      `
    )
    .run({
      key,
      catalogHash,
      catalogVersion,
      updatedAt,
      categoriesJson: JSON.stringify(categories),
      expertsJson: JSON.stringify(experts),
      cachedAt,
    })

  return getStudioExpertCatalogCache(key)
}

export function getStudioExpertDetailCache(
  expertId: string
): StudioExpertDetailCache | null {
  const row = getDb()
    .prepare(
      `
        SELECT
          expert_id,
          runtime_hash,
          detail_json,
          updated_at,
          cached_at
        FROM studio_expert_detail_cache
        WHERE expert_id = ?
      `
    )
    .get(expertId) as DbExpertDetailCacheRow | undefined

  return row ? mapExpertDetailCache(row) : null
}

export function upsertStudioExpertDetailCache({
  expertId,
  runtimeHash,
  detail,
  updatedAt,
}: UpsertStudioExpertDetailCacheInput) {
  const cachedAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_expert_detail_cache
          (expert_id, runtime_hash, detail_json, updated_at, cached_at)
        VALUES
          (@expertId, @runtimeHash, @detailJson, @updatedAt, @cachedAt)
        ON CONFLICT(expert_id) DO UPDATE SET
          runtime_hash = excluded.runtime_hash,
          detail_json = excluded.detail_json,
          updated_at = excluded.updated_at,
          cached_at = excluded.cached_at
      `
    )
    .run({
      expertId,
      runtimeHash,
      detailJson: JSON.stringify(detail),
      updatedAt,
      cachedAt,
    })

  return getStudioExpertDetailCache(expertId)
}

export function getStudioSessionExpert(
  sessionId: string
): StudioSessionExpert | null {
  const row = getDb()
    .prepare(
      `
        SELECT
          session_id,
          expert_id,
          expert_type,
          runtime_hash,
          snapshot_json,
          selected_at
        FROM studio_session_experts
        WHERE session_id = ?
      `
    )
    .get(sessionId) as DbSessionExpertRow | undefined

  return row ? mapSessionExpert(row) : null
}

export function getStudioLatestSessionExpertByExpertId(
  expertId: string
): StudioSessionExpert | null {
  const normalizedExpertId = expertId.trim()

  if (!normalizedExpertId) {
    return null
  }

  const row = getDb()
    .prepare(
      `
        SELECT
          session_id,
          expert_id,
          expert_type,
          runtime_hash,
          snapshot_json,
          selected_at
        FROM studio_session_experts
        WHERE expert_id = ?
        ORDER BY selected_at DESC
        LIMIT 1
      `
    )
    .get(normalizedExpertId) as DbSessionExpertRow | undefined

  return row ? mapSessionExpert(row) : null
}

export function listStudioRecentSessionExperts(limit = 8) {
  const normalizedLimit = Math.max(1, Math.min(50, Math.floor(limit)))
  const rows = getDb()
    .prepare(
      `
        SELECT
          session_id,
          expert_id,
          expert_type,
          runtime_hash,
          snapshot_json,
          selected_at
        FROM studio_session_experts
        ORDER BY selected_at DESC
      `
    )
    .all() as DbSessionExpertRow[]
  const seenExpertIds = new Set<string>()
  const experts: StudioSessionExpert[] = []

  for (const row of rows) {
    if (seenExpertIds.has(row.expert_id)) {
      continue
    }

    seenExpertIds.add(row.expert_id)
    experts.push(mapSessionExpert(row))

    if (experts.length >= normalizedLimit) {
      break
    }
  }

  return experts
}

export function upsertStudioSessionExpert({
  sessionId,
  expertId,
  expertType,
  runtimeHash,
  snapshot,
}: UpsertStudioSessionExpertInput) {
  const selectedAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_session_experts
          (
            session_id,
            expert_id,
            expert_type,
            runtime_hash,
            snapshot_json,
            selected_at
          )
        VALUES
          (
            @sessionId,
            @expertId,
            @expertType,
            @runtimeHash,
            @snapshotJson,
            @selectedAt
          )
        ON CONFLICT(session_id) DO UPDATE SET
          expert_id = excluded.expert_id,
          expert_type = excluded.expert_type,
          runtime_hash = excluded.runtime_hash,
          snapshot_json = excluded.snapshot_json,
          selected_at = excluded.selected_at
      `
    )
    .run({
      sessionId,
      expertId,
      expertType,
      runtimeHash,
      snapshotJson: JSON.stringify(snapshot),
      selectedAt,
    })

  return getStudioSessionExpert(sessionId)
}

export function deleteStudioSessionExpert(sessionId: string) {
  const result = getDb()
    .prepare(
      `
        DELETE FROM studio_session_experts
        WHERE session_id = ?
      `
    )
    .run(sessionId)

  return result.changes > 0
}

function mapExpertCatalogCache(
  row: DbExpertCatalogCacheRow
): StudioExpertCatalogCache {
  return {
    key: row.key,
    catalogHash: row.catalog_hash,
    catalogVersion: row.catalog_version,
    updatedAt: row.updated_at,
    categories: parseJsonArray(row.categories_json),
    experts: parseJsonArray(row.experts_json),
    cachedAt: row.cached_at,
  }
}

function mapExpertDetailCache(
  row: DbExpertDetailCacheRow
): StudioExpertDetailCache {
  return {
    expertId: row.expert_id,
    runtimeHash: row.runtime_hash,
    detail: parseJsonValue(row.detail_json, {}),
    updatedAt: row.updated_at,
    cachedAt: row.cached_at,
  }
}

function mapSessionExpert(row: DbSessionExpertRow): StudioSessionExpert {
  return {
    sessionId: row.session_id,
    expertId: row.expert_id,
    expertType: row.expert_type,
    runtimeHash: row.runtime_hash,
    snapshot: parseJsonValue(row.snapshot_json, {}),
    selectedAt: row.selected_at,
  }
}

function parseJsonArray(raw: string) {
  const parsed = parseJsonValue(raw, [])
  return Array.isArray(parsed) ? parsed : []
}

function parseJsonValue(raw: string, fallback: unknown) {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return fallback
  }
}
