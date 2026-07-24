import { randomUUID } from "node:crypto"

import {
  SUPPORTED_CHAT_REASONING_EFFORTS,
  type ChatReasoningEffort,
} from "@/lib/chat-models"
import { mobileChannelCredentialsSchema } from "@/lib/schemas/mobile-channels"
import { getStudioDatabase } from "@/lib/studio-db"
import {
  decryptSettingValue,
  encryptSettingValue,
} from "@/lib/studio-db/helpers"
import { mergeMobileChannelRuntimeMetadata } from "./metadata"
import type {
  MobileChannelBinding,
  MobileChannelConnection,
  MobileChannelConnectionRecord,
  MobileChannelConnectionStatus,
  MobileChannelCredentials,
  MobileChannelPairing,
  MobileChannelPairingExpirySource,
  MobileChannelPairingStatus,
  MobileChannelProvider,
  MobileChannelReplyGranularity,
} from "./types"
import { mobileChannelReplyGranularities } from "./types"

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
  issued_at: string | null
  step_expires_at: string | null
  expires_at: string
  expiry_source: string | null
  remote_status: string | null
  failure_code: string | null
  retryable: number
  rollback_connection: string | null
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

type MobileChannelPairingRollbackEnvelope = {
  attemptId: string
  replacementConnectionId: string
  previous: MobileChannelConnectionRecord | null
}

declare global {
  var astraflowMobileChannelRuntimeRecoveryHook:
    ((connectionId: string, reason: string) => void) | undefined
}

const activePairingStatuses: MobileChannelPairingStatus[] = [
  "preparing",
  "refreshing",
  "waiting_scan",
  "scanned",
  "verification_required",
  "waiting_confirmation",
  "validating",
  "awaiting_bind",
]

const terminalPairingStatuses: MobileChannelPairingStatus[] = [
  "connected",
  "paused",
  "expired",
  "cancelled",
  "error",
]

export function isActiveMobileChannelPairingStatus(
  status: MobileChannelPairingStatus
) {
  return activePairingStatuses.includes(status)
}

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

function parseReplyGranularity(
  metadata: Record<string, unknown>
): MobileChannelReplyGranularity {
  const value = metadata.replyGranularity

  return mobileChannelReplyGranularities.includes(
    value as MobileChannelReplyGranularity
  )
    ? (value as MobileChannelReplyGranularity)
    : "standard"
}

function parseMetadataString(
  metadata: Record<string, unknown>,
  key: string
): string | null {
  const value = metadata[key]

  return typeof value === "string" && value.trim() ? value : null
}

function parseReasoningEffort(
  metadata: Record<string, unknown>
): ChatReasoningEffort | null {
  const value = metadata.reasoningEffort

  return SUPPORTED_CHAT_REASONING_EFFORTS.includes(value as ChatReasoningEffort)
    ? (value as ChatReasoningEffort)
    : null
}

function parsePermissionMode(): "default" {
  // Historical connection metadata may contain ask/auto/full_access. Mobile
  // is not a trusted authority boundary, so every stored value reads as
  // Default until the stale metadata is rewritten by a settings update.
  return "default"
}

function mapConnectionRow(
  row: MobileChannelConnectionRow
): MobileChannelConnectionRecord {
  const credentials = parseCredentials(row.credentials)
  const metadata = parseJsonObject(row.metadata)

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
    metadata,
    defaultProjectId: row.default_project_id,
    replyGranularity: parseReplyGranularity(metadata),
    agentRuntimeId: parseMetadataString(metadata, "agentRuntimeId"),
    chatModel: parseMetadataString(metadata, "chatModel"),
    reasoningEffort: parseReasoningEffort(metadata),
    permissionMode: parsePermissionMode(),
    bindingPending: metadata.bindingPending === true,
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
    replyGranularity: connection.replyGranularity,
    agentRuntimeId: connection.agentRuntimeId,
    chatModel: connection.chatModel,
    reasoningEffort: connection.reasoningEffort,
    permissionMode: connection.permissionMode,
    bindingPending: connection.bindingPending,
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
    issuedAt: row.issued_at,
    stepExpiresAt: row.step_expires_at,
    expiresAt: row.expires_at,
    serverTime: nowIso(),
    expirySource: row.expiry_source as MobileChannelPairingExpirySource | null,
    remoteStatus: row.remote_status,
    failureCode: row.failure_code,
    retryable: row.retryable === 1,
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
  metadata,
  defaultProjectId,
  preserveAccountRuntimeMetadata = false,
}: {
  provider: MobileChannelProvider
  displayName: string
  credentials: MobileChannelCredentials
  accountId: string | null
  ownerExternalUserId?: string | null
  metadata?: Record<string, unknown>
  defaultProjectId?: string | null
  preserveAccountRuntimeMetadata?: boolean
}) {
  const current = getMobileChannelConnectionByProvider(provider)
  const timestamp = nowIso()
  const id = current?.id ?? randomUUID()
  const resolvedMetadata = { ...(metadata ?? current?.metadata ?? {}) }
  if (
    !preserveAccountRuntimeMetadata &&
    current &&
    current.accountId !== accountId
  ) {
    delete resolvedMetadata.telegramUpdateOffset
    delete resolvedMetadata.updatesBuffer
    delete resolvedMetadata.usageGuideSentAt
  }
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
      metadata: JSON.stringify(resolvedMetadata),
      defaultProjectId: projectId,
      createdAt: current?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })

  return getMobileChannelConnectionByProvider(provider)
}

