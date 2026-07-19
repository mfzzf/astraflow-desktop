import {
  crossDeviceServiceApplySyncMutations,
  crossDeviceServiceAppendAgentRunEvents,
  crossDeviceServiceGetSyncSnapshot,
  crossDeviceServiceListMessages,
  crossDeviceServicePullSyncEvents,
  crossDeviceServiceRegisterDevice,
  type AstraflowV1Message,
  type AstraflowV1AgentRunEvent,
  type AstraflowV1Session,
  type AstraflowV1SyncMutation,
  type AstraflowV1SyncEventEnvelope,
} from "@/lib/generated/astraflow-api"
import { getStudioDatabase } from "@/lib/studio-db/connection"
import {
  acknowledgeStudioSyncOutbox,
  claimStudioSyncOutbox,
  failStudioSyncOutbox,
  getStudioSyncCursor,
  recordStudioSyncEvent,
  setStudioSyncCursor,
  type StudioSyncOutboxItem,
} from "@/lib/studio-db/sync"
import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"

import { getOrCreateDesktopDeviceIdentity } from "./device-identity"

const syncIntervalMs = 5_000

let runtimePromise: Promise<void> | null = null
let syncTimer: ReturnType<typeof setInterval> | null = null
let activeCycle: Promise<void> | null = null

export async function ensureCrossDeviceSyncStarted() {
  if (process.env.ASTRAFLOW_ELECTRON !== "1") return
  if (runtimePromise) return runtimePromise
  runtimePromise = Promise.resolve().then(async () => {
    await runSyncCycle()
    syncTimer = setInterval(() => void runSyncCycle(), syncIntervalMs)
    ;(syncTimer as unknown as { unref?: () => void }).unref?.()
  })
  return runtimePromise
}

export async function runSyncCycle() {
  if (activeCycle) return activeCycle
  activeCycle = (async () => {
    try {
      const tokens = await ensureValidStudioOAuthTokens()
      if (!tokens?.accessToken) return
      const authorization = `${tokens.tokenType ?? "Bearer"} ${tokens.accessToken}`
      const identity = getOrCreateDesktopDeviceIdentity()
      await registerDesktopDevice(authorization, identity)
      await flushOutbox(authorization, identity.deviceId)
      await catchUpAccountEvents(authorization)
    } catch (error) {
      console.warn(
        "[cross-device-sync] cycle failed:",
        error instanceof Error ? error.message : String(error)
      )
    }
  })().finally(() => {
    activeCycle = null
  })
  return activeCycle
}

async function registerDesktopDevice(
  authorization: string,
  identity: ReturnType<typeof getOrCreateDesktopDeviceIdentity>
) {
  const appVersion = process.env.ASTRAFLOW_APP_VERSION?.trim() || "development"
  await requireData(
    crossDeviceServiceRegisterDevice({
      headers: authHeaders(authorization),
      body: {
        deviceId: identity.deviceId,
        type: "desktop",
        name: identity.name,
        platform: `${process.platform}-${process.arch}`,
        appVersion,
        protocolVersion: 1,
        capabilities: {
          local_agent: true,
          local_files: true,
          workspace_gateway: true,
          runtime_ids: ["astraflow", "codex", "claude", "opencode"],
          screen_control: false,
        },
        publicKey: identity.publicKey,
        clientMutationId: `desktop-register:${identity.deviceId}:${appVersion}:v1`,
      },
      signal: AbortSignal.timeout(10_000),
    }),
    "Desktop device registration failed."
  )
}

async function flushOutbox(authorization: string, deviceId: string) {
  const items = claimStudioSyncOutbox()
  if (!items.length) return
  const runEvents = items.filter(
    (item) => item.entityType === "agent_run_event"
  )
  const mutations = items.filter(
    (item) => item.entityType !== "agent_run_event"
  )
  if (mutations.length) {
    await flushMutationOutbox(authorization, deviceId, mutations)
  }
  if (runEvents.length) {
    await flushRunEventOutbox(authorization, runEvents)
  }
}

