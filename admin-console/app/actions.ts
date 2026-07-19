"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import {
  channelServiceCreateChannel,
  channelServiceDeleteChannel,
  channelServiceUpdateChannel,
  feedbackServiceGetFeedback,
  feedbackServiceUpdateFeedback,
} from "@/lib/generated/astraflow-api"
import { getAdminHeaders, unwrapAdminResult } from "@/lib/astraflow-api"
import { requireAdminUIAccess } from "@/lib/admin-ui-auth"

const feedbackUpdateSchema = z.object({
  feedbackId: z.string().trim().min(1).max(120),
  status: z.enum(["new", "reviewing", "resolved", "closed"]),
  assignee: z.string().trim().max(120),
  adminNote: z.string().trim().max(8000),
})

const channelSchema = z.object({
  id: z.string().trim().max(120).optional(),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/),
  name: z.string().trim().min(1).max(120),
  status: z.enum(["draft", "active", "disabled"]),
  oauthClientId: z.string().trim().max(256),
  oauthClientSecret: z.string().trim().max(2048),
  clearOauthClientSecret: z.boolean(),
  enabledFeatures: z.array(
    z.enum([
      "models",
      "skills",
      "automations",
      "mobile",
      "codebox",
      "files",
      "chat",
      "image",
      "video",
      "audio",
    ])
  ),
  restrictModels: z.boolean(),
  allowedModelIds: z.array(z.string().trim().min(1).max(256)).max(500),
})

export type ChannelActionInput = z.infer<typeof channelSchema>
export type FeedbackUpdateInput = z.infer<typeof feedbackUpdateSchema>

export async function getFeedbackAction(feedbackId: string) {
  await requireAdminUIAccess()
  const id = z.string().trim().min(1).max(120).parse(feedbackId)
  const result = await feedbackServiceGetFeedback({
    path: { feedbackId: id },
    headers: getAdminHeaders(),
    signal: AbortSignal.timeout(15_000),
  })

  return unwrapAdminResult(result, "反馈详情加载失败。")
}

export async function updateFeedbackAction(input: FeedbackUpdateInput) {
  await requireAdminUIAccess()
  const parsed = feedbackUpdateSchema.parse(input)
  const result = await feedbackServiceUpdateFeedback({
    path: { feedbackId: parsed.feedbackId },
    body: parsed,
    headers: getAdminHeaders(),
    signal: AbortSignal.timeout(15_000),
  })
  const feedback = unwrapAdminResult(result, "反馈更新失败。")
  revalidatePath("/")
  revalidatePath("/feedback")
  return feedback
}

export async function saveChannelAction(input: ChannelActionInput) {
  await requireAdminUIAccess()
  const parsed = channelSchema.parse(input)
  const headers = getAdminHeaders()

  const result = parsed.id
    ? await channelServiceUpdateChannel({
        path: { channelId: parsed.id },
        body: {
          channelId: parsed.id,
          slug: parsed.slug,
          name: parsed.name,
          status: parsed.status,
          oauthClientId: parsed.oauthClientId,
          oauthClientSecret: parsed.oauthClientSecret,
          clearOauthClientSecret: parsed.clearOauthClientSecret,
          enabledFeatures: parsed.enabledFeatures,
          restrictModels: parsed.restrictModels,
          allowedModelIds: parsed.allowedModelIds,
        },
        headers,
        signal: AbortSignal.timeout(15_000),
      })
    : await channelServiceCreateChannel({
        body: {
          slug: parsed.slug,
          name: parsed.name,
          status: parsed.status,
          oauthClientId: parsed.oauthClientId,
          oauthClientSecret: parsed.oauthClientSecret,
          enabledFeatures: parsed.enabledFeatures,
          restrictModels: parsed.restrictModels,
          allowedModelIds: parsed.allowedModelIds,
        },
        headers,
        signal: AbortSignal.timeout(15_000),
      })

  const channel = unwrapAdminResult(result, "渠道保存失败。")
  revalidatePath("/")
  revalidatePath("/channels")
  return channel
}

export async function deleteChannelAction(channelId: string) {
  await requireAdminUIAccess()
  const id = z.string().trim().min(1).max(120).parse(channelId)
  const result = await channelServiceDeleteChannel({
    path: { channelId: id },
    headers: getAdminHeaders(),
    signal: AbortSignal.timeout(15_000),
  })

  if (result.error !== undefined) {
    unwrapAdminResult(result, "渠道删除失败。")
  }
  revalidatePath("/")
  revalidatePath("/channels")
  return { ok: true }
}
