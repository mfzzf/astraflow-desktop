import "server-only"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
  MobileChannelOutboundFile,
  MobileChannelOutboundImage,
  MobileChannelOutboundVideo,
} from "../adapter"
import { delay } from "../http"
import { createMobileChannelImageAttachment, fetchMobileChannelImage } from "../media"
import type { DiscordMobileChannelCredentials } from "../types"
import {
  normalizeDiscordMessage,
  splitDiscordText,
  type DiscordAttachmentPayload,
  type DiscordMessagePayload,
} from "./discord-protocol"

type DiscordGatewayInfo = {
  url: string
  session_start_limit?: {
    remaining?: number
    reset_after?: number
  }
}

type DiscordGatewayPayload = {
  op: number
  d: unknown
  s?: number | null
  t?: string | null
}

type DiscordReadyPayload = {
  session_id?: string
  resume_gateway_url?: string
  user?: { id?: string }
}

type DiscordRestError = {
  code?: number
  message?: string
  retry_after?: number
}

const DISCORD_API_BASE_URL = "https://discord.com/api/v10"
const DISCORD_GATEWAY_VERSION = "10"
const DISCORD_INTENTS =
  (1 << 0) | // GUILDS
  (1 << 9) | // GUILD_MESSAGES
  (1 << 12) | // DIRECT_MESSAGES
  (1 << 15) // MESSAGE_CONTENT
const FATAL_GATEWAY_CLOSE_CODES = new Set([4004, 4010, 4011, 4013, 4014])

function safeFileName(value: string, fallback: string) {
  return value.trim().replace(/[\\/\0]/g, "-").slice(0, 180) || fallback
}

function gatewayUrl(value: string) {
  const url = new URL(value)
  url.searchParams.set("v", DISCORD_GATEWAY_VERSION)
  url.searchParams.set("encoding", "json")
  return url.toString()
}

function discordReplyContext(target: {
  replyContext: Parameters<MobileChannelAdapter["sendText"]>[0]["replyContext"]
}) {
  return target.replyContext.provider === "discord" ? target.replyContext : null
}

async function eventText(event: MessageEvent) {
  if (typeof event.data === "string") {
    return event.data
  }
  if (event.data instanceof Blob) {
    return event.data.text()
  }
  if (event.data instanceof ArrayBuffer) {
    return Buffer.from(event.data).toString("utf8")
  }
  return String(event.data)
}

