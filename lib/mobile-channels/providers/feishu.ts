import "server-only"

import { createLarkChannel, Domain } from "@larksuiteoapi/node-sdk"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
} from "../adapter"
import { createMobileChannelImageAttachment } from "../media"
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
    domain:
      credentials.tenantBrand === "lark" ? Domain.Lark : Domain.Feishu,
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
    const imageResources = message.resources
      .filter((resource) => resource.type === "image")
      .slice(0, 4)
    if (!message.content.trim() && imageResources.length === 0) {
      return
    }

    const attachments = await Promise.all(
      imageResources.map(async (resource) =>
        createMobileChannelImageAttachment({
          buffer: await channel.downloadResource(resource.fileKey, "image"),
          fileName: resource.fileName,
        })
      )
    )

    await onMessage({
      id: message.messageId,
      connectionId: connection.id,
      provider: "feishu",
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
      // LarkChannel.disconnect() is a no-op when its outer 15s handshake
      // timeout fires before `connected` flips true. Close the underlying
      // reconnect loop as well so recovery does not leave a ghost client.
      channel.rawWsClient?.close({})
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
    async sendImage(target, image) {
      await channel.send(
        target.conversationId,
        { image: { source: image.buffer } },
        target.replyContext.provider === "feishu" &&
          target.replyContext.replyToMessageId
          ? { replyTo: target.replyContext.replyToMessageId }
          : undefined
      )
    },
    async sendVideo(target, video) {
      if (video.mimeType !== "video/mp4") {
        await channel.send(
          target.conversationId,
          { file: { source: video.buffer, fileName: video.fileName } },
          target.replyContext.provider === "feishu" &&
            target.replyContext.replyToMessageId
            ? { replyTo: target.replyContext.replyToMessageId }
            : undefined
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
        target.replyContext.provider === "feishu" &&
          target.replyContext.replyToMessageId
          ? { replyTo: target.replyContext.replyToMessageId }
          : undefined
      )
    },
    async sendFile(target, file) {
      await channel.send(
        target.conversationId,
        { file: { source: file.buffer, fileName: file.fileName } },
        target.replyContext.provider === "feishu" &&
          target.replyContext.replyToMessageId
          ? { replyTo: target.replyContext.replyToMessageId }
          : undefined
      )
    },
  }
}
