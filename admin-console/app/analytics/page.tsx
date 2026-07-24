import { connection } from "next/server"

import { AnalyticsFilters } from "@/components/analytics-filters"
import { BehaviorAnalyticsDashboard } from "@/components/behavior-analytics-dashboard"
import { getAnalyticsOverview, listChannels } from "@/lib/admin-data"

const validPeriods = new Set([7, 30, 90])

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; channel?: string }>
}) {
  await connection()
  const params = await searchParams
  const requestedDays = Number(params.days ?? 30)
  const days = validPeriods.has(requestedDays) ? requestedDays : 30
  const channel = (params.channel ?? "").trim().toLowerCase().slice(0, 64)
  const [overview, channelResponse] = await Promise.all([
    getAnalyticsOverview(days, channel),
    listChannels(),
  ])
  const channels = (channelResponse.channels ?? [])
    .filter((item) => item.slug)
    .map((item) => ({ slug: item.slug!, name: item.name || item.slug! }))

  return (
    <div className="@container/main flex flex-col gap-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          聚焦活跃用户、终端与版本、会话、关键入口和 Agent 使用，减少无运营价值的明细噪音。
        </p>
        <AnalyticsFilters days={days} channel={channel} channels={channels} />
      </div>
      <BehaviorAnalyticsDashboard data={overview} />
    </div>
  )
}
