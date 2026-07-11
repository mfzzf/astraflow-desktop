import "server-only"

import type { MobileChannelAdapter } from "./adapter"
import { handleMobileChannelMessage } from "./agent-bridge"
import { errorMessage } from "./http"
import { createDingtalkAdapter } from "./providers/dingtalk"
import { createFeishuAdapter } from "./providers/feishu"
import { createWechatAdapter } from "./providers/wechat"
import { createWecomAdapter } from "./providers/wecom"
import {
  getMobileChannelConnection,
  listMobileChannelConnectionRecords,
  updateMobileChannelConnectionState,
} from "./store"
import type {
  MobileChannelConnectionRecord,
  MobileChannelOutboundTarget,
} from "./types"

declare global {
  var astraflowMobileChannelAdapters:
    Map<string, MobileChannelAdapter> | undefined
  var astraflowMobileChannelConnectPromises:
    Map<string, Promise<MobileChannelConnectionRecord | null>> | undefined
  var astraflowMobileChannelRuntimeStart: Promise<void> | undefined
}

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

function createAdapter(connection: MobileChannelConnectionRecord) {
  const input = {
    connection,
    onMessage: (message: Parameters<typeof handleMobileChannelMessage>[0]) =>
      handleMobileChannelMessage(message, sendMobileChannelText),
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
    onConnectionError: (error: unknown) => {
      console.error("[mobile-channels] connection_error", {
        provider: connection.provider,
        connectionId: connection.id,
        error: errorMessage(error),
      })
      updateMobileChannelConnectionState(connection.id, {
        status: "error",
        lastError: errorMessage(error),
      })
    },
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
  await adapter?.disconnect()
  return updateMobileChannelConnectionState(connectionId, {
    status: "disconnected",
    lastError: null,
  })
}

export async function sendMobileChannelText(
  target: MobileChannelOutboundTarget,
  text: string
) {
  let adapter = adapters().get(target.connectionId)

  if (!adapter) {
    await connectMobileChannel(target.connectionId)
    adapter = adapters().get(target.connectionId)
  }

  if (!adapter) {
    throw new Error("Mobile channel is not connected.")
  }

  await adapter.sendText(target, text)
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
    })
  }

  return globalThis.astraflowMobileChannelRuntimeStart
}