async function flushMutationOutbox(
  authorization: string,
  deviceId: string,
  items: StudioSyncOutboxItem[]
) {
  let results: Awaited<
    ReturnType<typeof crossDeviceServiceApplySyncMutations>
  >["data"]
  try {
    const mutations = buildSyncMutations(items, deviceId)
    results = await requireData(
      crossDeviceServiceApplySyncMutations({
        headers: authHeaders(authorization),
        body: { sourceDeviceId: deviceId, mutations },
        signal: AbortSignal.timeout(20_000),
      }),
      "Cross-device mutation batch failed."
    )
  } catch (error) {
    for (const item of items) failStudioSyncOutbox(item, error)
    return
  }
  const byID = new Map(
    (results.results ?? []).map((result) => [result.mutationId, result])
  )
  for (const item of items) {
    const result = byID.get(item.id)
    if (result?.status === "applied") {
      acknowledgeStudioSyncOutbox(
        item.id,
        item.entityType,
        item.entityId,
        readNumber(result.entityVersion) || undefined
      )
    } else {
      failStudioSyncOutbox(
        item,
        new Error(result?.errorMessage || "Sync mutation result is missing.")
      )
    }
  }
}

async function flushRunEventOutbox(
  authorization: string,
  items: StudioSyncOutboxItem[]
) {
  const byRun = new Map<string, StudioSyncOutboxItem[]>()
  for (const item of items) {
    const runId = readString(item.payload.runId) || item.entityId
    if (!runId || !isRecord(item.payload.event)) {
      failStudioSyncOutbox(item, new Error("Run event outbox item is invalid."))
      continue
    }
    const group = byRun.get(runId) ?? []
    group.push(item)
    byRun.set(runId, group)
  }
  for (const [runId, group] of byRun) {
    group.sort(
      (left, right) =>
        readNumber(recordValue(left.payload.event, "seq")) -
        readNumber(recordValue(right.payload.event, "seq"))
    )
    const latest = group.at(-1)!
    const events = group.map(
      (item) => item.payload.event as AstraflowV1AgentRunEvent
    )
    try {
      await requireData(
        crossDeviceServiceAppendAgentRunEvents({
          headers: authHeaders(authorization),
          path: { runId },
          body: {
            runId,
            events,
            runStatus: readString(latest.payload.runStatus) || undefined,
            errorCode: readString(latest.payload.errorCode) || undefined,
            errorMessage: readString(latest.payload.errorMessage) || undefined,
          },
          signal: AbortSignal.timeout(15_000),
        }),
        "Desktop Agent event outbox could not be uploaded."
      )
      for (const item of group) {
        acknowledgeStudioSyncOutbox(item.id, "agent_run_event", item.entityId)
      }
    } catch (error) {
      for (const item of group) failStudioSyncOutbox(item, error)
    }
  }
}

