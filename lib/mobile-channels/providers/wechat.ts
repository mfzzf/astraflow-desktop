import "server-only"

import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto"
import { z } from "zod"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
} from "../adapter"
import { delay, errorMessage, postJson } from "../http"
import {
  createMobileChannelImageAttachment,
  decryptWechatImage,
  fetchMobileChannelBuffer,
  MAX_MOBILE_CHANNEL_IMAGE_BYTES,
} from "../media"
import { updateMobileChannelConnectionMetadata } from "../store"
import type {
  MobileChannelInboundMessage,
  WechatMobileChannelCredentials,
} from "../types"

const wechatMediaSchema = z.object({
  encrypt_query_param: z.string().optional(),
  aes_key: z.string().optional(),
  full_url: z.string().optional(),
})

const wechatItemSchema = z.object({
  type: z.number().optional(),
  msg_id: z.string().optional(),
  text_item: z.object({ text: z.string().optional() }).optional(),
  image_item: z
    .object({
      media: wechatMediaSchema.optional(),
      aeskey: z.string().optional(),
    })
    .optional(),
})

const wechatMessageSchema = z.object({
  seq: z.number().optional(),
  message_id: z.union([z.number(), z.string()]).optional(),
  from_user_id: z.string().optional(),
  create_time_ms: z.number().optional(),
  session_id: z.string().optional(),
  group_id: z.string().optional(),
  item_list: z.array(wechatItemSchema).optional(),
  context_token: z.string().optional(),
})

const wechatSendResultSchema = z.object({
  ret: z.number().optional(),
  errmsg: z.string().optional(),
})

const wechatUploadUrlSchema = z.object({
  ret: z.number().optional(),
  errmsg: z.string().optional(),
  upload_param: z.string().optional(),
  upload_full_url: z.string().optional(),
})

const WECHAT_CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c"
const WECHAT_CDN_UPLOAD_MAX_ATTEMPTS = 3

const getUpdatesSchema = z.object({
  ret: z.number().optional(),
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
  msgs: z.array(wechatMessageSchema).optional(),
  get_updates_buf: z.string().optional(),
  longpolling_timeout_ms: z.number().optional(),
})

function headers(token: string) {
  const uin = randomBytes(4).readUInt32BE(0)

  return {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "X-WECHAT-UIN": Buffer.from(String(uin), "utf8").toString("base64"),
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": "65796",
  }
}

function baseInfo() {
  return {
    channel_version: "1.1.4",
    bot_agent: "AstraFlow/1.1.4",
  }
}

