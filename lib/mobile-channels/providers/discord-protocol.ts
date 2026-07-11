export type DiscordAttachmentPayload = {
  id: string
  filename: string
  size?: number
  url: string
  proxy_url?: string
  content_type?: string
}

export type DiscordMessagePayload = {
  id: string
  channel_id: string
  guild_id?: string
  content?: string
  timestamp?: string
  webhook_id?: string
  author?: {
    id: string
    username?: string
    global_name?: string
    bot?: boolean
  }
  attachments?: DiscordAttachmentPayload[]
  message_reference?: { message_id?: string }
}

export type NormalizedDiscordMessage = {
  id: string
  externalUserId: string
  conversationId: string
  text: string
  senderName: string | null
  createdAt: number
  guildId: string | null
  imageAttachments: DiscordAttachmentPayload[]
  videoAttachments: DiscordAttachmentPayload[]
}

const imageExtensions = /\.(?:gif|jpe?g|png|webp)$/i
const videoExtensions = /\.(?:m4v|mov|mp4|webm)$/i

export function normalizeDiscordMessage(
  message: DiscordMessagePayload
): NormalizedDiscordMessage | null {
  if (!message.author || message.author.bot || message.webhook_id) {
    return null
  }

  const attachments = message.attachments ?? []
  const imageAttachments = attachments
    .filter(
      (attachment) =>
        attachment.content_type?.startsWith("image/") ||
        imageExtensions.test(attachment.filename)
    )
    .slice(0, 4)
  const videoAttachments = attachments
    .filter(
      (attachment) =>
        attachment.content_type?.startsWith("video/") ||
        videoExtensions.test(attachment.filename)
    )
    .slice(0, 4)
  const text = message.content?.trim() ?? ""
  if (!text && imageAttachments.length === 0 && videoAttachments.length === 0) {
    return null
  }

  const timestamp = message.timestamp ? Date.parse(message.timestamp) : NaN
  return {
    id: message.id,
    externalUserId: message.author.id,
    conversationId: message.channel_id,
    text,
    senderName:
      message.author.global_name?.trim() ||
      message.author.username?.trim() ||
      null,
    createdAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
    guildId: message.guild_id ?? null,
    imageAttachments,
    videoAttachments,
  }
}

export function discordBotInstallUrl({
  applicationId,
  permissions = "117760",
}: {
  applicationId: string
  permissions?: string
}) {
  if (!/^\d{16,22}$/.test(applicationId.trim())) {
    throw new Error("Invalid Discord application ID.")
  }
  if (!/^\d+$/.test(permissions)) {
    throw new Error("Invalid Discord permissions bitfield.")
  }

  const url = new URL("https://discord.com/oauth2/authorize")
  url.searchParams.set("client_id", applicationId.trim())
  url.searchParams.set("permissions", permissions)
  url.searchParams.set("scope", "bot applications.commands")
  return url.toString()
}

export function splitDiscordText(text: string) {
  const characters = Array.from(text)
  const chunks: string[] = []
  for (let index = 0; index < characters.length; index += 2_000) {
    chunks.push(characters.slice(index, index + 2_000).join(""))
  }
  return chunks.length > 0 ? chunks : [""]
}
