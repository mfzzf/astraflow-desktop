import "server-only"

import { DWClient, TOPIC_ROBOT } from "dingtalk-stream"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
} from "../adapter"
import { delay, fetchJson, postJson } from "../http"
import {
  createMobileChannelImageAttachment,
  fetchMobileChannelImage,
} from "../media"
import type { DingtalkMobileChannelCredentials } from "../types"

type DingtalkTokenResponse = {
  accessToken?: string
  expireIn?: number
}

type DingtalkRobotMessage = {
  conversationId: string
  msgId?: string
  senderNick?: string
  senderStaffId?: string
  senderId: string
  sessionWebhookExpiredTime: number
  createAt?: number
  conversationType: string
  sessionWebhook: string
  robotCode: string
  msgtype: string
  text?: { content?: string }
  content?: unknown
  picture?: unknown
  pictureDownloadCode?: string
  richText?: unknown
}

type DingtalkImageReference =
  { kind: "url"; value: string } | { kind: "downloadCode"; value: string }

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return record(JSON.parse(value))
    } catch {
      return null
    }
  }

  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function dingtalkMessageContent(body: DingtalkRobotMessage) {
  return record(body.content) ?? record(body.picture) ?? {}
}

function dingtalkImageReferences(body: DingtalkRobotMessage) {
  const references: DingtalkImageReference[] = []
  const seen = new Set<string>()
  const add = (kind: DingtalkImageReference["kind"], value: unknown) => {
    const normalized = stringValue(value)
    if (!normalized || seen.has(`${kind}:${normalized}`)) {
      return
    }
    seen.add(`${kind}:${normalized}`)
    references.push({ kind, value: normalized })
  }
  const addRecord = (candidate: unknown) => {
    const item = record(candidate)
    if (!item) {
      return
    }
    add("url", item.pictureUrl)
    add("downloadCode", item.downloadCode)
    add("downloadCode", item.pictureDownloadCode)
  }

  if (body.msgtype === "picture") {
    addRecord(dingtalkMessageContent(body))
    add("downloadCode", body.pictureDownloadCode)
  }

  if (body.msgtype === "richText") {
    const content = dingtalkMessageContent(body)
    const legacy = record(body.richText)
    const items = Array.isArray(content.richText)
      ? content.richText
      : Array.isArray(legacy?.richTextList)
        ? legacy.richTextList
        : []
    for (const item of items) {
      addRecord(item)
    }
  }

  return references.slice(0, 4)
}

