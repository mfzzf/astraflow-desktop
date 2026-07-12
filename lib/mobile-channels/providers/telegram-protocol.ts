import { normalizeMobileChannelCommandText } from "../slash-commands"

export type TelegramFileReference = {
  type: "image" | "video"
  fileId: string
  fileName: string | null
  mimeType: string | null
  size: number | null
}

type TelegramPhotoSize = {
  file_id: string
  file_size?: number
  width?: number
  height?: number
}

type TelegramDocument = {
  file_id: string
  file_name?: string
  mime_type?: string
  file_size?: number
}

export type TelegramMessagePayload = {
  message_id: number
  message_thread_id?: number
  date?: number
  media_group_id?: string
  from?: {
    id: number
    is_bot?: boolean
    first_name?: string
    last_name?: string
    username?: string
  }
  chat: {
    id: number
    type?: string
  }
  text?: string
  caption?: string
  photo?: TelegramPhotoSize[]
  video?: TelegramDocument
  animation?: TelegramDocument
  document?: TelegramDocument
}

export type TelegramUpdatePayload = {
  update_id: number
  message?: TelegramMessagePayload
  edited_message?: TelegramMessagePayload
}

export type NormalizedTelegramUpdate = {
  updateId: number
  messageId: number
  externalUserId: string
  conversationId: string
  text: string
  senderName: string | null
  createdAt: number
  messageThreadId: number | null
  mediaGroupId: string | null
  files: TelegramFileReference[]
}

function senderName(message: TelegramMessagePayload) {
  const name = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(" ")
    .trim()
  return name || message.from?.username?.trim() || null
}

function photoScore(photo: TelegramPhotoSize) {
  return photo.file_size ?? (photo.width ?? 0) * (photo.height ?? 0)
}

function documentReference(
  document: TelegramDocument | undefined,
  fallbackType?: "image" | "video"
): TelegramFileReference | null {
  if (!document?.file_id) {
    return null
  }

  const mimeType = document.mime_type?.trim().toLowerCase() || null
  const type =
    fallbackType ??
    (mimeType?.startsWith("image/")
      ? "image"
      : mimeType?.startsWith("video/")
        ? "video"
        : null)
  if (!type) {
    return null
  }

  return {
    type,
    fileId: document.file_id,
    fileName: document.file_name?.trim() || null,
    mimeType,
    size: document.file_size ?? null,
  }
}

export function normalizeTelegramUpdate(
  update: TelegramUpdatePayload
): NormalizedTelegramUpdate | null {
  const message = update.message ?? update.edited_message
  if (!message?.from || message.from.is_bot) {
    return null
  }

  const files: TelegramFileReference[] = []
  const largestPhoto = message.photo
    ?.filter((photo) => Boolean(photo.file_id))
    .toSorted((left, right) => photoScore(right) - photoScore(left))[0]
  if (largestPhoto) {
    files.push({
      type: "image",
      fileId: largestPhoto.file_id,
      fileName: null,
      mimeType: "image/jpeg",
      size: largestPhoto.file_size ?? null,
    })
  }

  const video =
    documentReference(message.video, "video") ??
    documentReference(message.animation, "video")
  if (video) {
    files.push(video)
  }

  const document = documentReference(message.document)
  if (document) {
    files.push(document)
  }

  const text = (message.text ?? message.caption ?? "").trim()
  if (!text && files.length === 0) {
    return null
  }

  return {
    updateId: update.update_id,
    messageId: message.message_id,
    externalUserId: String(message.from.id),
    conversationId: String(message.chat.id),
    text,
    senderName: senderName(message),
    createdAt: message.date ? message.date * 1_000 : Date.now(),
    messageThreadId: message.message_thread_id ?? null,
    mediaGroupId: message.media_group_id ?? null,
    files: files.slice(0, 4),
  }
}

export function telegramBotDeepLink(username: string, bindCode: string) {
  const normalizedUsername = username.trim().replace(/^@/, "")
  if (!/^[A-Za-z0-9_]{5,32}$/.test(normalizedUsername)) {
    throw new Error("Invalid Telegram bot username.")
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(bindCode)) {
    throw new Error("Invalid Telegram deep-link payload.")
  }

  return `https://t.me/${normalizedUsername}?start=${bindCode}`
}

export function normalizeTelegramCommand(text: string) {
  return normalizeMobileChannelCommandText(text, { startAsBind: true })
}

export function splitTelegramText(text: string) {
  const characters = Array.from(text)
  const chunks: string[] = []
  for (let index = 0; index < characters.length; index += 4_096) {
    chunks.push(characters.slice(index, index + 4_096).join(""))
  }
  return chunks.length > 0 ? chunks : [""]
}
