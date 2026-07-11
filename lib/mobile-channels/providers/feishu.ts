import "server-only"

import { createLarkChannel } from "@larksuiteoapi/node-sdk"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
} from "../adapter"
import type { FeishuMobileChannelCredentials } from "../types"

export function createFeishuAdapter({
  connection,
  onMessage,
  onConnected,
  onReconnecting,
  onConnectionError,
}: MobileChannelAdapterFactoryInput): MobileChannelAdapter {
  if (connection.credentials?.provider !== "feishu") {
    throw new Error("Missing Feishu credentials.")
  }

  const credentials = connection.credentials as FeishuMobileChannelCredentials
  const channel = createLarkChannel({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    transport: "websocket",
    source: "astraflow-desktop",
    handshakeTimeoutMs: 20_000,
    includeRawEvent: false,
    policy: {
      dmMode: "open",
      requireMention: true,
      respondToMentionAll: false,
    },
    safety: {
      staleMessageWindowMs: 5 * 60 * 1_000,
      chatQueue: { enabled: true },
    },
  })

  channel.on("message", async (message) => {
    if (!message.content.trim()) {
      return
    }

    await onMessage({
      id: message.messageId,
      connectionId: connection.id,
      provider: "feishu",
      externalUserId: message.senderId,
      conversationId: message.chatId,
      text: message.content.trim(),
      senderName: message.senderName ?? null,
      createdAt: message.createTime || Date.now(),
      replyContext: {
        provider: "feishu",
        replyToMessageId: message.messageId,
      },
    })
  })
  channel.on("reconnected", onConnected)
  channel.on("reconnecting", onReconnecting)
  channel.on("error", onConnectionError)

  return {
    async connect() {
      await channel.connect()
    },
    async disconnect() {
      await channel.disconnect()
    },
    async sendText(target, text) {
      await channel.send(
        target.conversationId,
        { markdown: text.slice(0, 25_000) },
        target.replyContext.provider === "feishu" &&
          target.replyContext.replyToMessageId
          ? { replyTo: target.replyContext.replyToMessageId }
          : undefined
      )
    },
  }
}
