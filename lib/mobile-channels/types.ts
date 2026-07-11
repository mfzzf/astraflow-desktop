import type { ChatReasoningEffort } from "@/lib/chat-models"
import type { StudioPermissionMode } from "@/lib/studio-types"

export const mobileChannelProviders = [
  "wechat",
  "wecom",
  "feishu",
  "dingtalk",
  "lark",
  "telegram",
  "discord",
] as const

export type MobileChannelProvider = (typeof mobileChannelProviders)[number]

export const mobileChannelConnectionStatuses = [
  "disconnected",
  "connecting",
  "connected",
  "error",
] as const

export type MobileChannelConnectionStatus =
  (typeof mobileChannelConnectionStatuses)[number]

export const mobileChannelPairingStatuses = [
  "preparing",
  "waiting_scan",
  "scanned",
  "verification_required",
  "waiting_confirmation",
  "awaiting_bind",
  "connected",
  "expired",
  "cancelled",
  "error",
] as const

export type MobileChannelPairingStatus =
  (typeof mobileChannelPairingStatuses)[number]

export const mobileChannelReplyGranularities = [
  "standard",
  "full",
  "summary",
] as const

export type MobileChannelReplyGranularity =
  (typeof mobileChannelReplyGranularities)[number]

export type WechatMobileChannelCredentials = {
  provider: "wechat"
  accountId: string
  token: string
  baseUrl: string
  userId: string | null
}

export type WecomMobileChannelCredentials = {
  provider: "wecom"
  botId: string
  secret: string
}

export type FeishuMobileChannelCredentials = {
  provider: "feishu"
  appId: string
  appSecret: string
  ownerOpenId: string | null
  tenantBrand: "feishu" | "lark" | null
}

export type DingtalkMobileChannelCredentials = {
  provider: "dingtalk"
  clientId: string
  clientSecret: string
}

export type LarkMobileChannelCredentials = {
  provider: "lark"
  appId: string
  appSecret: string
  ownerOpenId: string | null
}

export type TelegramMobileChannelCredentials = {
  provider: "telegram"
  botToken: string
  botUsername: string | null
  ownerUserId: string | null
}

export type DiscordMobileChannelCredentials = {
  provider: "discord"
  applicationId: string
  botToken: string
  ownerUserId: string | null
}

export type MobileChannelCredentials =
  | WechatMobileChannelCredentials
  | WecomMobileChannelCredentials
  | FeishuMobileChannelCredentials
  | DingtalkMobileChannelCredentials
  | LarkMobileChannelCredentials
  | TelegramMobileChannelCredentials
  | DiscordMobileChannelCredentials

export type MobileChannelConnection = {
  id: string
  provider: MobileChannelProvider
  displayName: string
  status: MobileChannelConnectionStatus
  enabled: boolean
  configured: boolean
  accountId: string | null
  defaultProjectId: string | null
  replyGranularity: MobileChannelReplyGranularity
  agentRuntimeId: string | null
  chatModel: string | null
  reasoningEffort: ChatReasoningEffort | null
  permissionMode: StudioPermissionMode
  lastError: string | null
  connectedAt: string | null
  lastEventAt: string | null
  createdAt: string
  updatedAt: string
}

export type MobileChannelConnectionRecord = MobileChannelConnection & {
  credentials: MobileChannelCredentials | null
  ownerExternalUserId: string | null
  metadata: Record<string, unknown>
}

export type MobileChannelPairing = {
  id: string
  provider: MobileChannelProvider
  connectionId: string | null
  status: MobileChannelPairingStatus
  qrCodeDataUrl: string | null
  qrPayload: string | null
  bindCommand: string | null
  verificationRequired: boolean
  expiresAt: string
  message: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export type MobileChannelBinding = {
  id: string
  connectionId: string
  externalUserId: string
  conversationId: string
  sessionId: string | null
  createdAt: string
  updatedAt: string
}

export type MobileChannelReplyContext =
  | {
      provider: "wechat"
      contextToken: string | null
    }
  | {
      provider: "wecom"
      responseUrl: string | null
    }
  | {
      provider: "feishu"
      replyToMessageId: string | null
    }
  | {
      provider: "dingtalk"
      sessionWebhook: string
      sessionWebhookExpiresAt: number
      conversationType: string
      robotCode: string
    }
  | {
      provider: "lark"
      replyToMessageId: string | null
    }
  | {
      provider: "telegram"
      messageId: number
      messageThreadId: number | null
    }
  | {
      provider: "discord"
      messageId: string
      guildId: string | null
    }

export type MobileChannelInboundMessage = {
  id: string
  connectionId: string
  provider: MobileChannelProvider
  externalUserId: string
  conversationId: string
  text: string
  attachments?: MobileChannelImageAttachment[]
  senderName: string | null
  createdAt: number
  replyContext: MobileChannelReplyContext
}

export type MobileChannelImageAttachment = {
  type: "image"
  name: string
  mimeType: string
  size: number
  dataUrl: string
}

export type MobileChannelOutboundTarget = Pick<
  MobileChannelInboundMessage,
  | "connectionId"
  | "provider"
  | "externalUserId"
  | "conversationId"
  | "replyContext"
> & {
  runId?: string
  durable?: boolean
}

export const mobileChannelProviderLabels: Record<
  MobileChannelProvider,
  string
> = {
  wechat: "微信",
  wecom: "企业微信",
  feishu: "飞书",
  dingtalk: "钉钉",
  lark: "Lark",
  telegram: "Telegram",
  discord: "Discord",
}
