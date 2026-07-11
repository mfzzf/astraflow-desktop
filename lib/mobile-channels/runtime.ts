import "server-only"

import type { MobileChannelAdapter } from "./adapter"
import { handleMobileChannelMessage } from "./agent-bridge"
import { errorMessage } from "./http"
import { getWechatInboundBatcher } from "./inbound-batcher"
import {
  completeMobileChannelOutbox,
  enqueueMobileChannelOutbox,
  failMobileChannelOutbox,
  listDueMobileChannelOutbox,
  readMobileChannelOutboxPayload,
  type MobileChannelOutboxPayload,
} from "./outbox"
import { createDingtalkAdapter } from "./providers/dingtalk"
import { createDiscordAdapter } from "./providers/discord"
import { createFeishuAdapter } from "./providers/feishu"
import { createLarkAdapter } from "./providers/lark"
import { createTelegramAdapter } from "./providers/telegram"
import { createWechatAdapter } from "./providers/wechat"
import { createWecomAdapter } from "./providers/wecom"
import {
  getMobileChannelBinding,
  getMobileChannelConnection,
  listMobileChannelConnectionRecords,
  recordMobileChannelEvent,
  updateMobileChannelConnectionState,
} from "./store"
import type {
  MobileChannelConnectionRecord,
  MobileChannelInboundMessage,
  MobileChannelOutboundTarget,
} from "./types"

declare global {
  var astraflowMobileChannelAdapters:
    Map<string, MobileChannelAdapter> | undefined
  var astraflowMobileChannelConnectPromises:
    Map<string, Promise<MobileChannelConnectionRecord | null>> | undefined
  var astraflowMobileChannelRuntimeStart: Promise<void> | undefined
  var astraflowMobileChannelRecovery: Promise<MobileChannelRecoveryResult> | undefined
  var astraflowMobileChannelSupervisor:
    | ReturnType<typeof setInterval>
    | undefined
  var astraflowMobileChannelOutboxDrain: Promise<number> | undefined
  var astraflowMobileChannelOutboxInFlight: Set<string> | undefined
  var astraflowMobileChannelTypingTargets:
    | Map<string, MobileChannelOutboundTarget>
    | undefined
}

type MobileChannelRecoveryResult = {
  reason: string
  attempted: number
  connected: number
  failed: number
}

const MOBILE_CHANNEL_SUPERVISOR_INTERVAL_MS = 20_000
const MOBILE_CHANNEL_STALE_CONNECTION_MS = 45_000

function adapters() {
  if (!globalThis.astraflowMobileChannelAdapters) {
    globalThis.astraflowMobileChannelAdapters = new Map()
  }

  return globalThis.astraflowMobileChannelAdapters
}

function connectPromises() {
  if (!globalThis.astraflowMobileChannelConnectPromises) {
    globalThis.astraflowMobileChannelConnectPromises = new Map()
  }

  return globalThis.astraflowMobileChannelConnectPromises
}

function outboxInFlight() {
  if (!globalThis.astraflowMobileChannelOutboxInFlight) {
    globalThis.astraflowMobileChannelOutboxInFlight = new Set()
  }

  return globalThis.astraflowMobileChannelOutboxInFlight
}

function typingTargets() {
  if (!globalThis.astraflowMobileChannelTypingTargets) {
    globalThis.astraflowMobileChannelTypingTargets = new Map()
  }

  return globalThis.astraflowMobileChannelTypingTargets
}

function typingTargetKey(target: MobileChannelOutboundTarget) {
  return `${target.connectionId}:${target.externalUserId}:${target.conversationId}`
}

function canUseWechatDrafts(message: MobileChannelInboundMessage) {
  const connection = getMobileChannelConnection(message.connectionId)
  if (!connection) {
    return false
  }

  if (connection.ownerExternalUserId === message.externalUserId) {
    return true
  }

  return Boolean(
    getMobileChannelBinding({
      connectionId: message.connectionId,
      externalUserId: message.externalUserId,
      conversationId: message.conversationId,
    })
  )
}

