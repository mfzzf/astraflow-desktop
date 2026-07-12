import {
  mobileChannelSlashCommands,
  normalizeMobileChannelCommandText,
} from "../slash-commands"
import { SUPPORTED_CHAT_REASONING_EFFORTS } from "../../chat-models"

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

export type DiscordInteractionOptionPayload = {
  name: string
  type: number
  value?: string | number | boolean
  options?: DiscordInteractionOptionPayload[]
}

export type DiscordInteractionPayload = {
  id: string
  application_id: string
  type: number
  token: string
  guild_id?: string
  channel_id?: string
  member?: {
    nick?: string | null
    user?: DiscordInteractionUserPayload
  }
  user?: DiscordInteractionUserPayload
  data?: {
    id?: string
    name?: string
    type?: number
    options?: DiscordInteractionOptionPayload[]
  }
}

type DiscordInteractionUserPayload = {
  id: string
  username?: string
  global_name?: string | null
  bot?: boolean
}

export type NormalizedDiscordInteraction = {
  id: string
  externalUserId: string
  conversationId: string
  text: string
  senderName: string | null
  guildId: string | null
}

export type DiscordApplicationCommandDefinition = {
  type: 1
  name: string
  description: string
  description_localizations: { "zh-CN": string; "zh-TW": string }
  integration_types: [0]
  contexts: [0, 1]
  options?: Array<Record<string, unknown>>
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
const discordCommandNames = new Set<string>(
  mobileChannelSlashCommands.map((command) => command.name)
)

function stringOption(
  options: DiscordInteractionOptionPayload[] | undefined,
  name: string
) {
  const value = options?.find((option) => option.name === name)?.value
  return typeof value === "string" && value.trim() ? value.trim() : null
}

export function normalizeDiscordInteraction(
  interaction: DiscordInteractionPayload
): NormalizedDiscordInteraction | null {
  const user = interaction.member?.user ?? interaction.user
  const commandName = interaction.data?.name?.toLowerCase()
  if (
    interaction.type !== 2 ||
    interaction.data?.type !== 1 ||
    !interaction.id ||
    !interaction.channel_id ||
    !user?.id ||
    user.bot ||
    !commandName ||
    !discordCommandNames.has(commandName)
  ) {
    return null
  }

  const options = interaction.data?.options
  const argumentsForCommand =
    commandName === "model"
      ? [stringOption(options, "selection"), stringOption(options, "reasoning")]
          .filter((value): value is string => Boolean(value))
          .join(" ")
      : commandName === "bind"
        ? (stringOption(options, "code") ?? "")
        : ""
  const text = normalizeMobileChannelCommandText(
    `/${commandName}${argumentsForCommand ? ` ${argumentsForCommand}` : ""}`
  )

  return {
    id: interaction.id,
    externalUserId: user.id,
    conversationId: interaction.channel_id,
    text,
    senderName:
      interaction.member?.nick?.trim() ||
      user.global_name?.trim() ||
      user.username?.trim() ||
      null,
    guildId: interaction.guild_id ?? null,
  }
}

export function discordSlashCommandDefinitions(): DiscordApplicationCommandDefinition[] {
  return mobileChannelSlashCommands.map((command) => {
    const base = {
      type: 1 as const,
      name: command.name,
      description: command.description,
      description_localizations: {
        "zh-CN": command.descriptionZh,
        "zh-TW": command.descriptionZh,
      },
      integration_types: [0] as [0],
      contexts: [0, 1] as [0, 1],
    }

    if (command.name === "bind") {
      return {
        ...base,
        options: [
          {
            type: 3,
            name: "code",
            description: "Binding code shown by AstraFlow Desktop",
            description_localizations: {
              "zh-CN": "AstraFlow 电脑端显示的绑定码",
              "zh-TW": "AstraFlow 電腦端顯示的綁定碼",
            },
            required: true,
            min_length: 6,
            max_length: 12,
          },
        ],
      }
    }

    if (command.name === "model") {
      return {
        ...base,
        options: [
          {
            type: 3,
            name: "selection",
            description: "Model number, ID, or name; omit to list models",
            description_localizations: {
              "zh-CN": "模型序号、ID 或名称；留空查看模型列表",
              "zh-TW": "模型序號、ID 或名稱；留空查看模型列表",
            },
            required: false,
          },
          {
            type: 3,
            name: "reasoning",
            description: "Optional reasoning effort",
            description_localizations: {
              "zh-CN": "可选的思考强度",
              "zh-TW": "可選的思考強度",
            },
            required: false,
            choices: SUPPORTED_CHAT_REASONING_EFFORTS.map((value) => ({
              name: value,
              value,
            })),
          },
        ],
      }
    }

    return base
  })
}

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
