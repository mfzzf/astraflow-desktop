import "server-only"

import { DWClient, TOPIC_ROBOT, type RobotMessage } from "dingtalk-stream"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
} from "../adapter"
import { delay, postJson } from "../http"
import type { DingtalkMobileChannelCredentials } from "../types"

type DingtalkTokenResponse = {
  accessToken?: string
  expireIn?: number
}

export function createDingtalkAdapter({
  connection,
  onMessage,
  onConnectionError,
}: MobileChannelAdapterFactoryInput): MobileChannelAdapter {
  if (connection.credentials?.provider !== "dingtalk") {
    throw new Error("Missing DingTalk credentials.")
  }

  const credentials = connection.credentials as DingtalkMobileChannelCredentials
  const client = new DWClient({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    keepAlive: true,
    debug: false,
    ua: "AstraFlow/1.1.4",
  })
  let cachedAccessToken: { token: string; expiresAt: number } | null = null

  async function getActiveSendToken() {
    if (
      cachedAccessToken &&
      cachedAccessToken.expiresAt > Date.now() + 60_000
    ) {
      return cachedAccessToken.token
    }

    const result = await postJson<DingtalkTokenResponse>(
      "https://api.dingtalk.com/v1.0/oauth2/accessToken",
      {
        appKey: credentials.clientId,
        appSecret: credentials.clientSecret,
      }
    )
    if (!result.accessToken) {
      throw new Error("DingTalk did not return an access token.")
    }

    cachedAccessToken = {
      token: result.accessToken,
      expiresAt: Date.now() + Math.max(60, result.expireIn ?? 7_200) * 1_000,
    }
    return result.accessToken
  }

  async function sendActiveMessage(
    target: Parameters<MobileChannelAdapter["sendText"]>[0],
    text: string
  ) {
    if (target.replyContext.provider !== "dingtalk") {
      throw new Error("Invalid DingTalk reply context.")
    }

    const isGroup = target.replyContext.conversationType === "2"
    const token = await getActiveSendToken()
    await postJson(
      isGroup
        ? "https://api.dingtalk.com/v1.0/robot/groupMessages/send"
        : "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
      {
        robotCode: target.replyContext.robotCode || credentials.clientId,
        ...(isGroup
          ? { openConversationId: target.conversationId }
          : { userIds: [target.externalUserId] }),
        msgKey: "sampleMarkdown",
        msgParam: JSON.stringify({
          title: "AstraFlow",
          text: text.slice(0, 18_000),
        }),
      },
      { headers: { "x-acs-dingtalk-access-token": token } },
      15_000
    )
  }

  client.registerCallbackListener(TOPIC_ROBOT, (frame) => {
    client.socketCallBackResponse(frame.headers.messageId, { response: null })

    try {
      const body = JSON.parse(frame.data) as RobotMessage
      if (body.msgtype !== "text" || !body.text?.content?.trim()) {
        return
      }

      void onMessage({
        id: body.msgId || frame.headers.messageId,
        connectionId: connection.id,
        provider: "dingtalk",
        externalUserId: body.senderStaffId || body.senderId,
        conversationId: body.conversationId,
        text: body.text.content.trim(),
        senderName: body.senderNick || null,
        createdAt: body.createAt || Date.now(),
        replyContext: {
          provider: "dingtalk",
          sessionWebhook: body.sessionWebhook,
          sessionWebhookExpiresAt: body.sessionWebhookExpiredTime,
          conversationType: body.conversationType,
          robotCode: body.robotCode,
        },
      }).catch(onConnectionError)
    } catch (error) {
      onConnectionError(error)
    }
  })
  client.on("error", onConnectionError)

  return {
    async connect() {
      await client.connect()

      const deadline = Date.now() + 20_000
      while (
        (!client.connected || !client.registered) &&
        Date.now() < deadline
      ) {
        await delay(250)
      }
      if (!client.connected || !client.registered) {
        throw new Error("钉钉 Stream 连接超时。")
      }
    },
    disconnect() {
      client.disconnect()
    },
    async sendText(target, text) {
      if (
        target.replyContext.provider !== "dingtalk" ||
        !target.replyContext.sessionWebhook
      ) {
        throw new Error("DingTalk session webhook is unavailable.")
      }

      const rawExpiry = target.replyContext.sessionWebhookExpiresAt
      const expiryMs =
        rawExpiry < 1_000_000_000_000 ? rawExpiry * 1_000 : rawExpiry
      if (expiryMs > Date.now()) {
        try {
          await postJson(
            target.replyContext.sessionWebhook,
            {
              msgtype: "markdown",
              markdown: {
                title: "AstraFlow",
                text: text.slice(0, 18_000),
              },
            },
            {},
            15_000
          )
          return
        } catch {
          // Long-running tasks can outlive the temporary webhook; fall back
          // to the active-send API with a cached app access token.
        }
      }

      await sendActiveMessage(target, text)
    },
  }
}