async function ingestMobileChannelMessage(
  message: MobileChannelInboundMessage,
  onError: (error: unknown) => void
) {
  if (message.provider !== "wechat") {
    await handleMobileChannelMessage(
      message,
      sendMobileChannelText,
      sendMobileChannelImage,
      sendMobileChannelVideo,
      sendMobileChannelFile,
      setMobileChannelTyping
    )
    return
  }

  if (
    !recordMobileChannelEvent({
      connectionId: message.connectionId,
      externalEventId: message.id,
    })
  ) {
    return
  }

  const dispatch = (candidate: MobileChannelInboundMessage) =>
    handleMobileChannelMessage(
      candidate,
      sendMobileChannelText,
      sendMobileChannelImage,
      sendMobileChannelVideo,
      sendMobileChannelFile,
      setMobileChannelTyping,
      { eventAlreadyRecorded: true }
    )

  if (!canUseWechatDrafts(message)) {
    await dispatch(message)
    return
  }

  await getWechatInboundBatcher().enqueue({
    message,
    dispatch,
    sendText: sendMobileChannelText,
    onError,
  })
}

function createAdapter(connection: MobileChannelConnectionRecord) {
  const onConnectionError = (error: unknown) => {
    console.error("[mobile-channels] connection_error", {
      provider: connection.provider,
      connectionId: connection.id,
      error: errorMessage(error),
    })
    updateMobileChannelConnectionState(connection.id, {
      status: "error",
      lastError: errorMessage(error),
    })
  }
  const input = {
    connection,
    onMessage: (message: Parameters<typeof handleMobileChannelMessage>[0]) =>
      ingestMobileChannelMessage(message, onConnectionError),
    onConnected: () => {
      updateMobileChannelConnectionState(connection.id, {
        status: "connected",
        lastError: null,
      })
    },
    onReconnecting: () => {
      updateMobileChannelConnectionState(connection.id, {
        status: "connecting",
      })
    },
    onConnectionError,
  }

  switch (connection.provider) {
    case "wechat":
      return createWechatAdapter(input)
    case "wecom":
      return createWecomAdapter(input)
    case "feishu":
      return createFeishuAdapter(input)
    case "dingtalk":
      return createDingtalkAdapter(input)
    case "lark":
      return createLarkAdapter(input)
    case "telegram":
      return createTelegramAdapter(input)
    case "discord":
      return createDiscordAdapter(input)
  }
}

async function performConnectMobileChannel(connectionId: string) {
  const connection = getMobileChannelConnection(connectionId)

  if (!connection?.enabled || !connection.credentials) {
    throw new Error("Mobile channel is disabled or not configured.")
  }

  const existing = adapters().get(connectionId)
  if (existing) {
    await existing.disconnect()
    adapters().delete(connectionId)
  }

  updateMobileChannelConnectionState(connectionId, {
    status: "connecting",
    lastError: null,
  })
  const adapter = createAdapter(connection)
  adapters().set(connectionId, adapter)

  try {
    await adapter.connect()
    for (const target of typingTargets().values()) {
      if (target.connectionId !== connectionId) {
        continue
      }
      try {
        await adapter.setTyping?.(target, true)
      } catch (error) {
        console.warn("[mobile-channels] typing_restore_failed", {
          provider: target.provider,
          connectionId,
          error: errorMessage(error),
        })
      }
    }
    updateMobileChannelConnectionState(connectionId, {
      status: "connected",
      connectedAt: new Date().toISOString(),
      lastError: null,
    })
    return getMobileChannelConnection(connectionId)
  } catch (error) {
    adapters().delete(connectionId)
    await adapter.disconnect()
    updateMobileChannelConnectionState(connectionId, {
      status: "error",
      lastError: errorMessage(error),
    })
    throw error
  }
}

export function connectMobileChannel(connectionId: string) {
  const running = connectPromises().get(connectionId)
  if (running) {
    return running
  }

  const operation = performConnectMobileChannel(connectionId).finally(() => {
    if (connectPromises().get(connectionId) === operation) {
      connectPromises().delete(connectionId)
    }
  })
  connectPromises().set(connectionId, operation)

  return operation
}

export async function disconnectMobileChannel(connectionId: string) {
  await connectPromises()
    .get(connectionId)
    ?.catch(() => undefined)
  const adapter = adapters().get(connectionId)
  adapters().delete(connectionId)
  getWechatInboundBatcher().discardConnection(connectionId)
  await adapter?.disconnect()
  return updateMobileChannelConnectionState(connectionId, {
    status: "disconnected",
    lastError: null,
  })
}

function connectionNeedsRecovery(
  connection: MobileChannelConnectionRecord,
  forceReconnect: boolean
) {
  if (forceReconnect || !adapters().has(connection.id)) {
    return true
  }

  if (connection.status === "disconnected") {
    return true
  }

  if (connection.status !== "error") {
    return false
  }

  const updatedAt = Date.parse(connection.updatedAt)
  return (
    !Number.isFinite(updatedAt) ||
    Date.now() - updatedAt >= MOBILE_CHANNEL_STALE_CONNECTION_MS
  )
}

