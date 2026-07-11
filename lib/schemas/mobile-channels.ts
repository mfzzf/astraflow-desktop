import { z } from "zod"

import { PUBLIC_AGENT_RUNTIME_IDS } from "@/lib/agent-model-settings-shared"
import {
  mobileChannelConnectionStatuses,
  mobileChannelPairingStatuses,
  mobileChannelProviders,
  mobileChannelReplyGranularities,
} from "@/lib/mobile-channels/types"

export const mobileChannelProviderSchema = z.enum(mobileChannelProviders)

export const mobileChannelConnectionStatusSchema = z.enum(
  mobileChannelConnectionStatuses
)

export const mobileChannelPairingStatusSchema = z.enum(
  mobileChannelPairingStatuses
)

export const mobileChannelCredentialsSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("wechat"),
    accountId: z.string().trim().min(1).max(256),
    token: z.string().trim().min(1).max(8_192),
    baseUrl: z.string().url().max(2_048),
    userId: z.string().trim().min(1).max(512).nullable(),
  }),
  z.object({
    provider: z.literal("wecom"),
    botId: z.string().trim().min(1).max(512),
    secret: z.string().trim().min(1).max(8_192),
  }),
  z.object({
    provider: z.literal("feishu"),
    appId: z.string().trim().min(1).max(512),
    appSecret: z.string().trim().min(1).max(8_192),
    ownerOpenId: z.string().trim().min(1).max(512).nullable(),
    tenantBrand: z.enum(["feishu", "lark"]).nullable(),
  }),
  z.object({
    provider: z.literal("dingtalk"),
    clientId: z.string().trim().min(1).max(512),
    clientSecret: z.string().trim().min(1).max(8_192),
  }),
])

export const startMobileChannelPairingSchema = z.object({
  defaultProjectId: z.string().trim().min(1).max(160).nullable().optional(),
})

export const updateMobileChannelConnectionSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultProjectId: z.string().trim().min(1).max(160).nullable().optional(),
    replyGranularity: z.enum(mobileChannelReplyGranularities).optional(),
    agentRuntimeId: z
      .enum(PUBLIC_AGENT_RUNTIME_IDS)
      .nullable()
      .optional(),
    chatModel: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    "At least one connection setting is required."
  )

export const mobileChannelVerificationSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{4,10}$/),
})
