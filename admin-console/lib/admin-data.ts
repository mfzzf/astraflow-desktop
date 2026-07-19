import "server-only"

import {
  analyticsServiceGetOverview,
  channelServiceListChannels,
  feedbackServiceListFeedbacks,
} from "@/lib/generated/astraflow-api"
import { getAdminHeaders, unwrapAdminResult } from "@/lib/astraflow-api"
import { requireAdminUIAccess } from "@/lib/admin-ui-auth"

export async function listChannels() {
  await requireAdminUIAccess()
  const result = await channelServiceListChannels({
    headers: getAdminHeaders(),
    query: { pageSize: 100 },
    signal: AbortSignal.timeout(15_000),
  })

  return unwrapAdminResult(result, "渠道列表加载失败。")
}

export async function getAnalyticsOverview(days = 30, channelSlug = "") {
  await requireAdminUIAccess()
  const result = await analyticsServiceGetOverview({
    headers: getAdminHeaders(),
    query: { days, channelSlug: channelSlug || undefined },
    signal: AbortSignal.timeout(15_000),
  })

  return unwrapAdminResult(result, "用户行为数据加载失败。")
}

export async function listFeedbacks() {
  await requireAdminUIAccess()
  const result = await feedbackServiceListFeedbacks({
    headers: getAdminHeaders(),
    query: { pageSize: 100 },
    signal: AbortSignal.timeout(15_000),
  })

  return unwrapAdminResult(result, "反馈列表加载失败。")
}

export async function loadAdminSnapshot() {
  const [channels, feedbacks] = await Promise.all([
    listChannels(),
    listFeedbacks(),
  ])

  return { channels, feedbacks }
}
