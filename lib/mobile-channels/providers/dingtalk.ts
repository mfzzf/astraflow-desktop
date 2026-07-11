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
  onConnected,
  onReconnecting,
  onConnectionError,
}: MobileChannelAdapterFactoryInput): MobileChannelAdapter {
  if (connection.credentials?.provider !== "dingtalk") {
    throw new Error("Missing DingTalk credentials.")
  }

  const credentials = connection.credentials as DingtalkMobileChannelCredentials
  const client = new DWClient({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    // Supported by the SDK runtime although omitted from its public options
    // type. AstraFlow owns the cancellable reconnect loop below.
    autoReconnect: false,
    keepAlive: true,
    debug: false,
    ua: "AstraFlow/1.1.4",
  } as ConstructorParameters<typeof DWClient>[0] & {
    autoReconnect: boolean
  })
  let cachedAccessToken: { token: string; expiresAt: number } | null = null
  let cachedOapiAccessToken: { token: string; expiresAt: number } | null = null
  let connectionMonitor: ReturnType<typeof setInterval> | null = null
  let connectionReady: boolean | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let reconnecting: Promise<boolean> | null = null
  let stopped = true

  async function waitUntilConnectionReady() {
    const deadline = Date.now() + 20_000
    while (
      !stopped &&
      (!client.connected || !client.registered) &&
      Date.now() < deadline
    ) {
      await delay(250)
    }

    return !stopped && client.connected && client.registered
  }

  function attemptConnection() {
    if (stopped) {
      return Promise.resolve(false)
    }
    if (reconnecting) {
      return reconnecting
    }

    const operation = (async () => {
      // The SDK does not clear its keepalive interval when a socket closes.
      // Disconnect before reusing the client so each reconnect owns one timer.
      client.disconnect()
      if (stopped) {
        return false
      }

      await client.connect()
      const ready = await waitUntilConnectionReady()
      if (stopped) {
        client.disconnect()
        return false
      }
      return ready
    })().finally(() => {
      if (reconnecting === operation) {
        reconnecting = null
      }
    })
    reconnecting = operation
    return operation
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer || (client.connected && client.registered)) {
      return
    }

    onReconnecting()
    const delayMs = Math.min(
      30_000,
      1_000 * 2 ** Math.min(reconnectAttempts, 5)
    )
    reconnectAttempts += 1
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void attemptConnection()
        .then((ready) => {
          if (ready) {
            reconnectAttempts = 0
            onConnected()
            return
          }
          scheduleReconnect()
        })
        .catch((error) => {
          onConnectionError(error)
          scheduleReconnect()
        })
    }, delayMs)
    reconnectTimer.unref?.()
  }

  function startConnectionMonitor() {
    if (connectionMonitor) {
      return
    }

    connectionMonitor = setInterval(() => {
      const ready = client.connected && client.registered
      if (ready === connectionReady) {
        return
      }

      connectionReady = ready
      if (ready) {
        reconnectAttempts = 0
        onConnected()
      } else {
        scheduleReconnect()
      }
    }, 2_000)
    connectionMonitor.unref?.()
  }

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
    const result = await postJson<{
      processQueryKey?: string
      code?: string
      message?: string
    }>(
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
    if (!result.processQueryKey) {
      throw new Error(
        result.message || result.code || "DingTalk text send failed."
      )
    }
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
      10 * 60_000
    )
    if ((result.errcode ?? 0) !== 0 || !result.media_id) {
      throw new Error(result.errmsg || "DingTalk image upload failed.")
    }
    return result.media_id
  }

  async function uploadFile(
    file:
      | Parameters<MobileChannelAdapter["sendVideo"]>[1]
      | Parameters<MobileChannelAdapter["sendFile"]>[1]
  ) {
    const token = await getOapiToken()
    const form = new FormData()
    form.append(
      "media",
      new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
      file.fileName
    )
    const result = await fetchJson<{
      errcode?: number
      errmsg?: string
      media_id?: string
    }>(
      `https://oapi.dingtalk.com/media/upload?access_token=${encodeURIComponent(token)}&type=file`,
      { method: "POST", body: form },
      10 * 60_000
    )
    if ((result.errcode ?? 0) !== 0 || !result.media_id) {
      throw new Error(result.errmsg || "DingTalk video upload failed.")
    }
    return result.media_id
  }

  async function sendActiveFile(
    target: Parameters<MobileChannelAdapter["sendText"]>[0],
    file: { fileName: string },
    mediaId: string
  ) {
    if (target.replyContext.provider !== "dingtalk") {
      throw new Error("Invalid DingTalk reply context.")
    }

    const isGroup = target.replyContext.conversationType === "2"
    const token = await getActiveSendToken()
    const result = await postJson<{
      processQueryKey?: string
      code?: string
      message?: string
    }>(
      isGroup
        ? "https://api.dingtalk.com/v1.0/robot/groupMessages/send"
        : "https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend",
      {
        robotCode: target.replyContext.robotCode || credentials.clientId,
        ...(isGroup
          ? { openConversationId: target.conversationId }
          : { userIds: [target.externalUserId] }),
        msgKey: "sampleFile",
        msgParam: JSON.stringify({
          mediaId,
          fileName: file.fileName,
          fileType: file.fileName.split(".").at(-1) || "file",
        }),
      },
      { headers: { "x-acs-dingtalk-access-token": token } },
      15_000
    )
    if (!result.processQueryKey) {
      throw new Error(
        result.message || result.code || "DingTalk file send failed."
      )
    }
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
    const result = await postJson<{
      processQueryKey?: string
      code?: string
      message?: string
    }>(
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
    if (!result.processQueryKey) {
      throw new Error(
        result.message || result.code || "DingTalk image send failed."
      )
    }
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

    try {
      await sendActiveFile(target, video, mediaId)
    } catch (error) {
      throw new Error(
        (error instanceof Error ? error.message : null) ||
          videoResult.message ||
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
      stopped = false
      startConnectionMonitor()
      if (!(await attemptConnection())) {
        throw new Error("钉钉 Stream 连接超时。")
      }
    },
    disconnect() {
      stopped = true
      if (connectionMonitor) {
        clearInterval(connectionMonitor)
        connectionMonitor = null
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      connectionReady = null
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
      const mediaId = await uploadImage(image)
      try {
        await sendActiveImage(target, mediaId)
      } catch {
        // Some DingTalk tenants do not accept uploaded media IDs as an
        // inline image URL. Preserve delivery by falling back to a file.
        await sendActiveFile(target, image, mediaId)
      }
    },
    async sendVideo(target, video) {
      await sendActiveVideo(target, video, await uploadFile(video))
    },
    async sendFile(target, file) {
      await sendActiveFile(target, file, await uploadFile(file))
    },
  }
}
