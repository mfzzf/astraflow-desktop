import "server-only"

import { WSClient, type TextMessage, type WsFrame } from "@wecom/aibot-node-sdk"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
} from "../adapter"
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
  }
}
