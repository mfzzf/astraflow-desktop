import { randomUUID } from "node:crypto"

import { mobileChannelCredentialsSchema } from "@/lib/schemas/mobile-channels"
import { getStudioDatabase } from "@/lib/studio-db"
import {
  decryptSettingValue,
  encryptSettingValue,
} from "@/lib/studio-db/helpers"

import type {
  MobileChannelBinding,
  MobileChannelConnection,
  MobileChannelConnectionRecord,
  MobileChannelConnectionStatus,
  MobileChannelCredentials,
  MobileChannelPairing,
  MobileChannelPairingStatus,
  MobileChannelProvider,
} from "./types"

type MobileChannelConnectionRow = {
  id: string
  provider: string
  display_name: string
  status: string
  enabled: number
  account_id: string | null
  owner_external_user_id: string | null
  credentials: string | null
  metadata: string
  default_project_id: string | null
  last_error: string | null
  connected_at: string | null
  last_event_at: string | null
  created_at: string
  updated_at: string
}

type MobileChannelPairingRow = {
  id: string
  provider: string
  connection_id: string | null
  status: string
  qr_payload: string | null
  qr_code_data_url: string | null
  bind_code: string | null
  expires_at: string
  message: string | null
  error: string | null
  created_at: string
  updated_at: string
}

type MobileChannelBindingRow = {
  id: string
  connection_id: string
  external_user_id: string
  conversation_id: string
  session_id: string | null
  created_at: string
  updated_at: string
}

const activePairingStatuses: MobileChannelPairingStatus[] = [
  "preparing",
  "waiting_scan",
  "scanned",
  "verification_required",
  "waiting_confirmation",
  "awaiting_bind",
]