function parseMobileChannelPairingRollbackEnvelope(
  encryptedValue: string
): MobileChannelPairingRollbackEnvelope | null {
  try {
    const value = JSON.parse(
      decryptSettingValue(encryptedValue)
    ) as Partial<MobileChannelPairingRollbackEnvelope>
    if (
      typeof value.attemptId !== "string" ||
      typeof value.replacementConnectionId !== "string" ||
      (value.previous !== null && typeof value.previous !== "object")
    ) {
      return null
    }
    return value as MobileChannelPairingRollbackEnvelope
  } catch {
    return null
  }
}

export function stageMobileChannelPairingReplacement({
  pairingId,
  attemptId,
  replacementConnectionId,
  previous,
}: {
  pairingId: string
  attemptId: string
  replacementConnectionId: string
  previous: MobileChannelConnectionRecord | null
}) {
  const rollbackConnection = encryptSettingValue(
    JSON.stringify({ attemptId, replacementConnectionId, previous })
  )

  return (
    getStudioDatabase()
      .prepare(
        `
          UPDATE mobile_channel_pairings
          SET connection_id = ?, rollback_connection = ?, updated_at = ?
          WHERE id = ? AND status = 'validating'
        `
      )
      .run(replacementConnectionId, rollbackConnection, nowIso(), pairingId)
      .changes === 1
  )
}