async function performMobileChannelRecovery({
  forceReconnect,
  reason,
}: {
  forceReconnect: boolean
  reason: string
}): Promise<MobileChannelRecoveryResult> {
  const connections = listMobileChannelConnectionRecords().filter(
    (connection) =>
      connection.enabled &&
      connection.configured &&
      connectionNeedsRecovery(connection, forceReconnect)
  )
  const results = await Promise.allSettled(
    connections.map((connection) => connectMobileChannel(connection.id))
  )
  const connected = results.filter(
    (result) => result.status === "fulfilled"
  ).length
  const failed = results.length - connected
  await drainMobileChannelOutbox({ force: forceReconnect })

  if (connections.length > 0) {
    console.info("[mobile-channels] recovery_completed", {
      reason,
      forceReconnect,
      attempted: connections.length,
      connected,
      failed,
    })
  }

  return {
    reason,
    attempted: connections.length,
    connected,
    failed,
  }
}

async function connectedAdapter(connectionId: string) {
  let adapter = adapters().get(connectionId)

  if (!adapter) {
    await connectMobileChannel(connectionId)
    adapter = adapters().get(connectionId)
  }

  if (!adapter) {
    throw new Error("Mobile channel is not connected.")
  }

  return adapter
}

async function deliverMobileChannelPayload(
  adapter: MobileChannelAdapter,
  target: MobileChannelOutboundTarget,
  payload: MobileChannelOutboxPayload
) {
  const deliveryTarget = { ...target, durable: false }

  switch (payload.kind) {
    case "text":
      await adapter.sendText(deliveryTarget, payload.text)
      return
    case "image":
      await adapter.sendImage(deliveryTarget, payload.image)
      return
    case "video":
      await adapter.sendVideo(deliveryTarget, payload.video)
      return
    case "file":
      await adapter.sendFile(deliveryTarget, payload.file)
  }
}

async function sendMobileChannelPayload(
  target: MobileChannelOutboundTarget,
  payload: MobileChannelOutboxPayload
) {
  let outboxId: string | null = null

  if (target.durable) {
    try {
      outboxId = await enqueueMobileChannelOutbox({ target, payload })
      outboxInFlight().add(outboxId)
    } catch (error) {
      console.error("[mobile-channels] outbox_enqueue_failed", {
        provider: target.provider,
        connectionId: target.connectionId,
        kind: payload.kind,
        error: errorMessage(error),
      })
    }
  }

  try {
    const adapter = await connectedAdapter(target.connectionId)
    await deliverMobileChannelPayload(adapter, target, payload)
    if (outboxId) {
      await completeMobileChannelOutbox(outboxId)
    }
  } catch (error) {
    if (outboxId) {
      failMobileChannelOutbox(outboxId, errorMessage(error))
    }
    throw error
  } finally {
    if (outboxId) {
      outboxInFlight().delete(outboxId)
    }
  }
}

async function performMobileChannelOutboxDrain(force: boolean) {
  const records = listDueMobileChannelOutbox({ force })
  const failedConnections = new Set<string>()
  let delivered = 0

  for (const record of records) {
    if (
      outboxInFlight().has(record.id) ||
      failedConnections.has(record.connectionId)
    ) {
      continue
    }

    const connection = getMobileChannelConnection(record.connectionId)
    if (!connection?.enabled || !connection.configured) {
      continue
    }

    outboxInFlight().add(record.id)
    let payload: MobileChannelOutboxPayload
    try {
      payload = await readMobileChannelOutboxPayload(record)
    } catch (error) {
      console.error("[mobile-channels] outbox_payload_discarded", {
        provider: record.target.provider,
        connectionId: record.connectionId,
        kind: record.kind,
        error: errorMessage(error),
      })
      try {
        await completeMobileChannelOutbox(record.id)
      } finally {
        outboxInFlight().delete(record.id)
      }
      continue
    }

    try {
      const adapter = await connectedAdapter(record.connectionId)
      await deliverMobileChannelPayload(adapter, record.target, payload)
      await completeMobileChannelOutbox(record.id)
      delivered += 1
      console.info("[mobile-channels] outbox_delivered", {
        provider: record.target.provider,
        connectionId: record.connectionId,
        kind: record.kind,
        attempts: record.attempts,
      })
    } catch (error) {
      failedConnections.add(record.connectionId)
      failMobileChannelOutbox(record.id, errorMessage(error))
      console.warn("[mobile-channels] outbox_delivery_failed", {
        provider: record.target.provider,
        connectionId: record.connectionId,
        kind: record.kind,
        attempts: record.attempts + 1,
        error: errorMessage(error),
      })
    } finally {
      outboxInFlight().delete(record.id)
    }
  }

  return delivered
}

