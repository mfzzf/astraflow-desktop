import "server-only"

import { randomBytes, randomUUID } from "node:crypto"
import { z } from "zod"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
} from "../adapter"
import { delay, errorMessage, postJson } from "../http"
import { updateMobileChannelConnectionMetadata } from "../store"
import type { WechatMobileChannelCredentials } from "../types"

const wechatTextItemSchema = z.object({
  type: z.number().optional(),
  msg_id: z.string().optional(),
  text_item: z.object({ text: z.string().optional() }).optional(),
})

const wechatMessageSchema = z.object({
  seq: z.number().optional(),
  message_id: z.union([z.number(), z.string()]).optional(),
  from_user_id: z.string().optional(),
  create_time_ms: z.number().optional(),
  session_id: z.string().optional(),
  group_id: z.string().optional(),
  item_list: z.array(wechatTextItemSchema).optional(),
  context_token: z.string().optional(),
})

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

        for (const message of result.msgs ?? []) {
          const externalUserId = message.from_user_id?.trim()
          const text = message.item_list
            ?.find((item) => item.type === 1 && item.text_item?.text)
            ?.text_item?.text?.trim()

          if (!externalUserId || !text) {
            continue
          }

          await onMessage({
            id: String(
              message.message_id ??
                message.item_list?.find((item) => item.msg_id)?.msg_id ??
                randomUUID()
            ),
            connectionId: connection.id,
            provider: "wechat",
            externalUserId,
            conversationId:
              message.group_id || message.session_id || externalUserId,
            text,
            senderName: null,
            createdAt: message.create_time_ms ?? Date.now(),
            replyContext: {
              provider: "wechat",
              contextToken: message.context_token ?? null,
            },
          })
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
      const result = z
        .object({ ret: z.number().optional(), errmsg: z.string().optional() })
        .parse(
          await postJson<unknown>(
            new URL("ilink/bot/sendmessage", credentials.baseUrl).toString(),
            {
              msg: {
                from_user_id: "",
                to_user_id: target.externalUserId,
                client_id: `astraflow-${randomUUID()}`,
                message_type: 2,
                message_state: 2,
                item_list: [{ type: 1, text_item: { text } }],
                context_token:
                  target.replyContext.provider === "wechat"
                    ? (target.replyContext.contextToken ?? undefined)
                    : undefined,
              },
              base_info: baseInfo(),
            },
            { headers: headers(credentials.token) }
          )
        )

      if ((result.ret ?? 0) !== 0) {
        throw new Error(result.errmsg || `WeChat send failed (${result.ret}).`)
      }
    },
  }
}

export function describeWechatAdapterError(error: unknown) {
  return `微信连接异常：${errorMessage(error)}`
}
