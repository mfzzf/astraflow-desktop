import "server-only"

import type {
  MobileChannelAdapter,
  MobileChannelAdapterFactoryInput,
  MobileChannelOutboundFile,
  MobileChannelOutboundImage,
  MobileChannelOutboundVideo,
} from "../adapter"
import { delay } from "../http"
import { createMobileChannelImageAttachment, fetchMobileChannelImage } from "../media"
import { updateMobileChannelConnectionMetadata } from "../store"
import type { TelegramMobileChannelCredentials } from "../types"
import {
  normalizeTelegramCommand,
  normalizeTelegramUpdate,
  splitTelegramText,
  type TelegramFileReference,
  type TelegramUpdatePayload,
} from "./telegram-protocol"

type TelegramEnvelope<T> = {
  ok: boolean
  result?: T
  description?: string
  error_code?: number
  parameters?: { retry_after?: number }
}

type TelegramBotUser = {
  id: number
  is_bot: boolean
  username?: string
}

type TelegramFile = {
  file_id: string
  file_size?: number
  file_path?: string
}

type TelegramWebhookInfo = {
  url?: string
}

class TelegramApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "TelegramApiError"
    this.status = status
  }
}

const TELEGRAM_API_BASE_URL = "https://api.telegram.org"
function telegramApiUrl(token: string, method: string) {
  return `${TELEGRAM_API_BASE_URL}/bot${token}/${method}`
}

function telegramFileUrl(token: string, filePath: string) {
  const normalized = filePath
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map(encodeURIComponent)
    .join("/")
  if (!normalized) {
    throw new Error("Telegram returned an invalid file path.")
  }
  return `${TELEGRAM_API_BASE_URL}/file/bot${token}/${normalized}`
}

function safeFileName(value: string | null, fallback: string) {
  return value?.trim().replace(/[\\/\0]/g, "-").slice(0, 180) || fallback
}

function telegramReplyContext(target: {
  replyContext: Parameters<MobileChannelAdapter["sendText"]>[0]["replyContext"]
}) {
  return target.replyContext.provider === "telegram"
    ? target.replyContext
    : null
}