function buildSyncMutations(items: StudioSyncOutboxItem[], deviceId: string) {
  const createdWorkspaces = new Set(
    items
      .filter(
        (item) => item.entityType === "workspace" && item.operation === "create"
      )
      .map((item) => item.entityId)
  )
  const createdSessions = new Set(
    items
      .filter(
        (item) => item.entityType === "session" && item.operation === "create"
      )
      .map((item) => item.entityId)
  )
  const sessionVersions = new Map<string, number>()
  return items.map((item): AstraflowV1SyncMutation => {
    if (item.entityType === "workspace" && item.operation === "create") {
      return {
        mutationId: item.id,
        operation: "workspace.create",
        payload: {
          workspaceId: item.entityId,
          type: readString(item.payload.type),
          name: readString(item.payload.name),
          ownerDeviceId:
            readString(item.payload.type) === "local_ref"
              ? deviceId
              : undefined,
          gatewayProtocolVersion:
            readNumber(item.payload.gatewayProtocolVersion) || 1,
        },
      }
    }
    if (item.entityType === "session" && item.operation === "create") {
      const workspaceId = readNullableString(item.payload.workspaceId)
      if (workspaceId && !createdWorkspaces.has(workspaceId))
        requireWorkspaceSynchronized(workspaceId)
      sessionVersions.set(item.entityId, 1)
      return {
        mutationId: item.id,
        operation: "session.create",
        payload: {
          sessionId: item.entityId,
          workspaceId: workspaceId ?? undefined,
          mode: readString(item.payload.mode),
          title: readString(item.payload.title),
          runtimeId: readNullableString(item.payload.runtimeId) ?? undefined,
          model: readNullableString(item.payload.model) ?? undefined,
          reasoningEffort:
            readNullableString(item.payload.reasoningEffort) ?? undefined,
          permissionMode: readString(item.payload.permissionMode),
        },
      }
    }
    if (item.entityType === "session" && item.operation === "update") {
      let expectedVersion = sessionVersions.get(item.entityId)
      if (!expectedVersion) {
        const row = getStudioDatabase()
          .prepare(
            `SELECT cloud_version FROM studio_sessions WHERE id = ? AND cloud_synced_at IS NOT NULL`
          )
          .get(item.entityId) as { cloud_version: number } | undefined
        expectedVersion = row?.cloud_version
      }
      if (!expectedVersion)
        throw new Error(
          "Session create mutation has not been acknowledged yet."
        )
      const workspaceId = optionalPayloadString(item.payload, "workspaceId")
      if (
        workspaceId.present &&
        workspaceId.value &&
        !createdWorkspaces.has(workspaceId.value)
      ) {
        requireWorkspaceSynchronized(workspaceId.value)
      }
      sessionVersions.set(item.entityId, expectedVersion + 1)
      return {
        mutationId: item.id,
        operation: "session.update",
        payload: {
          sessionId: item.entityId,
          expectedVersion: String(expectedVersion),
          ...optionalPayloadString(item.payload, "title").toObject("title"),
          ...optionalPayloadBoolean(item.payload, "pinned").toObject("pinned"),
          ...optionalPayloadBoolean(item.payload, "archived").toObject(
            "archived"
          ),
          ...optionalPayloadString(item.payload, "model").toObject("model"),
          ...optionalPayloadString(item.payload, "reasoningEffort").toObject(
            "reasoningEffort"
          ),
          ...optionalPayloadString(item.payload, "permissionMode").toObject(
            "permissionMode"
          ),
          ...optionalPayloadString(item.payload, "runtimeId").toObject(
            "runtimeId"
          ),
          ...workspaceId.toObject("workspaceId"),
        },
      }
    }
    if (item.entityType === "message" && item.operation === "create") {
      const sessionId = readString(item.payload.sessionId)
      if (!createdSessions.has(sessionId)) requireSessionSynchronized(sessionId)
      const parts = Array.isArray(item.payload.parts)
        ? item.payload.parts.filter(isRecord)
        : []
      return {
        mutationId: item.id,
        operation: "message.create",
        payload: {
          sessionId,
          messageId: item.entityId,
          role: readString(item.payload.role),
          status: readString(item.payload.status),
          content: isRecord(item.payload.content) ? item.payload.content : {},
          parts,
        },
      }
    }
    throw new Error(
      `Unsupported sync mutation ${item.entityType}/${item.operation}.`
    )
  })
}

async function catchUpAccountEvents(authorization: string) {
  let cursor = getStudioSyncCursor()
  for (let page = 0; page < 10; page += 1) {
    const response = await requireData(
      crossDeviceServicePullSyncEvents({
        headers: authHeaders(authorization),
        query: { after: String(cursor), limit: 200 },
        signal: AbortSignal.timeout(10_000),
      }),
      "Account sync catch-up failed."
    )
    if (response.resyncRequired) {
      await restoreAccountSnapshot(authorization)
      return
    }
    for (const event of response.events ?? []) {
      applySyncEvent(event)
      cursor = Math.max(cursor, readNumber(event.cursor))
    }
    if (!response.hasMore || !response.events?.length) break
  }
}

async function restoreAccountSnapshot(authorization: string) {
  const snapshot = await requireData(
    crossDeviceServiceGetSyncSnapshot({
      headers: authHeaders(authorization),
      query: { includeArchivedSessions: true },
      signal: AbortSignal.timeout(20_000),
    }),
    "Account sync snapshot could not be loaded."
  )
  if (snapshot.schemaVersion !== 1) {
    throw new Error(
      `Unsupported account sync snapshot schema ${snapshot.schemaVersion}.`
    )
  }
  const database = getStudioDatabase()
  database.transaction(() => {
    for (const session of snapshot.sessions ?? []) {
      applySessionEvent(
        database,
        sessionSnapshotPayload(session),
        readNumber(session.version)
      )
    }
  })()
  for (const session of snapshot.sessions ?? []) {
    if (!session.id) continue
    await restoreSessionMessages(authorization, session.id)
  }
  database.transaction(() => {
    setStudioSyncCursor(database, readNumber(snapshot.cursor))
  })()
}

