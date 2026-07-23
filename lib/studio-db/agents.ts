import type { CodeBoxSandboxStatus } from "@/lib/codebox-types"
import type { StudioSessionSandbox } from "@/lib/studio-types"

import {
  ensureCodeBoxSandboxOwnerColumns,
  getStudioDatabase as getDb,
} from "./connection"
import {
  mapCodeBoxSandbox,
  decryptSettingValue,
  encryptSettingValue,
  mapCodeBoxVolume,
  mapSessionSandbox,
  nowIso,
} from "./helpers"
import type {
  DbCodeBoxSandboxRow,
  DbCodeBoxVolumeRow,
  DbSessionSandboxRow,
  UpsertCodeBoxSandboxInput,
  UpsertCodeBoxVolumeInput,
  UpsertSessionSandboxInput,
} from "./types"

export function getStudioSessionSandbox(sessionId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT session_id, sandbox_id, sandbox_domain, template, status,
               auto_pause_timeout_seconds, volume_id, volume_name,
               volume_path, created_at, updated_at, last_used_at
        FROM studio_session_sandboxes
        WHERE session_id = ?
      `
    )
    .get(sessionId) as DbSessionSandboxRow | undefined

  return row ? mapSessionSandbox(row) : null
}

export function upsertStudioSessionSandbox({
  sessionId,
  sandboxId,
  sandboxDomain = null,
  template,
  status = "running",
  autoPauseTimeoutSeconds,
  volumeId = null,
  volumeName = null,
  volumePath = null,
}: UpsertSessionSandboxInput) {
  const existing = getStudioSessionSandbox(sessionId)
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO studio_session_sandboxes
          (session_id, sandbox_id, sandbox_domain, template, status,
           auto_pause_timeout_seconds, volume_id, volume_name, volume_path,
           created_at, updated_at, last_used_at)
        VALUES
          (@sessionId, @sandboxId, @sandboxDomain, @template, @status,
           @autoPauseTimeoutSeconds, @volumeId, @volumeName, @volumePath,
           @createdAt, @updatedAt, @lastUsedAt)
        ON CONFLICT(session_id) DO UPDATE SET
          sandbox_id = excluded.sandbox_id,
          sandbox_domain = excluded.sandbox_domain,
          template = excluded.template,
          status = excluded.status,
          auto_pause_timeout_seconds = excluded.auto_pause_timeout_seconds,
          volume_id = excluded.volume_id,
          volume_name = excluded.volume_name,
          volume_path = excluded.volume_path,
          updated_at = excluded.updated_at,
          last_used_at = excluded.last_used_at
      `
    )
    .run({
      sessionId,
      sandboxId,
      sandboxDomain,
      template,
      status,
      autoPauseTimeoutSeconds,
      volumeId,
      volumeName,
      volumePath,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    })

  return getStudioSessionSandbox(sessionId)
}

export function touchStudioSessionSandbox(
  sessionId: string,
  status: StudioSessionSandbox["status"] = "running"
) {
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_session_sandboxes
        SET status = ?,
            updated_at = ?,
            last_used_at = ?
        WHERE session_id = ?
      `
    )
    .run(status, timestamp, timestamp, sessionId)
}

export function listCodeBoxVolumeRecords() {
  const rows = getDb()
    .prepare(
      `
        SELECT volume_id, name, created_at, last_seen_at
        FROM codebox_volumes
        ORDER BY last_seen_at DESC, name ASC
      `
    )
    .all() as DbCodeBoxVolumeRow[]

  return rows.map(mapCodeBoxVolume)
}

export function getCodeBoxVolumeRecord(volumeId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT volume_id, name, created_at, last_seen_at
        FROM codebox_volumes
        WHERE volume_id = ?
      `
    )
    .get(volumeId) as DbCodeBoxVolumeRow | undefined

  return row ? mapCodeBoxVolume(row) : null
}