export function createDiscordAdapter({
  connection,
  onMessage,
  onConnected,
  onReconnecting,
  onConnectionError,
}: MobileChannelAdapterFactoryInput): MobileChannelAdapter {
  const credentials = connection.credentials as DiscordMobileChannelCredentials
  if (
    credentials?.provider !== "discord" ||
    !/^\d{16,22}$/.test(credentials.applicationId) ||
    credentials.botToken.length < 30 ||
    /\s/.test(credentials.botToken)
  ) {
    throw new Error("Missing or invalid Discord bot credentials.")
  }

  let socket: WebSocket | null = null
  let gatewayBaseUrl: string | null = null
  let resumeGatewayUrl: string | null = null
  let sessionId: string | null = null
  let sequence: number | null = null
  let botUserId: string | null = null
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatAcknowledged = true
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let reconnectDelayOverride: number | null = null
  let stopped = false
  let readyResolve: (() => void) | null = null
  let readyReject: ((error: unknown) => void) | null = null
  const messageQueues = new Map<string, Promise<void>>()

  async function discordRequest<T>(
    path: string,
    init: RequestInit = {},
    retry = true
  ): Promise<T> {
    const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bot ${credentials.botToken}`,
        "User-Agent": "DiscordBot (https://astraflow.ai, 1.1.4)",
        ...init.headers,
      },
    })
    const raw = await response.text()
    let result: (T & DiscordRestError) | undefined
    if (raw) {
      try {
        result = JSON.parse(raw) as T & DiscordRestError
      } catch {
        throw new Error(`Discord returned an invalid response (${response.status}).`)
      }
    }

    if (response.status === 429 && retry) {
      const headerSeconds = Number(response.headers.get("retry-after"))
      const retryAfter = Math.min(
        30,
        Math.max(
          0.25,
          Number.isFinite(headerSeconds)
            ? headerSeconds
            : (result?.retry_after ?? 1)
        )
      )
      await delay(retryAfter * 1_000)
      return discordRequest<T>(path, init, false)
    }
    if (!response.ok) {
      throw new Error(
        result?.message || `Discord API request failed (${response.status}).`
      )
    }
    return result as T
  }

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function sendGateway(payload: DiscordGatewayPayload) {
    if (socket?.readyState !== WebSocket.OPEN) {
      return false
    }
    socket.send(JSON.stringify(payload))
    return true
  }

  function scheduleHeartbeat(intervalMs: number, initial = false) {
    clearHeartbeat()
    const wait = initial ? Math.random() * intervalMs : intervalMs
    heartbeatTimer = setTimeout(() => {
      if (!heartbeatAcknowledged) {
        requestReconnect("Discord heartbeat acknowledgement timed out.")
        return
      }
      heartbeatAcknowledged = false
      sendGateway({ op: 1, d: sequence })
      scheduleHeartbeat(intervalMs)
    }, wait)
    heartbeatTimer.unref?.()
  }

  function resetSession() {
    sessionId = null
    resumeGatewayUrl = null
    sequence = null
  }

  function fatalGatewayError(code: number) {
    switch (code) {
      case 4004:
        return "Discord bot token is invalid or has been revoked."
      case 4013:
        return "Discord Gateway intents are invalid."
      case 4014:
        return "Discord Message Content intent is not enabled for this bot."
      default:
        return `Discord Gateway closed with fatal code ${code}.`
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) {
      return
    }
    onReconnecting()
    const wait =
      reconnectDelayOverride ??
      Math.min(30_000, 1_000 * 2 ** Math.min(reconnectAttempts, 5))
    reconnectDelayOverride = null
    reconnectAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void openGateway().catch((error) => {
        if (!stopped) {
          onConnectionError(error)
          scheduleReconnect()
        }
      })
    }, wait)
    reconnectTimer.unref?.()
  }

  function requestReconnect(reason: string) {
    if (stopped) {
      return
    }
    const current = socket
    if (current) {
      try {
        current.close(4000, reason.slice(0, 120))
      } catch {
        socket = null
        scheduleReconnect()
        return
      }
      setTimeout(() => {
        if (socket === current) {
          socket = null
          scheduleReconnect()
        }
      }, 250).unref?.()
    } else {
      scheduleReconnect()
    }
  }

  async function downloadDiscordImage(attachment: DiscordAttachmentPayload) {
    const url = attachment.url || attachment.proxy_url
    if (!url) {
      throw new Error("Discord attachment URL is missing.")
    }

    return createMobileChannelImageAttachment({
      ...(await fetchMobileChannelImage(url)),
      fileName: attachment.filename,
    })
  }

  async function dispatchMessage(payload: DiscordMessagePayload) {
    const normalized = normalizeDiscordMessage(payload)
    if (!normalized || normalized.externalUserId === botUserId) {
      return
    }

    if (!normalized.text && normalized.imageAttachments.length === 0) {
      return
    }
    const attachments = await Promise.all(
      normalized.imageAttachments.map(downloadDiscordImage)
    )
    const fallbackText =
      attachments.length > 1
        ? "请查看并处理这些图片。"
        : "请查看并处理这张图片。"

    await onMessage({
      id: `discord:${normalized.id}`,
      connectionId: connection.id,
      provider: "discord",
      externalUserId: normalized.externalUserId,
      conversationId: normalized.conversationId,
      text: normalized.text || fallbackText,
      attachments,
      senderName: normalized.senderName,
      createdAt: normalized.createdAt,
      replyContext: {
        provider: "discord",
        messageId: normalized.id,
        guildId: normalized.guildId,
      },
    })
  }

  function enqueueMessage(payload: DiscordMessagePayload) {
    const key = payload.channel_id
    const previous = messageQueues.get(key) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => dispatchMessage(payload))
      .finally(() => {
        if (messageQueues.get(key) === next) {
          messageQueues.delete(key)
        }
      })
    messageQueues.set(key, next)
    return next
  }

  async function handleGatewayPayload(payload: DiscordGatewayPayload) {
    if (typeof payload.s === "number") {
      sequence = payload.s
    }

    switch (payload.op) {
      case 0:
        if (payload.t === "READY") {
          const ready = payload.d as DiscordReadyPayload
          if (!ready.session_id || !ready.resume_gateway_url) {
            throw new Error("Discord READY payload is incomplete.")
          }
          sessionId = ready.session_id
          resumeGatewayUrl = ready.resume_gateway_url
          botUserId = ready.user?.id ?? null
          reconnectAttempts = 0
          onConnected()
          readyResolve?.()
          readyResolve = null
          readyReject = null
        } else if (payload.t === "RESUMED") {
          reconnectAttempts = 0
          onConnected()
        } else if (payload.t === "MESSAGE_CREATE") {
          await enqueueMessage(payload.d as DiscordMessagePayload)
        }
        return
      case 1:
        heartbeatAcknowledged = false
        sendGateway({ op: 1, d: sequence })
        return
      case 7:
        requestReconnect("Discord requested a reconnect.")
        return
      case 9: {
        const canResume = payload.d === true
        if (!canResume) {
          resetSession()
        }
        reconnectDelayOverride = 1_000 + Math.random() * 4_000
        requestReconnect("Discord invalidated the Gateway session.")
        return
      }
      case 10: {
        const hello = payload.d as { heartbeat_interval?: number }
        if (!hello.heartbeat_interval) {
          throw new Error("Discord Gateway HELLO omitted heartbeat interval.")
        }
        heartbeatAcknowledged = true
        scheduleHeartbeat(hello.heartbeat_interval, true)
        if (sessionId && sequence !== null) {
          sendGateway({
            op: 6,
            d: {
              token: credentials.botToken,
              session_id: sessionId,
              seq: sequence,
            },
          })
        } else {
          sendGateway({
            op: 2,
            d: {
              token: credentials.botToken,
              intents: DISCORD_INTENTS,
              properties: {
                os: process.platform,
                browser: "astraflow-desktop",
                device: "astraflow-desktop",
              },
            },
          })
        }
        return
      }
      case 11:
        heartbeatAcknowledged = true
        return
    }
  }

  async function openGateway() {
    const base = resumeGatewayUrl ?? gatewayBaseUrl
    if (!base) {
      throw new Error("Discord Gateway URL is unavailable.")
    }

    const current = new WebSocket(gatewayUrl(base))
    socket = current
    current.addEventListener("message", (event) => {
      void eventText(event)
        .then((value) =>
          handleGatewayPayload(JSON.parse(value) as DiscordGatewayPayload)
        )
        .catch(onConnectionError)
    })
    current.addEventListener("error", () => {
      if (socket === current && current.readyState !== WebSocket.OPEN) {
        requestReconnect("Discord Gateway transport error.")
      }
    })
    current.addEventListener("close", (event) => {
      if (socket !== current) {
        return
      }
      socket = null
      clearHeartbeat()
      if (stopped) {
        return
      }
      if (FATAL_GATEWAY_CLOSE_CODES.has(event.code)) {
        const error = new Error(fatalGatewayError(event.code))
        readyReject?.(error)
        readyResolve = null
        readyReject = null
        onConnectionError(error)
        return
      }
      if (event.code === 4007 || event.code === 4009) {
        resetSession()
      }
      scheduleReconnect()
    })
  }

  function replyPayload(target: Parameters<MobileChannelAdapter["sendText"]>[0]) {
    const context = discordReplyContext(target)
    return {
      allowed_mentions: { parse: [], replied_user: false },
      ...(context
        ? {
            message_reference: {
              message_id: context.messageId,
              fail_if_not_exists: false,
            },
          }
        : {}),
    }
  }

  async function sendMedia(
    target: Parameters<MobileChannelAdapter["sendText"]>[0],
    media:
      | MobileChannelOutboundImage
      | MobileChannelOutboundVideo
      | MobileChannelOutboundFile
  ) {
    const fileName = safeFileName(media.fileName, `astraflow-${Date.now()}`)
    const form = new FormData()
    form.append(
      "payload_json",
      JSON.stringify({
        ...replyPayload(target),
        attachments: [{ id: 0, filename: fileName }],
      })
    )
    form.append(
      "files[0]",
      new Blob([new Uint8Array(media.buffer)], { type: media.mimeType }),
      fileName
    )
    await discordRequest(`/channels/${target.conversationId}/messages`, {
      method: "POST",
      body: form,
    })
  }

  return {
    async connect() {
      const gateway = await discordRequest<DiscordGatewayInfo>("/gateway/bot")
      if (!gateway.url) {
        throw new Error("Discord did not return a Gateway URL.")
      }
      if (gateway.session_start_limit?.remaining === 0) {
        const resetSeconds = Math.ceil(
          (gateway.session_start_limit.reset_after ?? 0) / 1_000
        )
        throw new Error(
          `Discord Gateway identify limit is exhausted; retry in ${resetSeconds} seconds.`
        )
      }
      gatewayBaseUrl = gateway.url
      stopped = false

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          const error = new Error("Discord Gateway connection timed out.")
          readyResolve = null
          readyReject = null
          reject(error)
        }, 20_000)
        timeout.unref?.()
        readyResolve = () => {
          clearTimeout(timeout)
          resolve()
        }
        readyReject = (error) => {
          clearTimeout(timeout)
          reject(error)
        }
        void openGateway().catch(readyReject)
      })
    },
    disconnect() {
      stopped = true
      clearHeartbeat()
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      const current = socket
      socket = null
      current?.close(1000, "AstraFlow disconnected")
      messageQueues.clear()
    },
    async sendText(target, text) {
      const chunks = splitDiscordText(text)
      for (const [index, chunk] of chunks.entries()) {
        await discordRequest(`/channels/${target.conversationId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: chunk,
            allowed_mentions: { parse: [] },
            ...(index === 0 ? replyPayload(target) : {}),
          }),
        })
      }
    },
    async sendImage(target, image) {
      await sendMedia(target, image)
    },
    async sendVideo(target, video) {
      await sendMedia(target, video)
    },
    async sendFile(target, file) {
      await sendMedia(target, file)
    },
  }
}