async function restoreSessionMessages(
  authorization: string,
  sessionId: string
) {
  let pageToken = ""
  for (;;) {
    const page = await requireData(
      crossDeviceServiceListMessages({
        headers: authHeaders(authorization),
        path: { sessionId },
        query: { pageSize: 100, pageToken: pageToken || undefined },
        signal: AbortSignal.timeout(15_000),
      }),
      "Session messages could not be restored."
    )
    const database = getStudioDatabase()
    database.transaction(() => {
      for (const message of page.messages ?? []) {
        applyMessageEvent(database, messageSnapshotPayload(message))
      }
    })()
    if (!page.nextPageToken || page.nextPageToken === pageToken) return
    pageToken = page.nextPageToken
  }
}

function sessionSnapshotPayload(session: AstraflowV1Session) {
  return {
    id: session.id,
    mode: session.mode,
    title: session.title,
    workspace_id: session.workspaceId,
    runtime_id: session.runtimeId,
    model: session.model,
    reasoning_effort: session.reasoningEffort,
    permission_mode: session.permissionMode,
    pinned_at: session.pinnedAt,
    archived_at: session.archivedAt,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  }
}

function messageSnapshotPayload(message: AstraflowV1Message) {
  return {
    id: message.id,
    session_id: message.sessionId,
    role: message.role,
    status: message.status,
    content: message.content,
    parts: message.parts,
    created_at: message.createdAt,
  }
}

function applySyncEvent(event: AstraflowV1SyncEventEnvelope) {
  const eventId = readString(event.eventId)
  const cursor = readNumber(event.cursor)
  if (!eventId || !cursor) return
  const database = getStudioDatabase()
  database.transaction(() => {
    const exists = database
      .prepare(`SELECT 1 FROM studio_sync_inbox_dedup WHERE event_id = ?`)
      .get(eventId)
    if (exists) return
    const payload = isRecord(event.payload) ? event.payload : {}
    if (event.aggregateType === "session") {
      applySessionEvent(database, payload, readNumber(event.entityVersion))
    } else if (
      event.aggregateType === "message" &&
      event.eventType === "message.created"
    ) {
      applyMessageEvent(database, payload)
    }
    recordStudioSyncEvent(database, { eventId, cursor })
  })()
}