export function clearMobileChannelPairingReplacement(pairingId: string) {
  return getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_pairings
        SET rollback_connection = NULL, updated_at = ?
        WHERE id = ?
      `
    )
    .run(nowIso(), pairingId).changes
}

export function restoreMobileChannelPairingReplacement(pairingId: string) {
  const transaction = getStudioDatabase().transaction(() => {
    const row = getStudioDatabase()
      .prepare(
        `
          SELECT provider, connection_id, rollback_connection
          FROM mobile_channel_pairings
          WHERE id = ?
        `
      )
      .get(pairingId) as
      | {
          provider: MobileChannelProvider
          connection_id: string | null
          rollback_connection: string | null
        }
      | undefined

    if (!row?.rollback_connection) {
      return null
    }

    const rollback = parseMobileChannelPairingRollbackEnvelope(
      row.rollback_connection
    )
    clearMobileChannelPairingReplacement(pairingId)
    if (!rollback) {
      return null
    }

    const replacement = getMobileChannelConnectionByProvider(row.provider)
    if (
      !replacement ||
      replacement.id !== rollback.replacementConnectionId ||
      replacement.id !== row.connection_id ||
      replacement.metadata.pendingPairingAttemptId !== rollback.attemptId
    ) {
      return null
    }

    const previousCredentials = rollback.previous?.credentials
    if (!rollback.previous || !previousCredentials) {
      getStudioDatabase()
        .prepare(
          `
            UPDATE mobile_channel_pairings
            SET connection_id = NULL, updated_at = ?
            WHERE id = ?
          `
        )
        .run(nowIso(), pairingId)
      deleteMobileChannelConnection(replacement.id)
      return {
        restored: true,
        deletedReplacement: true,
        connectionId: replacement.id,
      }
    }

    const previous = rollback.previous
    const restored = saveMobileChannelConnection({
      provider: previous.provider,
      displayName: previous.displayName,
      credentials: previousCredentials,
      accountId: previous.accountId,
      ownerExternalUserId: previous.ownerExternalUserId,
      metadata: previous.metadata,
      defaultProjectId: previous.defaultProjectId,
      preserveAccountRuntimeMetadata: true,
    })
    if (!restored) {
      throw new Error("旧机器人配置恢复失败。")
    }

    updateMobileChannelConnectionSettings(restored.id, {
      enabled: previous.enabled,
      defaultProjectId: previous.defaultProjectId,
      replyGranularity: previous.replyGranularity,
      agentRuntimeId: previous.agentRuntimeId,
      chatModel: previous.chatModel,
      reasoningEffort: previous.reasoningEffort,
      permissionMode: previous.permissionMode,
    })
    updateMobileChannelConnectionState(restored.id, {
      status: "disconnected",
      lastError: previous.lastError,
      connectedAt: previous.connectedAt,
      lastEventAt: previous.lastEventAt,
    })

    return {
      restored: true,
      deletedReplacement: false,
      connectionId: restored.id,
    }
  })

  const result = transaction()
  if (result) {
    globalThis.astraflowMobileChannelRuntimeRecoveryHook?.(
      result.connectionId,
      "pairing-replacement-rollback"
    )
  }
  return result
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
  input: {
    enabled?: boolean
    defaultProjectId?: string | null
    replyGranularity?: MobileChannelReplyGranularity
    agentRuntimeId?: string | null
    chatModel?: string | null
    reasoningEffort?: ChatReasoningEffort | null
    permissionMode?: "default"
  }
) {
  const current = getMobileChannelConnection(connectionId)

  if (!current) {
    return null
  }

  const metadata = { ...current.metadata }
  if (input.replyGranularity !== undefined) {
    metadata.replyGranularity = input.replyGranularity
  }
  if (input.agentRuntimeId !== undefined) {
    metadata.agentRuntimeId = input.agentRuntimeId
  }
  if (input.chatModel !== undefined) {
    metadata.chatModel = input.chatModel
  }
  if (input.reasoningEffort !== undefined) {
    metadata.reasoningEffort = input.reasoningEffort
  }
  if (input.permissionMode !== undefined) {
    metadata.permissionMode = input.permissionMode
  }

  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_connections
        SET enabled = ?, default_project_id = ?, metadata = ?, updated_at = ?
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
      JSON.stringify(metadata),
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

  const nextMetadata = mergeMobileChannelRuntimeMetadata(
    current.metadata,
    metadata
  )

  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_connections
        SET metadata = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(JSON.stringify(nextMetadata), nowIso(), connectionId)

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
  issuedAt = null,
  stepExpiresAt = null,
  expirySource = null,
  remoteStatus = null,
  status = "preparing",
  message = null,
}: {
  provider: MobileChannelProvider
  expiresAt: string
  issuedAt?: string | null
  stepExpiresAt?: string | null
  expirySource?: MobileChannelPairingExpirySource | null
  remoteStatus?: string | null
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
    issuedAt,
    stepExpiresAt,
    expiresAt,
    serverTime: timestamp,
    expirySource,
    remoteStatus,
    failureCode: null,
    retryable: true,
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
          bind_code, issued_at, step_expires_at, expires_at, remote_status,
          expiry_source, failure_code, retryable, message, error, created_at,
          updated_at
        ) VALUES (
          @id, @provider, NULL, @status, NULL, NULL, NULL, @issuedAt,
          @stepExpiresAt, @expiresAt, @remoteStatus, @expirySource, NULL, 1,
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
    issuedAt: string | null
    stepExpiresAt: string | null
    expiresAt: string
    expirySource: MobileChannelPairingExpirySource | null
    remoteStatus: string | null
    failureCode: string | null
    retryable: boolean
    message: string | null
    error: string | null
  }>
) {
  const current = getMobileChannelPairing(pairingId)

  if (!current) {
    return null
  }

  if (
    terminalPairingStatuses.includes(current.status) &&
    input.status !== undefined &&
    input.status !== current.status
  ) {
    return current
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
            qr_code_data_url = ?, bind_code = ?, issued_at = ?,
            step_expires_at = ?, expires_at = ?, expiry_source = ?,
            remote_status = ?, failure_code = ?, retryable = ?, message = ?,
            error = ?, updated_at = ?
        WHERE id = ? AND status = ? AND updated_at = ?
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
      input.issuedAt === undefined ? current.issuedAt : input.issuedAt,
      input.stepExpiresAt === undefined
        ? current.stepExpiresAt
        : input.stepExpiresAt,
      input.expiresAt ?? current.expiresAt,
      input.expirySource === undefined
        ? current.expirySource
        : input.expirySource,
      input.remoteStatus === undefined
        ? current.remoteStatus
        : input.remoteStatus,
      input.failureCode === undefined ? current.failureCode : input.failureCode,
      input.retryable === undefined
        ? Number(current.retryable)
        : Number(input.retryable),
      input.message === undefined ? current.message : input.message,
      input.error === undefined ? current.error : input.error,
      nowIso(),
      pairingId,
      current.status,
      current.updatedAt
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
               qr_code_data_url, bind_code, issued_at, step_expires_at,
               expires_at, expiry_source, remote_status, failure_code,
               retryable, message, error, created_at, updated_at
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
               qr_code_data_url, bind_code, issued_at, step_expires_at,
               expires_at, expiry_source, remote_status, failure_code,
               retryable, message, error, created_at, updated_at
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
  const pairingIds = getStudioDatabase()
    .prepare(
      `
        SELECT id
        FROM mobile_channel_pairings
        WHERE provider = ? AND status IN (${placeholders})
          AND rollback_connection IS NOT NULL
      `
    )
    .all(provider, ...activePairingStatuses) as { id: string }[]

  const changes = getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_pairings
        SET status = 'cancelled',
            remote_status = 'superseded',
            failure_code = 'superseded',
            retryable = 1,
            message = '已由新的绑定请求替代。',
            updated_at = ?
        WHERE provider = ? AND status IN (${placeholders})
      `
    )
    .run(nowIso(), provider, ...activePairingStatuses).changes

  for (const pairing of pairingIds) {
    restoreMobileChannelPairingReplacement(pairing.id)
  }
  return changes
}