export function upsertCodeBoxVolumeRecord({
  volumeId,
  name,
  createdAt,
  lastSeenAt,
}: UpsertCodeBoxVolumeInput) {
  const existing = getCodeBoxVolumeRecord(volumeId)
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO codebox_volumes
          (volume_id, name, created_at, last_seen_at)
        VALUES
          (@volumeId, @name, @createdAt, @lastSeenAt)
        ON CONFLICT(volume_id) DO UPDATE SET
          name = excluded.name,
          last_seen_at = excluded.last_seen_at
      `
    )
    .run({
      volumeId,
      name,
      createdAt: existing?.createdAt ?? createdAt ?? timestamp,
      lastSeenAt: lastSeenAt ?? timestamp,
    })

  return getCodeBoxVolumeRecord(volumeId)
}

export function deleteCodeBoxVolumeRecord(volumeId: string) {
  getDb()
    .prepare(
      `
        DELETE FROM codebox_volumes
        WHERE volume_id = ?
      `
    )
    .run(volumeId)
}

export function listCodeBoxSandboxRecords(ownerKey?: string | null) {
  ensureCodeBoxSandboxOwnerColumns()
  const normalizedOwnerKey = ownerKey?.trim()
  const rows = normalizedOwnerKey
    ? (getDb()
        .prepare(
          `
            SELECT sandbox_id, owner_key, owner_email, company_id, project_id, volume_id,
                   name, volume_name, sandbox_domain, template, status,
                   code_server_url, code_server_host, code_server_port,
                   password, workspace_path, repo_url, started_at, end_at,
                   created_at, updated_at, last_used_at
            FROM codebox_sandboxes
            WHERE owner_key = ?
            ORDER BY updated_at DESC
          `
        )
        .all(normalizedOwnerKey) as DbCodeBoxSandboxRow[])
    : (getDb()
        .prepare(
          `
            SELECT sandbox_id, owner_key, owner_email, company_id, project_id, volume_id,
                   name, volume_name, sandbox_domain, template, status,
                   code_server_url, code_server_host, code_server_port,
                   password, workspace_path, repo_url, started_at, end_at,
                   created_at, updated_at, last_used_at
            FROM codebox_sandboxes
            ORDER BY updated_at DESC
          `
        )
        .all() as DbCodeBoxSandboxRow[])

  return rows.map(mapCodeBoxSandbox)
}

export function getCodeBoxSandboxRecord(
  sandboxId: string,
  ownerKey?: string | null
) {
  ensureCodeBoxSandboxOwnerColumns()
  const normalizedOwnerKey = ownerKey?.trim()
  const row = normalizedOwnerKey
    ? (getDb()
        .prepare(
          `
            SELECT sandbox_id, owner_key, owner_email, company_id, project_id, volume_id,
                   name, volume_name, sandbox_domain, template, status,
                   code_server_url, code_server_host, code_server_port,
                   password, workspace_path, repo_url, started_at, end_at,
                   created_at, updated_at, last_used_at
            FROM codebox_sandboxes
            WHERE sandbox_id = ? AND owner_key = ?
          `
        )
        .get(sandboxId, normalizedOwnerKey) as DbCodeBoxSandboxRow | undefined)
    : (getDb()
        .prepare(
          `
            SELECT sandbox_id, owner_key, owner_email, company_id, project_id, volume_id,
                   name, volume_name, sandbox_domain, template, status,
                   code_server_url, code_server_host, code_server_port,
                   password, workspace_path, repo_url, started_at, end_at,
                   created_at, updated_at, last_used_at
            FROM codebox_sandboxes
            WHERE sandbox_id = ?
          `
        )
        .get(sandboxId) as DbCodeBoxSandboxRow | undefined)

  return row ? mapCodeBoxSandbox(row) : null
}

export function getCodeBoxSandboxEnvdAccessToken(sandboxId: string) {
  ensureCodeBoxSandboxOwnerColumns()
  const row = getDb()
    .prepare(
      `
        SELECT envd_access_token
        FROM codebox_sandboxes
        WHERE sandbox_id = ?
      `
    )
    .get(sandboxId) as { envd_access_token: string | null } | undefined
  if (!row?.envd_access_token) {
    return null
  }

  const token = decryptSettingValue(row.envd_access_token).trim()
  return token && !token.startsWith("enc:v1:") ? token : null
}

export function updateCodeBoxSandboxEnvdAccessTokenRecord(
  sandboxId: string,
  envdAccessToken: string
) {
  ensureCodeBoxSandboxOwnerColumns()
  const normalizedToken = envdAccessToken.trim()
  if (!normalizedToken) {
    throw new Error("Sandbox envd access token is required.")
  }

  return (
    getDb()
      .prepare(
        `
          UPDATE codebox_sandboxes
          SET envd_access_token = ?
          WHERE sandbox_id = ?
        `
      )
      .run(encryptSettingValue(normalizedToken), sandboxId).changes > 0
  )
}

export function upsertCodeBoxSandboxRecord({
  sandboxId,
  name = null,
  ownerKey = null,
  ownerEmail = null,
  companyId = null,
  projectId = null,
  volumeId = null,
  volumeName = null,
  sandboxDomain = null,
  template,
  status = "running",
  envdAccessToken,
  codeServerUrl = null,
  codeServerHost = null,
  codeServerPort,
  password = null,
  workspacePath,
  repoUrl = null,
  startedAt = null,
  endAt = null,
}: UpsertCodeBoxSandboxInput) {
  ensureCodeBoxSandboxOwnerColumns()
  const existing = getCodeBoxSandboxRecord(sandboxId, ownerKey)
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        INSERT INTO codebox_sandboxes
          (sandbox_id, name, owner_key, owner_email, company_id, project_id, volume_id,
           volume_name, sandbox_domain, envd_access_token, template, status,
           code_server_url, code_server_host, code_server_port, password,
           workspace_path, repo_url, started_at, end_at, created_at, updated_at,
           last_used_at)
        VALUES
          (@sandboxId, @name, @ownerKey, @ownerEmail, @companyId, @projectId, @volumeId,
           @volumeName, @sandboxDomain, @envdAccessToken, @template, @status,
           @codeServerUrl, @codeServerHost, @codeServerPort, @password,
           @workspacePath, @repoUrl, @startedAt, @endAt, @createdAt, @updatedAt,
           @lastUsedAt)
        ON CONFLICT(sandbox_id) DO UPDATE SET
          name = excluded.name,
          owner_key = excluded.owner_key,
          owner_email = excluded.owner_email,
          company_id = excluded.company_id,
          project_id = excluded.project_id,
          volume_id = excluded.volume_id,
          volume_name = excluded.volume_name,
          sandbox_domain = excluded.sandbox_domain,
          envd_access_token = COALESCE(
            excluded.envd_access_token,
            codebox_sandboxes.envd_access_token
          ),
          template = excluded.template,
          status = excluded.status,
          code_server_url = excluded.code_server_url,
          code_server_host = excluded.code_server_host,
          code_server_port = excluded.code_server_port,
          password = excluded.password,
          workspace_path = excluded.workspace_path,
          repo_url = excluded.repo_url,
          started_at = excluded.started_at,
          end_at = excluded.end_at,
          updated_at = excluded.updated_at,
          last_used_at = excluded.last_used_at
      `
    )
    .run({
      sandboxId,
      name,
      ownerKey,
      ownerEmail,
      companyId,
      projectId,
      volumeId,
      volumeName,
      sandboxDomain,
      envdAccessToken: envdAccessToken?.trim()
        ? encryptSettingValue(envdAccessToken.trim())
        : null,
      template,
      status,
      codeServerUrl,
      codeServerHost,
      codeServerPort,
      password,
      workspacePath,
      repoUrl,
      startedAt,
      endAt,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
    })

  return getCodeBoxSandboxRecord(sandboxId, ownerKey)
}

