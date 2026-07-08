import { getStudioDatabase as getDb } from "./connection"
import { mapInstalledSkill, nowIso } from "./helpers"
import type {
  DbInstalledSkillRow,
  DbSessionSkillSyncRow,
  UpsertInstalledSkillInput,
  UpsertSessionSkillSyncInput,
} from "./types"

export function listStudioInstalledSkills({
  enabledOnly = false,
}: {
  enabledOnly?: boolean
} = {}) {
  const rows = getDb()
    .prepare(
      `
        SELECT
          slug,
          version,
          skill_meta,
          skill_md,
          enabled,
          install_path,
          installed_file_count,
          installed_size_bytes,
          installed_at,
          updated_at
        FROM studio_installed_skills
        ${enabledOnly ? "WHERE enabled = 1" : ""}
        ORDER BY updated_at DESC, slug ASC
      `
    )
    .all() as DbInstalledSkillRow[]

  return rows.map(mapInstalledSkill)
}

export function getStudioInstalledSkill(slug: string) {
  const normalizedSlug = slug.trim()

  if (!normalizedSlug) {
    return null
  }

  const row = getDb()
    .prepare(
      `
        SELECT
          slug,
          version,
          skill_meta,
          skill_md,
          enabled,
          install_path,
          installed_file_count,
          installed_size_bytes,
          installed_at,
          updated_at
        FROM studio_installed_skills
        WHERE slug = ?
      `
    )
    .get(normalizedSlug) as DbInstalledSkillRow | undefined

  return row ? mapInstalledSkill(row) : null
}

export function upsertStudioInstalledSkill({
  slug,
  version,
  skill,
  skillMd,
  enabled = true,
  installPath,
  installedFileCount,
  installedSizeBytes,
}: UpsertInstalledSkillInput) {
  const existing = getStudioInstalledSkill(slug)
  const installedAt = existing?.installedAt ?? nowIso()
  const updatedAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_installed_skills
          (
            slug,
            version,
            skill_meta,
            skill_md,
            enabled,
            install_path,
            installed_file_count,
            installed_size_bytes,
            installed_at,
            updated_at
          )
        VALUES
          (
            @slug,
            @version,
            @skillMeta,
            @skillMd,
            @enabled,
            @installPath,
            @installedFileCount,
            @installedSizeBytes,
            @installedAt,
            @updatedAt
          )
        ON CONFLICT(slug) DO UPDATE SET
          version = excluded.version,
          skill_meta = excluded.skill_meta,
          skill_md = excluded.skill_md,
          enabled = excluded.enabled,
          install_path = excluded.install_path,
          installed_file_count = excluded.installed_file_count,
          installed_size_bytes = excluded.installed_size_bytes,
          updated_at = excluded.updated_at
      `
    )
    .run({
      slug,
      version,
      skillMeta: JSON.stringify(skill),
      skillMd,
      enabled: enabled ? 1 : 0,
      installPath,
      installedFileCount,
      installedSizeBytes,
      installedAt,
      updatedAt,
    })

  return getStudioInstalledSkill(slug)
}

export function updateStudioInstalledSkillEnabled(
  slug: string,
  enabled: boolean
) {
  const updatedAt = nowIso()
  const result = getDb()
    .prepare(
      `
        UPDATE studio_installed_skills
        SET enabled = ?,
            updated_at = ?
        WHERE slug = ?
      `
    )
    .run(enabled ? 1 : 0, updatedAt, slug)

  return result.changes > 0 ? getStudioInstalledSkill(slug) : null
}

export function deleteStudioInstalledSkill(slug: string) {
  const database = getDb()
  const deleteTransaction = database.transaction(() => {
    database
      .prepare(
        `
          DELETE FROM studio_session_skill_syncs
          WHERE slug = ?
        `
      )
      .run(slug)

    const result = database
      .prepare(
        `
          DELETE FROM studio_installed_skills
          WHERE slug = ?
        `
      )
      .run(slug)

    return result.changes > 0
  })

  return deleteTransaction()
}

export function getStudioSessionSkillSync({
  sessionId,
  slug,
}: {
  sessionId: string
  slug: string
}) {
  const row = getDb()
    .prepare(
      `
        SELECT
          session_id,
          slug,
          version,
          sandbox_id,
          sandbox_path,
          synced_at
        FROM studio_session_skill_syncs
        WHERE session_id = ?
          AND slug = ?
      `
    )
    .get(sessionId, slug) as DbSessionSkillSyncRow | undefined

  return row
    ? {
        sessionId: row.session_id,
        slug: row.slug,
        version: row.version,
        sandboxId: row.sandbox_id,
        sandboxPath: row.sandbox_path,
        syncedAt: row.synced_at,
      }
    : null
}

export function upsertStudioSessionSkillSync({
  sessionId,
  slug,
  version,
  sandboxId,
  sandboxPath,
}: UpsertSessionSkillSyncInput) {
  const syncedAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_session_skill_syncs
          (session_id, slug, version, sandbox_id, sandbox_path, synced_at)
        VALUES
          (@sessionId, @slug, @version, @sandboxId, @sandboxPath, @syncedAt)
        ON CONFLICT(session_id, slug) DO UPDATE SET
          version = excluded.version,
          sandbox_id = excluded.sandbox_id,
          sandbox_path = excluded.sandbox_path,
          synced_at = excluded.synced_at
      `
    )
    .run({
      sessionId,
      slug,
      version,
      sandboxId,
      sandboxPath,
      syncedAt,
    })

  return getStudioSessionSkillSync({ sessionId, slug })
}