function applySessionEvent(
  database: ReturnType<typeof getStudioDatabase>,
  payload: Record<string, unknown>,
  version: number
) {
  const id = readString(payload.id)
  if (!id) return
  const timestamp = new Date().toISOString()
  const current = database
    .prepare(`SELECT id FROM studio_sessions WHERE id = ?`)
    .get(id)
  const mode = readString(payload.mode) || "chat"
  const title = readString(payload.title) || "New chat"
  const permissionMode = readString(payload.permission_mode) || "ask"
  const workspace = resolveLocalWorkspaceBinding(database, payload)
  if (!current) {
    database
      .prepare(
        `
          INSERT INTO studio_sessions (
            id, mode, title, workspace_id, project_id, permission_mode,
            chat_model, chat_runtime_id, chat_reasoning_effort,
            pinned_at, archived_at, created_at, updated_at,
            cloud_version, cloud_synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        mode,
        title,
        workspace.workspaceId,
        workspace.projectId,
        permissionMode,
        readNullableString(payload.model),
        readNullableString(payload.runtime_id),
        readNullableString(payload.reasoning_effort),
        readNullableString(payload.pinned_at),
        readNullableString(payload.archived_at),
        readString(payload.created_at) || timestamp,
        readString(payload.updated_at) || timestamp,
        version,
        timestamp
      )
    return
  }
  database
    .prepare(
      `
        UPDATE studio_sessions SET
          mode = ?, title = ?, permission_mode = ?, chat_model = ?,
          chat_runtime_id = ?, chat_reasoning_effort = ?, pinned_at = ?,
          archived_at = ?,
          workspace_id = CASE WHEN ? THEN ? ELSE workspace_id END,
          project_id = CASE WHEN ? THEN ? ELSE project_id END,
          updated_at = ?, cloud_version = ?, cloud_synced_at = ?
        WHERE id = ?
      `
    )
    .run(
      mode,
      title,
      permissionMode,
      readNullableString(payload.model),
      readNullableString(payload.runtime_id),
      readNullableString(payload.reasoning_effort),
      readNullableString(payload.pinned_at),
      readNullableString(payload.archived_at),
      workspace.present ? 1 : 0,
      workspace.workspaceId,
      workspace.present ? 1 : 0,
      workspace.projectId,
      readString(payload.updated_at) || timestamp,
      version,
      timestamp,
      id
    )
}

function resolveLocalWorkspaceBinding(
  database: ReturnType<typeof getStudioDatabase>,
  payload: Record<string, unknown>
) {
  if (!Object.hasOwn(payload, "workspace_id")) {
    return { present: false, workspaceId: null, projectId: null }
  }
  const workspaceId = readString(payload.workspace_id)
  if (!workspaceId) {
    return { present: true, workspaceId: null, projectId: null }
  }
  const row = database
    .prepare(
      `SELECT id, type, local_project_id FROM studio_workspaces WHERE id = ?`
    )
    .get(workspaceId) as
    { id: string; type: string; local_project_id: string | null } | undefined
  if (!row || row.type !== "local") {
    return { present: false, workspaceId: null, projectId: null }
  }
  return {
    present: true,
    workspaceId: row.id,
    projectId: row.local_project_id,
  }
}

function applyMessageEvent(
  database: ReturnType<typeof getStudioDatabase>,
  payload: Record<string, unknown>
) {
  const id = readString(payload.id)
  const sessionId = readString(payload.session_id)
  const role = readString(payload.role)
  if (!id || !sessionId || (role !== "user" && role !== "assistant")) return
  if (
    !database
      .prepare(`SELECT 1 FROM studio_sessions WHERE id = ?`)
      .get(sessionId)
  ) {
    return
  }
  const content = isRecord(payload.content) ? payload.content : {}
  const parts = Array.isArray(payload.parts) ? payload.parts : []
  const status = readString(payload.status)
  const createdAt = readString(payload.created_at) || new Date().toISOString()
  database
    .prepare(
      `
        INSERT INTO studio_messages (
          id, session_id, role, content, version_group_id, version_index,
          active_version, visible, parts, reasoning_content, status,
          created_at, cloud_synced_at
        ) VALUES (?, ?, ?, ?, ?, 1, 1, 1, ?, '', ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content, parts = excluded.parts,
          status = excluded.status, cloud_synced_at = excluded.cloud_synced_at
      `
    )
    .run(
      id,
      sessionId,
      role,
      readString(content.text),
      role === "assistant" ? id : null,
      parts.length ? JSON.stringify(parts) : null,
      status === "completed"
        ? "complete"
        : status === "failed"
          ? "error"
          : "streaming",
      createdAt,
      new Date().toISOString()
    )
}

function requireWorkspaceSynchronized(workspaceId: string | null) {
  if (!workspaceId) return
  const row = getStudioDatabase()
    .prepare(
      `SELECT cloud_synced_at FROM studio_workspaces WHERE id = ? AND cloud_synced_at IS NOT NULL`
    )
    .get(workspaceId)
  if (!row) throw new Error("Workspace mutation has not been acknowledged yet.")
}

function requireSessionSynchronized(sessionId: string) {
  const row = getStudioDatabase()
    .prepare(
      `SELECT cloud_synced_at FROM studio_sessions WHERE id = ? AND cloud_synced_at IS NOT NULL`
    )
    .get(sessionId)
  if (!row) throw new Error("Session mutation has not been acknowledged yet.")
}

function authHeaders(authorization: string) {
  return { Accept: "application/json", Authorization: authorization }
}

async function requireData<T>(
  promise: PromiseLike<{ data?: T; error?: unknown; response?: Response }>,
  fallback: string
) {
  const result = await promise
  if (result.data !== undefined) return result.data
  const detail =
    result.error instanceof Error
      ? result.error.message
      : typeof result.error === "string"
        ? result.error
        : fallback
  throw new Error(`${fallback} (${result.response?.status ?? 503}: ${detail})`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function recordValue(value: unknown, key: string) {
  return isRecord(value) ? value[key] : undefined
}

function readString(value: unknown) {
  return typeof value === "string" ? value : ""
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value ? value : null
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function optionalPayloadString(payload: Record<string, unknown>, key: string) {
  const present = Object.hasOwn(payload, key)
  const value = readString(payload[key])
  return optionalValue(present, value)
}

function optionalPayloadBoolean(payload: Record<string, unknown>, key: string) {
  const present = Object.hasOwn(payload, key)
  const value = typeof payload[key] === "boolean" ? payload[key] : false
  return optionalValue(present, value)
}

function optionalValue<T>(present: boolean, value: T) {
  return {
    present,
    value,
    toObject<Key extends string>(key: Key) {
      return (present ? { [key]: value } : {}) as Partial<Record<Key, T>>
    },
  }
}