export function expireStaleMobileChannelPairings() {
  const placeholders = activePairingStatuses.map(() => "?").join(", ")
  const timestamp = nowIso()
  const pairingIds = getStudioDatabase()
    .prepare(
      `
        SELECT id
        FROM mobile_channel_pairings
        WHERE status IN (${placeholders}) AND expires_at <= ?
          AND rollback_connection IS NOT NULL
      `
    )
    .all(...activePairingStatuses, timestamp) as { id: string }[]

  getStudioDatabase()
    .prepare(
      `
        UPDATE mobile_channel_pairings
        SET status = 'expired',
            remote_status = 'expired',
            failure_code = 'pairing_expired',
            retryable = 1,
            message = CASE
              WHEN status = 'awaiting_bind' THEN '绑定已超时，请重新开始。'
              ELSE '二维码已过期，请重新生成。'
            END,
            updated_at = ?
        WHERE status IN (${placeholders}) AND expires_at <= ?
      `
    )
    .run(timestamp, ...activePairingStatuses, timestamp)

  for (const pairing of pairingIds) {
    restoreMobileChannelPairingReplacement(pairing.id)
  }
}

export function resolveMobileChannelBindCode({
  connectionId,
  code,
}: {
  connectionId: string
  code: string
}) {
  expireStaleMobileChannelPairings()

  const rows = getStudioDatabase()
    .prepare(
      `
        SELECT id, provider, connection_id, status, qr_payload,
               qr_code_data_url, bind_code, issued_at, step_expires_at,
               expires_at, expiry_source, remote_status, failure_code,
               retryable, message, error, created_at, updated_at
        FROM mobile_channel_pairings
        WHERE connection_id = ? AND status = 'awaiting_bind'
          AND expires_at > ?
        ORDER BY created_at DESC
      `
    )
    .all(connectionId, nowIso()) as MobileChannelPairingRow[]

  const matched = rows.find((row) => {
    return row.bind_code && decryptSettingValue(row.bind_code) === code
  })

  if (!matched) {
    return null
  }

  return mapPairingRow(matched)
}