export function touchCodeBoxSandboxRecord(
  sandboxId: string,
  status: CodeBoxSandboxStatus,
  ownerKey?: string | null
) {
  ensureCodeBoxSandboxOwnerColumns()
  const timestamp = nowIso()
  const normalizedOwnerKey = ownerKey?.trim()

  if (normalizedOwnerKey) {
    getDb()
      .prepare(
        `
          UPDATE codebox_sandboxes
          SET status = ?,
              updated_at = ?,
              last_used_at = ?
          WHERE sandbox_id = ? AND owner_key = ?
        `
      )
      .run(status, timestamp, timestamp, sandboxId, normalizedOwnerKey)
    return
  }

  getDb()
    .prepare(
      `
        UPDATE codebox_sandboxes
        SET status = ?,
            updated_at = ?,
            last_used_at = ?
        WHERE sandbox_id = ?
      `
    )
    .run(status, timestamp, timestamp, sandboxId)
}

export function updateCodeBoxSandboxNameRecord(
  sandboxId: string,
  name: string | null,
  ownerKey?: string | null
) {
  ensureCodeBoxSandboxOwnerColumns()
  const timestamp = nowIso()
  const normalizedOwnerKey = ownerKey?.trim()

  if (normalizedOwnerKey) {
    getDb()
      .prepare(
        `
          UPDATE codebox_sandboxes
          SET name = ?,
              updated_at = ?,
              last_used_at = ?
          WHERE sandbox_id = ? AND owner_key = ?
        `
      )
      .run(name, timestamp, timestamp, sandboxId, normalizedOwnerKey)

    return getCodeBoxSandboxRecord(sandboxId, normalizedOwnerKey)
  }

  getDb()
    .prepare(
      `
        UPDATE codebox_sandboxes
        SET name = ?,
            updated_at = ?,
            last_used_at = ?
        WHERE sandbox_id = ?
      `
    )
    .run(name, timestamp, timestamp, sandboxId)

  return getCodeBoxSandboxRecord(sandboxId)
}

export function deleteCodeBoxSandboxRecord(sandboxId: string) {
  ensureCodeBoxSandboxOwnerColumns()
  getDb()
    .prepare(
      `
        DELETE FROM codebox_sandboxes
        WHERE sandbox_id = ?
      `
    )
    .run(sandboxId)
}