export function drainMobileChannelOutbox({
  force = false,
}: { force?: boolean } = {}) {
  const running = globalThis.astraflowMobileChannelOutboxDrain
  if (running) {
    return running
  }

  const operation = performMobileChannelOutboxDrain(force).finally(() => {
    if (globalThis.astraflowMobileChannelOutboxDrain === operation) {
      globalThis.astraflowMobileChannelOutboxDrain = undefined
    }
  })
  globalThis.astraflowMobileChannelOutboxDrain = operation
  return operation
}

export function recoverMobileChannels({
  forceReconnect = false,
  reason = "supervisor",
}: {
  forceReconnect?: boolean
  reason?: string
} = {}): Promise<MobileChannelRecoveryResult> {
  startMobileChannelConnectionSupervisor()

  const running = globalThis.astraflowMobileChannelRecovery
  if (running) {
    return forceReconnect
      ? running.then(() => recoverMobileChannels({ forceReconnect, reason }))
      : running
  }

  const operation = performMobileChannelRecovery({
    forceReconnect,
    reason,
  }).finally(() => {
    if (globalThis.astraflowMobileChannelRecovery === operation) {
      globalThis.astraflowMobileChannelRecovery = undefined
    }
  })
  globalThis.astraflowMobileChannelRecovery = operation
  return operation
}

function startMobileChannelConnectionSupervisor() {
  if (globalThis.astraflowMobileChannelSupervisor) {
    return
  }

  const timer = setInterval(() => {
    void recoverMobileChannels().catch((error) => {
      console.error(
        "[mobile-channels] supervisor_failed",
        errorMessage(error)
      )
    })
  }, MOBILE_CHANNEL_SUPERVISOR_INTERVAL_MS)
  timer.unref?.()
  globalThis.astraflowMobileChannelSupervisor = timer
}

export async function sendMobileChannelText(
  target: MobileChannelOutboundTarget,
  text: string
) {
  await sendMobileChannelPayload(target, { kind: "text", text })
}

export async function sendMobileChannelImage(
  target: MobileChannelOutboundTarget,
  image: Parameters<MobileChannelAdapter["sendImage"]>[1]
) {
  await sendMobileChannelPayload(target, { kind: "image", image })
}

export async function sendMobileChannelVideo(
  target: MobileChannelOutboundTarget,
  video: Parameters<MobileChannelAdapter["sendVideo"]>[1]
) {
  await sendMobileChannelPayload(target, { kind: "video", video })
}

export async function sendMobileChannelFile(
  target: MobileChannelOutboundTarget,
  file: Parameters<MobileChannelAdapter["sendFile"]>[1]
) {
  await sendMobileChannelPayload(target, { kind: "file", file })
}

export async function setMobileChannelTyping(
  target: MobileChannelOutboundTarget,
  typing: boolean
) {
  const key = typingTargetKey(target)
  if (!typing) {
    typingTargets().delete(key)
    await adapters().get(target.connectionId)?.setTyping?.(target, false)
    return
  }

  typingTargets().set(key, target)
  const adapter = await connectedAdapter(target.connectionId)
  await adapter.setTyping?.(target, true)
}

export function ensureMobileChannelRuntimeStarted() {
  if (!globalThis.astraflowMobileChannelRuntimeStart) {
    globalThis.astraflowMobileChannelRuntimeStart = Promise.allSettled(
      listMobileChannelConnectionRecords()
        .filter((connection) => connection.enabled && connection.configured)
        .map((connection) => connectMobileChannel(connection.id))
    ).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(
            "[mobile-channels] startup_connection_failed",
            errorMessage(result.reason)
          )
        }
      }
      void drainMobileChannelOutbox({ force: true }).catch((error) => {
        console.error(
          "[mobile-channels] startup_outbox_drain_failed",
          errorMessage(error)
        )
      })
      startMobileChannelConnectionSupervisor()
    })
  }

  startMobileChannelConnectionSupervisor()

  return globalThis.astraflowMobileChannelRuntimeStart
}