export function completeMobileChannelBindCode(pairingId: string) {
  const current = getMobileChannelPairing(pairingId)
  if (!current || current.status !== "awaiting_bind") {
    return current
  }

  return updateMobileChannelPairing(pairingId, {
    status: "connected",
    bindCode: null,
    qrPayload: null,
    qrCodeDataUrl: null,
    issuedAt: null,
    stepExpiresAt: null,
    expirySource: null,
    remoteStatus: "bound",
    failureCode: null,
    retryable: false,
    message: "移动端已绑定，可以直接发送任务。",
    error: null,
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

export function getMobileChannelBindingBySessionId(sessionId: string) {
  const row = getStudioDatabase()
    .prepare(
      `
        SELECT id, connection_id, external_user_id, conversation_id,
               session_id, created_at, updated_at
        FROM mobile_channel_bindings
        WHERE session_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `
    )
    .get(sessionId) as MobileChannelBindingRow | undefined

  return row ? mapBindingRow(row) : null
}

export function listMobileChannelBindingsForConnection(connectionId: string) {
  const rows = getStudioDatabase()
    .prepare(
      `
        SELECT id, connection_id, external_user_id, conversation_id,
               session_id, created_at, updated_at
        FROM mobile_channel_bindings
        WHERE connection_id = ?
        ORDER BY updated_at DESC
      `
    )
    .all(connectionId) as MobileChannelBindingRow[]

  return rows.map(mapBindingRow)
}

export function deleteMobileChannelBindingsForConnection(connectionId: string) {
  return getStudioDatabase()
    .prepare("DELETE FROM mobile_channel_bindings WHERE connection_id = ?")
    .run(connectionId).changes
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

export function finalizeMobileChannelBinding({
  pairingId,
  connectionId,
  code,
  externalUserId,
  conversationId,
}: {
  pairingId: string
  connectionId: string
  code: string
  externalUserId: string
  conversationId: string
}) {
  const transaction = getStudioDatabase().transaction(() => {
    const pendingPairing = resolveMobileChannelBindCode({ connectionId, code })
    if (!pendingPairing || pendingPairing.id !== pairingId) {
      return null
    }

    const currentConnection = getMobileChannelConnection(connectionId)
    if (!currentConnection) {
      throw new Error("待绑定的机器人连接不存在。")
    }
    if (currentConnection.metadata.pendingBindingReset === true) {
      deleteMobileChannelBindingsForConnection(connectionId)
    }

    const binding = saveMobileChannelBinding({
      connectionId,
      externalUserId,
      conversationId,
    })
    if (!binding) {
      throw new Error("绑定关系写入后未能读取。")
    }

    const connection = updateMobileChannelConnectionMetadata(connectionId, {
      bindingPending: false,
      pendingPairingAttemptId: null,
      pendingBindingReset: null,
    })
    if (!connection) {
      throw new Error("机器人可用状态写入失败。")
    }

    const pairing = completeMobileChannelBindCode(pairingId)
    if (pairing?.status !== "connected") {
      throw new Error("绑定状态写入失败。")
    }
    clearMobileChannelPairingReplacement(pairingId)

    return { binding, connection, pairing }
  })

  return transaction()
}

export function finalizeOwnedMobileChannelPairing({
  pairingId,
  connectionId,
  pairingAttemptId,
  completion,
}: {
  pairingId: string
  connectionId: string
  pairingAttemptId: string
  completion?: {
    remoteStatus: string
    message: string
  }
}) {
  const transaction = getStudioDatabase().transaction(() => {
    const currentPairing = getMobileChannelPairing(pairingId)
    const currentConnection = getMobileChannelConnection(connectionId)
    if (
      currentPairing?.status !== "validating" ||
      currentPairing.connectionId !== connectionId ||
      currentConnection?.metadata.pendingPairingAttemptId !== pairingAttemptId
    ) {
      return null
    }

    if (currentConnection.metadata.pendingBindingReset === true) {
      deleteMobileChannelBindingsForConnection(connectionId)
    }

    const connection = updateMobileChannelConnectionMetadata(connectionId, {
      bindingPending: false,
      pendingPairingAttemptId: null,
      pendingBindingReset: null,
    })
    if (!connection) {
      throw new Error("机器人可用状态写入失败。")
    }

    const pairing = updateMobileChannelPairing(pairingId, {
      connectionId,
      status: "connected",
      bindCode: null,
      qrPayload: null,
      qrCodeDataUrl: null,
      issuedAt: null,
      stepExpiresAt: null,
      expirySource: null,
      remoteStatus: completion?.remoteStatus ?? "outbound_verified",
      failureCode: null,
      retryable: false,
      message:
        completion?.message ?? "绑定完成，机器人连接和消息发送均已验证。",
      error: null,
    })
    if (pairing?.status !== "connected") {
      throw new Error("绑定状态写入失败。")
    }
    clearMobileChannelPairingReplacement(pairingId)

    return { connection, pairing }
  })

  return transaction()
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