export function createTelegramAdapter({
  connection,
  onMessage,
  onConnected,
  onReconnecting,
  onConnectionError,
}: MobileChannelAdapterFactoryInput): MobileChannelAdapter {
  const credentials = connection.credentials as TelegramMobileChannelCredentials
  if (
    credentials?.provider !== "telegram" ||
    !/^\d+:[A-Za-z0-9_-]{20,}$/.test(credentials.botToken)
  ) {
    throw new Error("Missing or invalid Telegram bot credentials.")
  }

  const controller = new AbortController()
  let polling: Promise<void> | null = null
  let updateOffset =
    typeof connection.metadata.telegramUpdateOffset === "number"
      ? connection.metadata.telegramUpdateOffset
      : 0

  async function callTelegram<T>(
    method: string,
    body: Record<string, unknown> | FormData,
    options: { signal?: AbortSignal; timeoutMs?: number; retry?: boolean } = {}
  ): Promise<T> {
    const timeoutController = new AbortController()
    const timeout = setTimeout(
      () => timeoutController.abort(),
      options.timeoutMs ?? 35_000
    )
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal

    try {
      const form = body instanceof FormData
      const response = await fetch(telegramApiUrl(credentials.botToken, method), {
        method: "POST",
        headers: form ? undefined : { "Content-Type": "application/json" },
        body: form ? body : JSON.stringify(body),
        signal,
      })
      const envelope = (await response.json().catch(() => null)) as
        | TelegramEnvelope<T>
        | null
      if (response.status === 429 && options.retry !== false) {
        const retryAfter = Math.min(
          30,
          Math.max(1, envelope?.parameters?.retry_after ?? 1)
        )
        await delay(retryAfter * 1_000, options.signal)
        return callTelegram<T>(method, body, { ...options, retry: false })
      }
      if (!response.ok || !envelope?.ok || envelope.result === undefined) {
        throw new TelegramApiError(
          envelope?.error_code ?? response.status,
          envelope?.description || `Telegram API failed (${response.status}).`
        )
      }
      return envelope.result
    } finally {
      clearTimeout(timeout)
    }
  }

  async function downloadImage(
    reference: TelegramFileReference & { type: "image" }
  ) {
    const file = await callTelegram<TelegramFile>(
      "getFile",
      { file_id: reference.fileId },
      { signal: controller.signal }
    )
    if (!file.file_path) {
      throw new Error("Telegram did not return a file path.")
    }
    const url = telegramFileUrl(credentials.botToken, file.file_path)
    return createMobileChannelImageAttachment({
      ...(await fetchMobileChannelImage(url, {
        signal: controller.signal,
      })),
      fileName: safeFileName(
        reference.fileName,
        `telegram-${file.file_id}.jpg`
      ),
    })
  }

  async function dispatchUpdate(update: TelegramUpdatePayload) {
    const normalized = normalizeTelegramUpdate(update)
    if (!normalized) {
      return
    }

    const imageFiles = normalized.files.filter(
      (file): file is TelegramFileReference & { type: "image" } =>
        file.type === "image"
    )
    if (!normalized.text && imageFiles.length === 0) {
      return
    }
    const attachments = await Promise.all(imageFiles.map(downloadImage))
    const fallbackText =
      attachments.length > 1
        ? "请查看并处理这些图片。"
        : "请查看并处理这张图片。"

    await onMessage({
      id: `telegram:${normalized.updateId}:${normalized.messageId}`,
      connectionId: connection.id,
      provider: "telegram",
      externalUserId: normalized.externalUserId,
      conversationId: normalized.conversationId,
      text: normalizeTelegramCommand(normalized.text) || fallbackText,
      attachments,
      senderName: normalized.senderName,
      createdAt: normalized.createdAt,
      replyContext: {
        provider: "telegram",
        messageId: normalized.messageId,
        messageThreadId: normalized.messageThreadId,
      },
    })
  }

  function saveOffset() {
    updateMobileChannelConnectionMetadata(connection.id, {
      ...connection.metadata,
      telegramUpdateOffset: updateOffset,
    })
  }

  async function poll() {
    let failures = 0
    while (!controller.signal.aborted) {
      try {
        const updates = await callTelegram<TelegramUpdatePayload[]>(
          "getUpdates",
          {
            offset: updateOffset,
            limit: 100,
            timeout: 30,
            allowed_updates: ["message"],
          },
          { signal: controller.signal, timeoutMs: 38_000 }
        )
        failures = 0
        onConnected()
        for (const update of updates) {
          try {
            await dispatchUpdate(update)
          } catch (error) {
            onConnectionError(error)
          } finally {
            updateOffset = Math.max(updateOffset, update.update_id + 1)
          }
        }
        if (updates.length > 0) {
          saveOffset()
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }
        if (error instanceof TelegramApiError && error.status === 401) {
          onConnectionError(
            new Error("Telegram bot token is invalid or has been revoked.")
          )
          return
        }
        failures += 1
        onReconnecting()
        await delay(Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5)))
      }
    }
  }

  function replyFields(target: Parameters<MobileChannelAdapter["sendText"]>[0]) {
    const context = telegramReplyContext(target)
    return {
      ...(context?.messageThreadId
        ? { message_thread_id: context.messageThreadId }
        : {}),
      ...(context
        ? {
            reply_parameters: {
              message_id: context.messageId,
              allow_sending_without_reply: true,
            },
          }
        : {}),
    }
  }

  async function sendMedia(
    method: "sendPhoto" | "sendVideo" | "sendDocument",
    field: "photo" | "video" | "document",
    target: Parameters<MobileChannelAdapter["sendText"]>[0],
    media:
      | MobileChannelOutboundImage
      | MobileChannelOutboundVideo
      | MobileChannelOutboundFile
  ) {
    const form = new FormData()
    form.append("chat_id", target.conversationId)
    form.append(
      field,
      new Blob([new Uint8Array(media.buffer)], { type: media.mimeType }),
      media.fileName
    )
    const reply = replyFields(target)
    if (reply.message_thread_id) {
      form.append("message_thread_id", String(reply.message_thread_id))
    }
    if (reply.reply_parameters) {
      form.append("reply_parameters", JSON.stringify(reply.reply_parameters))
    }
    if (method === "sendVideo") {
      form.append("supports_streaming", "true")
    }
    await callTelegram(method, form, { timeoutMs: 10 * 60_000 })
  }

  return {
    async connect() {
      const bot = await callTelegram<TelegramBotUser>("getMe", {})
      if (!bot.is_bot || !bot.username) {
        throw new Error("Telegram credentials do not belong to a named bot.")
      }

      const webhook = await callTelegram<TelegramWebhookInfo>(
        "getWebhookInfo",
        {}
      )
      if (webhook.url) {
        await callTelegram("deleteWebhook", { drop_pending_updates: false })
      }

      polling = poll().catch(onConnectionError)
      onConnected()
    },
    async disconnect() {
      controller.abort()
      await polling?.catch(() => undefined)
      polling = null
    },
    async sendText(target, text) {
      const chunks = splitTelegramText(text)
      for (const [index, chunk] of chunks.entries()) {
        await callTelegram("sendMessage", {
          chat_id: target.conversationId,
          text: chunk,
          ...(index === 0 ? replyFields(target) : {}),
        })
      }
    },
    async sendImage(target, image) {
      await sendMedia("sendPhoto", "photo", target, image)
    },
    async sendVideo(target, video) {
      if (video.mimeType === "video/mp4") {
        await sendMedia("sendVideo", "video", target, video)
        return
      }
      await sendMedia("sendDocument", "document", target, video)
    },
    async sendFile(target, file) {
      await sendMedia("sendDocument", "document", target, file)
    },
  }
}
