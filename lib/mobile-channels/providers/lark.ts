import "server-only"

import { createLarkChannel, Domain } from "@larksuiteoapi/node-sdk"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
} from "../adapter"
import { createMobileChannelImageAttachment } from "../media"
import type { LarkMobileChannelCredentials } from "../types"

function replyOptions(target: Parameters<MobileChannelAdapter["sendText"]>[0]) {
  return target.replyContext.provider === "lark" &&
    target.replyContext.replyToMessageId
    ? { replyTo: target.replyContext.replyToMessageId }
    : undefined
}

export function createLarkAdapter({
  connection,
  onMessage,
  onConnected,
  onReconnecting,
  onConnectionError,
}: MobileChannelAdapterFactoryInput): MobileChannelAdapter {
  const credentials = connection.credentials as LarkMobileChannelCredentials
  if (
    credentials?.provider !== "lark" ||
    !credentials.appId ||
    !credentials.appSecret
  ) {
    throw new Error("Missing Lark credentials.")
  }

  const channel = createLarkChannel({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain: Domain.Lark,
    transport: "websocket",
    source: "astraflow-desktop",
    handshakeTimeoutMs: 20_000,
    wsConfig: { pingTimeout: 15 },
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
    const resources = message.resources
      .filter((resource) => resource.type === "image")
      .slice(0, 4)
    if (!message.content.trim() && resources.length === 0) {
      return
    }

    const attachments = await Promise.all(
      resources.map(async (resource) => {
        return createMobileChannelImageAttachment({
          buffer: await channel.downloadResource(resource.fileKey, "image"),
          fileName: resource.fileName,
        })
      })
    )

    await onMessage({
      id: message.messageId,
      connectionId: connection.id,
      provider: "lark",
      externalUserId: message.senderId,
      conversationId: message.chatId,
      text:
        message.content.trim() ||
        (attachments.length > 1
          ? "请查看并处理这些图片。"
          : "请查看并处理这张图片。"),
      attachments,
      senderName: message.senderName ?? null,
      createdAt: message.createTime || Date.now(),
      replyContext: {
        provider: "lark",
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
      // See the Feishu adapter: stop a reconnect loop that may outlive a
      // failed initial LarkChannel handshake.
      channel.rawWsClient?.close({})
      await channel.disconnect()
    },
    async sendText(target, text) {
      await channel.send(
        target.conversationId,
        { markdown: text.slice(0, 25_000) },
        replyOptions(target)
      )
    },
    async sendImage(target, image) {
      await channel.send(
        target.conversationId,
        { image: { source: image.buffer } },
        replyOptions(target)
      )
    },
    async sendVideo(target, video) {
      if (video.mimeType !== "video/mp4") {
        await channel.send(
          target.conversationId,
          { file: { source: video.buffer, fileName: video.fileName } },
          replyOptions(target)
        )
        return
      }
      await channel.send(
        target.conversationId,
        {
          video: {
            source: video.buffer,
            duration: video.durationSeconds
              ? Math.round(video.durationSeconds * 1_000)
              : undefined,
          },
        },
        replyOptions(target)
      )
    },
    async sendFile(target, file) {
      await channel.send(
        target.conversationId,
        { file: { source: file.buffer, fileName: file.fileName } },
        replyOptions(target)
      )
    },
  }
}