export function createWechatAdapter({
  connection,
  onMessage,
  onConnected,
  onConnectionError,
}: MobileChannelAdapterFactoryInput): MobileChannelAdapter {
  if (connection.credentials?.provider !== "wechat") {
    throw new Error("Missing WeChat credentials.")
  }

  const credentials = connection.credentials as WechatMobileChannelCredentials
  const controller = new AbortController()
  let updatesBuffer =
    typeof connection.metadata.updatesBuffer === "string"
      ? connection.metadata.updatesBuffer
      : ""

  async function downloadWechatImage(item: z.infer<typeof wechatItemSchema>) {
    const image = item.image_item
    const media = image?.media
    const url = media?.full_url?.trim()
      ? new URL(media.full_url, WECHAT_CDN_BASE_URL).toString()
      : media?.encrypt_query_param
        ? `${WECHAT_CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(media.encrypt_query_param)}`
        : null
    if (!url) {
      throw new Error("WeChat image download URL is missing.")
    }

    const downloaded = await fetchMobileChannelBuffer(
      url,
      {},
      30_000,
      MAX_MOBILE_CHANNEL_IMAGE_BYTES + 16
    )
    const aesKey = image?.aeskey || media?.aes_key
    const buffer = aesKey
      ? decryptWechatImage(downloaded.buffer, aesKey)
      : downloaded.buffer

    return createMobileChannelImageAttachment({ buffer })
  }

  async function normalizeInboundMessage(
    message: z.infer<typeof wechatMessageSchema>
  ): Promise<MobileChannelInboundMessage | null> {
    const externalUserId = message.from_user_id?.trim()
    const text = message.item_list
      ?.find((item) => item.type === 1 && item.text_item?.text)
      ?.text_item?.text?.trim()
    const imageItems =
      message.item_list
        ?.filter(
          (item) =>
            item.type === 2 &&
            Boolean(
              item.image_item?.media?.full_url ||
              item.image_item?.media?.encrypt_query_param
            )
        )
        .slice(0, 4) ?? []

    if (!externalUserId || (!text && imageItems.length === 0)) {
      return null
    }

    const attachments = await Promise.all(imageItems.map(downloadWechatImage))

    return {
      id: String(
        message.message_id ??
          message.item_list?.find((item) => item.msg_id)?.msg_id ??
          randomUUID()
      ),
      connectionId: connection.id,
      provider: "wechat",
      externalUserId,
      conversationId: message.group_id || message.session_id || externalUserId,
      text: text || "",
      attachments,
      senderName: null,
      createdAt: message.create_time_ms ?? Date.now(),
      replyContext: {
        provider: "wechat",
        contextToken: message.context_token ?? null,
      },
    }
  }

  async function sendWechatMessage(
    target: Parameters<MobileChannelAdapter["sendText"]>[0],
    item: Record<string, unknown>
  ) {
    const contextToken =
      target.replyContext.provider === "wechat"
        ? (target.replyContext.contextToken ?? undefined)
        : undefined
    const send = (replyContextToken?: string) =>
      postJson<unknown>(
        new URL("ilink/bot/sendmessage", credentials.baseUrl).toString(),
        {
          msg: {
            from_user_id: "",
            to_user_id: target.externalUserId,
            client_id: `astraflow-${randomUUID()}`,
            message_type: 2,
            message_state: 2,
            item_list: [item],
            context_token: replyContextToken,
          },
          base_info: baseInfo(),
        },
        { headers: headers(credentials.token) }
      )

    let result = wechatSendResultSchema.parse(await send(contextToken))
    if ((result.ret ?? 0) !== 0 && contextToken) {
      result = wechatSendResultSchema.parse(await send())
    }

    if ((result.ret ?? 0) !== 0) {
      throw new Error(result.errmsg || `WeChat send failed (${result.ret}).`)
    }
  }

  async function uploadWechatMedia(
    target: Parameters<MobileChannelAdapter["sendText"]>[0],
    media: { buffer: Buffer },
    mediaType: 1 | 2
  ) {
    const rawSize = media.buffer.length
    const cipherSize = (Math.floor(rawSize / 16) + 1) * 16
    const fileKey = randomBytes(16).toString("hex")
    const aesKey = randomBytes(16)
    const aesKeyHex = aesKey.toString("hex")
    const upload = wechatUploadUrlSchema.parse(
      await postJson<unknown>(
        new URL("ilink/bot/getuploadurl", credentials.baseUrl).toString(),
        {
          filekey: fileKey,
          media_type: mediaType,
          to_user_id: target.externalUserId,
          rawsize: rawSize,
          rawfilemd5: createHash("md5").update(media.buffer).digest("hex"),
          filesize: cipherSize,
          no_need_thumb: true,
          aeskey: aesKeyHex,
          base_info: baseInfo(),
        },
        { headers: headers(credentials.token) }
      )
    )
    if ((upload.ret ?? 0) !== 0) {
      throw new Error(
        upload.errmsg || `WeChat media upload failed (${upload.ret}).`
      )
    }
    const uploadUrl = upload.upload_full_url?.trim()
      ? new URL(upload.upload_full_url, WECHAT_CDN_BASE_URL).toString()
      : upload.upload_param
        ? `${WECHAT_CDN_BASE_URL}/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param)}&filekey=${encodeURIComponent(fileKey)}`
        : null
    if (!uploadUrl) {
      throw new Error("WeChat did not return a media upload URL.")
    }

    const cipher = createCipheriv("aes-128-ecb", aesKey, null)
    cipher.setAutoPadding(true)
    const encrypted = Buffer.concat([
      cipher.update(media.buffer),
      cipher.final(),
    ])
    let downloadParam: string | null = null
    let lastUploadError: Error | null = null

    for (
      let attempt = 1;
      attempt <= WECHAT_CDN_UPLOAD_MAX_ATTEMPTS;
      attempt += 1
    ) {
      let response: Response
      try {
        response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(encrypted),
        })
      } catch (error) {
        lastUploadError = new Error(
          `WeChat CDN upload request failed: ${errorMessage(error)}`
        )
        if (attempt < WECHAT_CDN_UPLOAD_MAX_ATTEMPTS) {
          continue
        }
        break
      }

      const errorDetail =
        response.headers.get("x-error-message")?.trim() || null
      if (response.status >= 400 && response.status < 500) {
        throw new Error(
          `WeChat CDN upload failed (${response.status})${
            errorDetail ? `: ${errorDetail.slice(0, 500)}` : "."
          }`
        )
      }
      if (response.status !== 200) {
        lastUploadError = new Error(
          `WeChat CDN upload failed (${response.status})${
            errorDetail ? `: ${errorDetail.slice(0, 500)}` : "."
          }`
        )
        if (attempt < WECHAT_CDN_UPLOAD_MAX_ATTEMPTS) {
          continue
        }
        break
      }

      downloadParam = response.headers.get("x-encrypted-param")
      if (downloadParam) {
        break
      }
      lastUploadError = new Error(
        "WeChat CDN response is missing the media reference."
      )
    }

    if (!downloadParam) {
      throw (
        lastUploadError ?? new Error("WeChat CDN media upload failed.")
      )
    }

    return {
      downloadParam,
      aesKey: Buffer.from(aesKeyHex).toString("base64"),
      encryptedSize: encrypted.length,
    }
  }

  async function poll() {
    let consecutiveFailures = 0

    while (!controller.signal.aborted) {
      try {
        const result = getUpdatesSchema.parse(
          await postJson<unknown>(
            new URL("ilink/bot/getupdates", credentials.baseUrl).toString(),
            { get_updates_buf: updatesBuffer, base_info: baseInfo() },
            { headers: headers(credentials.token), signal: controller.signal },
            38_000
          )
        )

        if (result.errcode === -14 || result.ret === -14) {
          onConnectionError(
            new Error("微信机器人授权已失效，请在移动版页面重新扫码。")
          )
          return
        }

        if ((result.ret ?? 0) !== 0 || (result.errcode ?? 0) !== 0) {
          throw new Error(
            result.errmsg ||
              `WeChat getupdates failed (${result.errcode ?? result.ret}).`
          )
        }

        consecutiveFailures = 0
        onConnected()
        if (result.get_updates_buf !== undefined) {
          updatesBuffer = result.get_updates_buf
          updateMobileChannelConnectionMetadata(connection.id, {
            ...connection.metadata,
            updatesBuffer,
          })
        }

        const inboundMessages = await Promise.all(
          (result.msgs ?? []).map(normalizeInboundMessage)
        )
        for (const message of inboundMessages) {
          if (message) {
            await onMessage(message)
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        if (error instanceof Error && error.name === "AbortError") {
          consecutiveFailures = 0
          continue
        }

        consecutiveFailures += 1
        if (consecutiveFailures === 1 || consecutiveFailures % 5 === 0) {
          onConnectionError(error)
        }
        await delay(
          Math.min(30_000, 1_000 * 2 ** consecutiveFailures),
          controller.signal
        )
      }
    }
  }

  return {
    async connect() {
      void poll().catch((error) => {
        if (!controller.signal.aborted) {
          onConnectionError(error)
        }
      })
    },
    disconnect() {
      controller.abort()
    },
    async sendText(target, text) {
      await sendWechatMessage(target, { type: 1, text_item: { text } })
    },
    async sendImage(target, image) {
      const uploaded = await uploadWechatMedia(target, image, 1)

      await sendWechatMessage(target, {
        type: 2,
        image_item: {
          media: {
            encrypt_query_param: uploaded.downloadParam,
            aes_key: uploaded.aesKey,
            encrypt_type: 1,
          },
          mid_size: uploaded.encryptedSize,
        },
      })
    },
    async sendVideo(target, video) {
      const uploaded = await uploadWechatMedia(target, video, 2)

      await sendWechatMessage(target, {
        type: 5,
        video_item: {
          media: {
            encrypt_query_param: uploaded.downloadParam,
            aes_key: uploaded.aesKey,
            encrypt_type: 1,
          },
          video_size: uploaded.encryptedSize,
        },
      })
    },
  }
}

export function describeWechatAdapterError(error: unknown) {
  return `微信连接异常：${errorMessage(error)}`
}