function nowIso() {
  return new Date().toISOString()
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown

    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseCredentials(
  value: string | null
): MobileChannelCredentials | null {
  if (!value) {
    return null
  }

  try {
    const parsed = mobileChannelCredentialsSchema.safeParse(
      JSON.parse(decryptSettingValue(value))
    )

    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function mapConnectionRow(
  row: MobileChannelConnectionRow
): MobileChannelConnectionRecord {
  const credentials = parseCredentials(row.credentials)

  return {
    id: row.id,
    provider: row.provider as MobileChannelProvider,
    displayName: row.display_name,
    status: row.status as MobileChannelConnectionStatus,
    enabled: row.enabled === 1,
    configured: credentials !== null,
    accountId: row.account_id,
    ownerExternalUserId: row.owner_external_user_id,
    credentials,
    metadata: parseJsonObject(row.metadata),
    defaultProjectId: row.default_project_id,
    lastError: row.last_error,
    connectedAt: row.connected_at,
    lastEventAt: row.last_event_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toPublicConnection(
  connection: MobileChannelConnectionRecord
): MobileChannelConnection {
  return {
    id: connection.id,
    provider: connection.provider,
    displayName: connection.displayName,
    status: connection.status,
    enabled: connection.enabled,
    configured: connection.configured,
    accountId: connection.accountId,
    defaultProjectId: connection.defaultProjectId,
    lastError: connection.lastError,
    connectedAt: connection.connectedAt,
    lastEventAt: connection.lastEventAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  }
}

function mapPairingRow(row: MobileChannelPairingRow): MobileChannelPairing {
  const bindCommand = row.bind_code
    ? `/bind ${decryptSettingValue(row.bind_code)}`
    : null

  return {
    id: row.id,
    provider: row.provider as MobileChannelProvider,
    connectionId: row.connection_id,
    status: row.status as MobileChannelPairingStatus,
    qrCodeDataUrl: row.qr_code_data_url,
    qrPayload: row.qr_payload,
    bindCommand,
    verificationRequired: row.status === "verification_required",
    expiresAt: row.expires_at,
    message: row.message,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapBindingRow(row: MobileChannelBindingRow): MobileChannelBinding {
  return {
    id: row.id,
    connectionId: row.connection_id,
    externalUserId: row.external_user_id,
    conversationId: row.conversation_id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listMobileChannelConnections(): MobileChannelConnection[] {
  const rows = getStudioDatabase()
    .prepare(
      `
        SELECT id, provider, display_name, status, enabled, account_id,
               owner_external_user_id, credentials, metadata,
               default_project_id, last_error, connected_at, last_event_at,
               created_at, updated_at
        FROM mobile_channel_connections
        ORDER BY created_at ASC
      `
    )
    .all() as MobileChannelConnectionRow[]

  return rows.map(mapConnectionRow).map(toPublicConnection)
}

export function listMobileChannelConnectionRecords() {
  const rows = getStudioDatabase()
    .prepare(
      `
        SELECT id, provider, display_name, status, enabled, account_id,
               owner_external_user_id, credentials, metadata,
               default_project_id, last_error, connected_at, last_event_at,
               created_at, updated_at
        FROM mobile_channel_connections
        ORDER BY created_at ASC
      `
    )
    .all() as MobileChannelConnectionRow[]

  return rows.map(mapConnectionRow)
}

export function getMobileChannelConnection(
  connectionId: string
): MobileChannelConnectionRecord | null {
  const row = getStudioDatabase()
    .prepare(
      `
        SELECT id, provider, display_name, status, enabled, account_id,
               owner_external_user_id, credentials, metadata,
               default_project_id, last_error, connected_at, last_event_at,
               created_at, updated_at
        FROM mobile_channel_connections
        WHERE id = ?
      `
    )
    .get(connectionId) as MobileChannelConnectionRow | undefined

  return row ? mapConnectionRow(row) : null
}

export function getMobileChannelConnectionByProvider(
  provider: MobileChannelProvider
): MobileChannelConnectionRecord | null {
  const row = getStudioDatabase()
    .prepare(
      `
        SELECT id, provider, display_name, status, enabled, account_id,
               owner_external_user_id, credentials, metadata,
               default_project_id, last_error, connected_at, last_event_at,
               created_at, updated_at
        FROM mobile_channel_connections
        WHERE provider = ?
      `
    )
    .get(provider) as MobileChannelConnectionRow | undefined

  return row ? mapConnectionRow(row) : null
}

export function saveMobileChannelConnection({
  provider,
  displayName,
  credentials,
  accountId,
  ownerExternalUserId = null,
  metadata = {},
  defaultProjectId,
}: {
  provider: MobileChannelProvider
  displayName: string
  credentials: MobileChannelCredentials
  accountId: string | null
  ownerExternalUserId?: string | null
  metadata?: Record<string, unknown>
  defaultProjectId?: string | null
}) {
  const current = getMobileChannelConnectionByProvider(provider)
  const timestamp = nowIso()
  const id = current?.id ?? randomUUID()
  const projectId =
    defaultProjectId === undefined
      ? (current?.defaultProjectId ?? null)
      : defaultProjectId

  getStudioDatabase()
    .prepare(
      `
        INSERT INTO mobile_channel_connections (
          id, provider, display_name, status, enabled, account_id,
          owner_external_user_id, credentials, metadata, default_project_id,
          last_error, connected_at, last_event_at, created_at, updated_at
        ) VALUES (
          @id, @provider, @displayName, 'connecting', 1, @accountId,
          @ownerExternalUserId, @credentials, @metadata, @defaultProjectId,
          NULL, NULL, NULL, @createdAt, @updatedAt
        )
        ON CONFLICT(provider) DO UPDATE SET
          display_name = excluded.display_name,
          status = 'connecting',
          enabled = 1,
          account_id = excluded.account_id,
          owner_external_user_id = excluded.owner_external_user_id,
          credentials = excluded.credentials,
          metadata = excluded.metadata,
          default_project_id = excluded.default_project_id,
          last_error = NULL,
          updated_at = excluded.updated_at
      `
    )
    .run({
      id,
      provider,
      displayName,
      accountId,
      ownerExternalUserId,
      credentials: encryptSettingValue(JSON.stringify(credentials)),
      metadata: JSON.stringify(metadata),
      defaultProjectId: projectId,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })

  return getMobileChannelConnectionByProvider(provider)
}

export function updateMobileChannelConnectionState(
  connectionId: string,
  input: {
    status: MobileChannelConnectionStatus
    lastError?: string | null
    connectedAt?: string | null
    lastEventAt?: string | null
  }
) {
  const current = getMobileChannelConnection(connectionId)

  if (!current) {
    return null
  }

  const connectedAt =
    input.connectedAt !== undefined
      ? input.connectedAt
      : input.status === "connected"
        ? (current.connectedAt ?? nowIso())
        : current.connectedAt

  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_connections
        SET status = ?,
            last_error = ?,
            connected_at = ?,
            last_event_at = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      input.status,
      input.lastError !== undefined ? input.lastError : current.lastError,
      connectedAt,
      input.lastEventAt !== undefined ? input.lastEventAt : current.lastEventAt,
      nowIso(),
      connectionId
    )

  return getMobileChannelConnection(connectionId)
}

export function updateMobileChannelConnectionSettings(
  connectionId: string,
  input: { enabled?: boolean; defaultProjectId?: string | null }
) {
  const current = getMobileChannelConnection(connectionId)

  if (!current) {
    return null
  }

  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_connections
        SET enabled = ?, default_project_id = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      input.enabled === undefined
        ? Number(current.enabled)
        : Number(input.enabled),
      input.defaultProjectId === undefined
        ? current.defaultProjectId
        : input.defaultProjectId,
      nowIso(),
      connectionId
    )

  return getMobileChannelConnection(connectionId)
}

export function updateMobileChannelConnectionMetadata(
  connectionId: string,
  metadata: Record<string, unknown>
) {
  const current = getMobileChannelConnection(connectionId)

  if (!current) {
    return null
  }

  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_connections
        SET metadata = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(JSON.stringify(metadata), nowIso(), connectionId)

  return getMobileChannelConnection(connectionId)
}

export function deleteMobileChannelConnection(connectionId: string) {
  return (
    getStudioDatabase()
      .prepare("DELETE FROM mobile_channel_connections WHERE id = ?")
      .run(connectionId).changes > 0
  )
}

export function createMobileChannelPairing({
  provider,
  expiresAt,
  status = "preparing",
  message = null,
}: {
  provider: MobileChannelProvider
  expiresAt: string
  status?: MobileChannelPairingStatus
  message?: string | null
}) {
  const timestamp = nowIso()
  const pairing: MobileChannelPairing = {
    id: randomUUID(),
    provider,
    connectionId: null,
    status,
    qrCodeDataUrl: null,
    qrPayload: null,
    bindCommand: null,
    verificationRequired: false,
    expiresAt,
    message,
    error: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  getStudioDatabase()
    .prepare(
      `
        INSERT INTO mobile_channel_pairings (
          id, provider, connection_id, status, qr_payload, qr_code_data_url,
          bind_code, expires_at, message, error, created_at, updated_at
        ) VALUES (
          @id, @provider, NULL, @status, NULL, NULL, NULL, @expiresAt,
          @message, NULL, @createdAt, @updatedAt
        )
      `
    )
    .run(pairing)

  return pairing
}

export function updateMobileChannelPairing(
  pairingId: string,
  input: Partial<{
    connectionId: string | null
    status: MobileChannelPairingStatus
    qrPayload: string | null
    qrCodeDataUrl: string | null
    bindCode: string | null
    expiresAt: string
    message: string | null
    error: string | null
  }>
) {
  const current = getMobileChannelPairing(pairingId)

  if (!current) {
    return null
  }

  const rawCurrentBindCode =
    current.bindCommand?.replace(/^\/bind\s+/, "") ?? null
  const bindCode =
    input.bindCode === undefined ? rawCurrentBindCode : input.bindCode

  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_pairings
        SET connection_id = ?, status = ?, qr_payload = ?,
            qr_code_data_url = ?, bind_code = ?, expires_at = ?,
            message = ?, error = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      input.connectionId === undefined
        ? current.connectionId
        : input.connectionId,
      input.status ?? current.status,
      input.qrPayload === undefined ? current.qrPayload : input.qrPayload,
      input.qrCodeDataUrl === undefined
        ? current.qrCodeDataUrl
        : input.qrCodeDataUrl,
      bindCode ? encryptSettingValue(bindCode) : null,
      input.expiresAt ?? current.expiresAt,
      input.message === undefined ? current.message : input.message,
      input.error === undefined ? current.error : input.error,
      nowIso(),
      pairingId
    )

  return getMobileChannelPairing(pairingId)
}

export function getMobileChannelPairing(
  pairingId: string
): MobileChannelPairing | null {
  expireStaleMobileChannelPairings()

  const row = getStudioDatabase()
    .prepare(
      `
        SELECT id, provider, connection_id, status, qr_payload,
               qr_code_data_url, bind_code, expires_at, message, error,
               created_at, updated_at
        FROM mobile_channel_pairings
        WHERE id = ?
      `
    )
    .get(pairingId) as MobileChannelPairingRow | undefined

  return row ? mapPairingRow(row) : null
}

export function getLatestMobileChannelPairing(provider: MobileChannelProvider) {
  expireStaleMobileChannelPairings()

  const row = getStudioDatabase()
    .prepare(
      `
        SELECT id, provider, connection_id, status, qr_payload,
               qr_code_data_url, bind_code, expires_at, message, error,
               created_at, updated_at
        FROM mobile_channel_pairings
        WHERE provider = ?
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
    .get(provider) as MobileChannelPairingRow | undefined

  return row ? mapPairingRow(row) : null
}

export function cancelActiveMobileChannelPairings(
  provider: MobileChannelProvider
) {
  const placeholders = activePairingStatuses.map(() => "?").join(", ")

  return getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_pairings
        SET status = 'cancelled', updated_at = ?
        WHERE provider = ? AND status IN (${placeholders})
      `
    )
    .run(nowIso(), provider, ...activePairingStatuses).changes
}

export function expireStaleMobileChannelPairings() {
  const placeholders = activePairingStatuses.map(() => "?").join(", ")
  const timestamp = nowIso()

  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_pairings
        SET status = 'expired',
            message = COALESCE(message, '二维码已过期，请重新生成。'),
            updated_at = ?
        WHERE status IN (${placeholders}) AND expires_at <= ?
      `
    )
    .run(timestamp, ...activePairingStatuses, timestamp)
}

export function consumeMobileChannelBindCode({
  connectionId,
  code,
}: {
  connectionId: string
  code: string
}) {
  expireStaleMobileChannelPairings()

  const placeholders = activePairingStatuses.map(() => "?").join(", ")
  const rows = getStudioDatabase()
    .prepare(
      `
        SELECT id, provider, connection_id, status, qr_payload,
               qr_code_data_url, bind_code, expires_at, message, error,
               created_at, updated_at
        FROM mobile_channel_pairings
        WHERE connection_id = ? AND status IN (${placeholders})
        ORDER BY created_at DESC
      `
    )
    .all(connectionId, ...activePairingStatuses) as MobileChannelPairingRow[]

  const matched = rows.find((row) => {
    return row.bind_code && decryptSettingValue(row.bind_code) === code
  })

  if (!matched) {
    return null
  }

  return updateMobileChannelPairing(matched.id, {
    status: "connected",
    bindCode: null,
    message: "移动端已绑定，可以直接发送任务。",
  })
}

export function getMobileChannelBinding({
  connectionId,
  externalUserId,
  conversationId,
}: {
  connectionId: string
  externalUserId: string
  conversationId: string
}) {
  const row = getStudioDatabase()
    .prepare(
      `
        SELECT id, connection_id, external_user_id, conversation_id,
               session_id, created_at, updated_at
        FROM mobile_channel_bindings
        WHERE connection_id = ? AND external_user_id = ? AND conversation_id = ?
      `
    )
    .get(connectionId, externalUserId, conversationId) as
    MobileChannelBindingRow | undefined

  return row ? mapBindingRow(row) : null
}

export function saveMobileChannelBinding({
  connectionId,
  externalUserId,
  conversationId,
  sessionId = null,
}: {
  connectionId: string
  externalUserId: string
  conversationId: string
  sessionId?: string | null
}) {
  const current = getMobileChannelBinding({
    connectionId,
    externalUserId,
    conversationId,
  })
  const timestamp = nowIso()

  getStudioDatabase()
    .prepare(
      `
        INSERT INTO mobile_channel_bindings (
          id, connection_id, external_user_id, conversation_id, session_id,
          created_at, updated_at
        ) VALUES (
          @id, @connectionId, @externalUserId, @conversationId, @sessionId,
          @createdAt, @updatedAt
        )
        ON CONFLICT(connection_id, external_user_id, conversation_id)
        DO UPDATE SET
          session_id = COALESCE(excluded.session_id, mobile_channel_bindings.session_id),
          updated_at = excluded.updated_at
      `
    )
    .run({
      id: current?.id ?? randomUUID(),
      connectionId,
      externalUserId,
      conversationId,
      sessionId,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })

  return getMobileChannelBinding({
    connectionId,
    externalUserId,
    conversationId,
  })
}

export function updateMobileChannelBindingSession(
  bindingId: string,
  sessionId: string | null
) {
  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_bindings
        SET session_id = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(sessionId, nowIso(), bindingId)
}

export function recordMobileChannelEvent({
  connectionId,
  externalEventId,
}: {
  connectionId: string
  externalEventId: string
}) {
  const timestamp = nowIso()
  const result = getStudioDatabase()
    .prepare(
      `
        INSERT OR IGNORE INTO mobile_channel_events (
          id, connection_id, external_event_id, created_at
        ) VALUES (?, ?, ?, ?)
      `
    )
    .run(randomUUID(), connectionId, externalEventId, timestamp)

  if (result.changes > 0) {
    getStudioDatabase()
      .prepare(
        `
          UPDATE mobile_channel_connections
          SET last_event_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, timestamp, connectionId)

    getStudioDatabase()
      .prepare(
        `
          DELETE FROM mobile_channel_events
          WHERE created_at < ?
        `
      )
      .run(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
  }

  return result.changes > 0
}
