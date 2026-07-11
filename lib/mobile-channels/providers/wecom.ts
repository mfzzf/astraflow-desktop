import "server-only"

import {
  WSClient,
  type ImageMessage,
  type MixedMessage,
  type TextMessage,
  type WsFrame,
} from "@wecom/aibot-node-sdk"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
} from "../adapter"
import { createMobileChannelImageAttachment } from "../media"
import type { WecomMobileChannelCredentials } from "../types"

export function createWecomAdapter({
  connection,
  onMessage,
  onConnected,
  onReconnecting,
  onConnectionError,
}: MobileChannelAdapterFactoryInput): MobileChannelAdapter {
  if (connection.credentials?.provider !== "wecom") {
    throw new Error("Missing WeCom credentials.")
  }

  const credentials = connection.credentials as WecomMobileChannelCredentials
  const client = new WSClient({
    botId: credentials.botId,
    secret: credentials.secret,
    maxReconnectAttempts: -1,
  })

  async function downloadImage(url: string, aesKey?: string) {
    const downloaded = await client.downloadFile(url, aesKey)
    return createMobileChannelImageAttachment({
      buffer: downloaded.buffer,
      fileName: downloaded.filename,
    })
  }

  client.on("message.text", (frame: WsFrame<TextMessage>) => {
    const body = frame.body
    if (!body?.from.userid || !body.text?.content?.trim()) {
      return
    }

    void onMessage({
      id: body.msgid,
      connectionId: connection.id,
      provider: "wecom",
      externalUserId: body.from.userid,
      conversationId: body.chatid || body.from.userid,
      text: body.text.content.trim(),
      senderName: null,
      createdAt: (body.create_time ?? Math.floor(Date.now() / 1_000)) * 1_000,
      replyContext: {
        provider: "wecom",
        responseUrl: body.response_url ?? null,
      },
    }).catch(onConnectionError)
  })
  client.on("message.image", (frame: WsFrame<ImageMessage>) => {
    const body = frame.body
    if (!body?.from.userid || !body.image?.url) {
      return
    }

    void downloadImage(body.image.url, body.image.aeskey)
      .then((attachment) =>
        onMessage({
          id: body.msgid,
          connectionId: connection.id,
          provider: "wecom",
          externalUserId: body.from.userid,
          conversationId: body.chatid || body.from.userid,
          text: "请查看并处理这张图片。",
          attachments: [attachment],
          senderName: null,
          createdAt:
            (body.create_time ?? Math.floor(Date.now() / 1_000)) * 1_000,
          replyContext: {
            provider: "wecom",
            responseUrl: body.response_url ?? null,
          },
        })
      )
      .catch(onConnectionError)
  })
  client.on("message.mixed", (frame: WsFrame<MixedMessage>) => {
    const body = frame.body
    if (!body?.from.userid) {
      return
    }

    void (async () => {
      const text = body.mixed.msg_item
        .filter((item) => item.msgtype === "text")
        .map((item) => item.text?.content?.trim())
        .filter((item): item is string => Boolean(item))
        .join("\n")
      const attachments = await Promise.all(
        body.mixed.msg_item
          .filter(
            (item) => item.msgtype === "image" && Boolean(item.image?.url)
          )
          .slice(0, 4)
          .map((item) => downloadImage(item.image!.url, item.image?.aeskey))
      )
      if (!text && attachments.length === 0) {
        return
      }

      await onMessage({
        id: body.msgid,
        connectionId: connection.id,
        provider: "wecom",
        externalUserId: body.from.userid,
        conversationId: body.chatid || body.from.userid,
        text: text || "请查看并处理这些图片。",
        attachments,
        senderName: null,
        createdAt: (body.create_time ?? Math.floor(Date.now() / 1_000)) * 1_000,
        replyContext: {
          provider: "wecom",
          responseUrl: body.response_url ?? null,
        },
      })
    })().catch(onConnectionError)
  })
  client.on("authenticated", onConnected)
  client.on("reconnecting", onReconnecting)
  client.on("disconnected", onReconnecting)
  client.on("error", onConnectionError)

  return {
    connect() {
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("企业微信连接超时。"))
        }, 20_000)
        timeout.unref()

        client.once("authenticated", () => {
          clearTimeout(timeout)
          resolve()
        })
        client.connect()
      })
    },
    disconnect() {
      client.disconnect()
    },
    async sendText(target, text) {
      await client.sendMessage(target.conversationId, {
        msgtype: "markdown",
        markdown: { content: text.slice(0, 20_000) },
      })
    },
    async sendImage(target, image) {
      const uploaded = await client.uploadMedia(image.buffer, {
        type: "image",
        filename: image.fileName,
      })
      await client.sendMediaMessage(
        target.conversationId,
        "image",
        uploaded.media_id
      )
    },
    async sendVideo(target, video) {
      const mediaType = video.mimeType === "video/mp4" ? "video" : "file"
      const uploaded = await client.uploadMedia(video.buffer, {
        type: mediaType,
        filename: video.fileName,
      })
      if (mediaType === "file") {
        await client.sendMediaMessage(
          target.conversationId,
          "file",
          uploaded.media_id
        )
        return
      }
      await client.sendMediaMessage(
        target.conversationId,
        "video",
        uploaded.media_id,
        {
          title: video.fileName,
          description: "AstraFlow Agent 生成的视频",
        }
      )
    },
  }
}