function dingtalkMessageText(body: DingtalkRobotMessage) {
  if (body.msgtype === "text") {
    return body.text?.content?.trim() ?? ""
  }
  if (body.msgtype !== "richText") {
    return ""
  }

  const content = dingtalkMessageContent(body)
  const legacy = record(body.richText)
  const items = Array.isArray(content.richText)
    ? content.richText
    : Array.isArray(legacy?.richTextList)
      ? legacy.richTextList
      : []

  return items
    .map((item) => stringValue(record(item)?.text))
    .filter((item): item is string => Boolean(item))
    .join("")
    .trim()
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
  let cachedOapiAccessToken: { token: string; expiresAt: number } | null = null

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

  async function getOapiToken() {
    if (
      cachedOapiAccessToken &&
      cachedOapiAccessToken.expiresAt > Date.now() + 60_000
    ) {
      return cachedOapiAccessToken.token
    }

    const result = await fetchJson<{
      errcode?: number
      errmsg?: string
      access_token?: string
      expires_in?: number
    }>(
      `https://oapi.dingtalk.com/gettoken?appkey=${encodeURIComponent(credentials.clientId)}&appsecret=${encodeURIComponent(credentials.clientSecret)}`
    )
    if ((result.errcode ?? 0) !== 0 || !result.access_token) {
      throw new Error(result.errmsg || "DingTalk did not return an OAPI token.")
    }

    cachedOapiAccessToken = {
      token: result.access_token,
      expiresAt: Date.now() + Math.max(60, result.expires_in ?? 7_200) * 1_000,
    }
    return result.access_token
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

  async function downloadImage(reference: DingtalkImageReference) {
    let url = reference.value
    if (reference.kind === "downloadCode") {
      const token = await getActiveSendToken()
      const result = await postJson<{ downloadUrl?: string }>(
        "https://api.dingtalk.com/v1.0/robot/messageFiles/download",
        {
          downloadCode: reference.value,
          robotCode: credentials.clientId,
        },
        { headers: { "x-acs-dingtalk-access-token": token } },
        30_000
      )
      if (!result.downloadUrl) {
        throw new Error("DingTalk did not return an image download URL.")
      }
      url = result.downloadUrl
    }

    const downloaded = await fetchMobileChannelImage(url)
    return createMobileChannelImageAttachment(downloaded)
  }

  async function uploadImage(
    image: Parameters<MobileChannelAdapter["sendImage"]>[1]
  ) {
    const token = await getOapiToken()
    const form = new FormData()
    form.append(
      "media",
      new Blob([new Uint8Array(image.buffer)], { type: image.mimeType }),
      image.fileName
    )
    const result = await fetchJson<{
      errcode?: number
      errmsg?: string
      media_id?: string
    }>(
      `https://oapi.dingtalk.com/media/upload?access_token=${encodeURIComponent(token)}&type=image`,
      { method: "POST", body: form },
      60_000
    )
    if ((result.errcode ?? 0) !== 0 || !result.media_id) {
      throw new Error(result.errmsg || "DingTalk image upload failed.")
    }
    return result.media_id
  }

  async function uploadVideo(
    video: Parameters<MobileChannelAdapter["sendVideo"]>[1]
  ) {
    const token = await getOapiToken()
    const form = new FormData()
    form.append(
      "media",
      new Blob([new Uint8Array(video.buffer)], { type: video.mimeType }),
      video.fileName
    )
    const result = await fetchJson<{
      errcode?: number
      errmsg?: string
      media_id?: string
    }>(
      `https://oapi.dingtalk.com/media/upload?access_token=${encodeURIComponent(token)}&type=file`,
      { method: "POST", body: form },
      60_000
    )
    if ((result.errcode ?? 0) !== 0 || !result.media_id) {
      throw new Error(result.errmsg || "DingTalk video upload failed.")
    }
    return result.media_id
  }

  async function sendActiveImage(
    target: Parameters<MobileChannelAdapter["sendImage"]>[0],
    mediaId: string
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
        msgKey: "sampleImageMsg",
        msgParam: JSON.stringify({ photoURL: mediaId }),
      },
      { headers: { "x-acs-dingtalk-access-token": token } },
      15_000
    )
  }

  async function sendActiveVideo(
    target: Parameters<MobileChannelAdapter["sendVideo"]>[0],
    video: Parameters<MobileChannelAdapter["sendVideo"]>[1],
    mediaId: string
  ) {
    if (target.replyContext.provider !== "dingtalk") {
      throw new Error("Invalid DingTalk reply context.")
    }

    const isGroup = target.replyContext.conversationType === "2"
    const token = await getActiveSendToken()
    const endpoint = isGroup
      ? "https://api.dingtalk.com/v1.0/robot/groupMessages/send"
      : "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend"
    const targetFields = isGroup
      ? { openConversationId: target.conversationId }
      : { userIds: [target.externalUserId] }
    const headers = { "x-acs-dingtalk-access-token": token }
    let videoResult: {
      processQueryKey?: string
      code?: string
      message?: string
    } = {}
    try {
      videoResult = await postJson(
        endpoint,
        {
          robotCode: target.replyContext.robotCode || credentials.clientId,
          ...targetFields,
          msgKey: "sampleVideo",
          msgParam: JSON.stringify({
            duration: String(
              Math.max(1, Math.round((video.durationSeconds ?? 60) * 1_000))
            ),
            videoMediaId: mediaId,
            videoType: "mp4",
            picMediaId: "",
          }),
        },
        { headers },
        15_000
      )
    } catch (error) {
      videoResult.message =
        error instanceof Error ? error.message : "DingTalk video send failed."
    }
    if (videoResult.processQueryKey) {
      return
    }

    const fileResult = await postJson<{
      processQueryKey?: string
      code?: string
      message?: string
    }>(
      endpoint,
      {
        robotCode: target.replyContext.robotCode || credentials.clientId,
        ...targetFields,
        msgKey: "sampleFile",
        msgParam: JSON.stringify({
          mediaId,
          fileName: video.fileName,
          fileType: video.fileName.split(".").at(-1) || "mp4",
        }),
      },
      { headers },
      15_000
    )
    if (!fileResult.processQueryKey) {
      throw new Error(
        fileResult.message ||
          videoResult.message ||
          fileResult.code ||
          videoResult.code ||
          "DingTalk video send failed."
      )
    }
  }

  client.registerCallbackListener(TOPIC_ROBOT, (frame) => {
    client.socketCallBackResponse(frame.headers.messageId, { response: null })

    try {
      const body = JSON.parse(frame.data) as DingtalkRobotMessage
      const text = dingtalkMessageText(body)
      const imageReferences = dingtalkImageReferences(body)
      if (!text && imageReferences.length === 0) {
        return
      }

      void Promise.all(imageReferences.map(downloadImage))
        .then((attachments) =>
          onMessage({
            id: body.msgId || frame.headers.messageId,
            connectionId: connection.id,
            provider: "dingtalk",
            externalUserId: body.senderStaffId || body.senderId,
            conversationId: body.conversationId,
            text:
              text ||
              (attachments.length > 1
                ? "请查看并处理这些图片。"
                : "请查看并处理这张图片。"),
            attachments,
            senderName: body.senderNick || null,
            createdAt: body.createAt || Date.now(),
            replyContext: {
              provider: "dingtalk",
              sessionWebhook: body.sessionWebhook,
              sessionWebhookExpiresAt: body.sessionWebhookExpiredTime,
              conversationType: body.conversationType,
              robotCode: body.robotCode,
            },
          })
        )
        .catch(onConnectionError)
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
    async sendImage(target, image) {
      await sendActiveImage(target, await uploadImage(image))
    },
    async sendVideo(target, video) {
      await sendActiveVideo(target, video, await uploadVideo(video))
    },
  }
}
