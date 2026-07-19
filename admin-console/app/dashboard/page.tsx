import { connection } from "next/server"

import {
  ChartAreaInteractive,
  type FeedbackTrendPoint,
} from "@/components/chart-area-interactive"
import { RecentFeedbackTable } from "@/components/recent-feedback-table"
import { SectionCards } from "@/components/section-cards"
import { loadAdminSnapshot } from "@/lib/admin-data"

function buildTrend(feedbacks: Array<{ createdAt?: string; status?: string }>) {
  const points = new Map<string, FeedbackTrendPoint>()

  for (let day = 13; day >= 0; day -= 1) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - day)
    const key = date.toISOString().slice(0, 10)
    points.set(key, {
      date: date.toLocaleDateString("zh-CN", {
        month: "numeric",
        day: "numeric",
      }),
      submitted: 0,
      resolved: 0,
    })
  }

  for (const feedback of feedbacks) {
    if (!feedback.createdAt) continue
    const point = points.get(
      new Date(feedback.createdAt).toISOString().slice(0, 10)
    )
    if (!point) continue
    point.submitted += 1
    if (feedback.status === "resolved" || feedback.status === "closed") {
      point.resolved += 1
    }
  }

  return Array.from(points.values())
}

export default async function DashboardPage() {
  await connection()
  const { channels, feedbacks } = await loadAdminSnapshot()
  const feedbackItems = feedbacks.feedbacks ?? []
  const channelItems = channels.channels ?? []

  return (
    <div className="@container/main flex flex-col gap-6 py-6">
      <SectionCards
        feedbackTotal={feedbacks.totalSize ?? feedbackItems.length}
        feedbackOpen={feedbacks.openSize ?? 0}
        activeChannels={
          channelItems.filter((item) => item.status === "active").length
        }
        resolvedFeedback={
          feedbackItems.filter((item) => item.status === "resolved").length
        }
      />
      <div className="grid gap-6 px-4 lg:px-6 @5xl/main:grid-cols-[1.05fr_0.95fr]">
        <ChartAreaInteractive data={buildTrend(feedbackItems)} />
        <RecentFeedbackTable feedbacks={feedbackItems} />
      </div>
    </div>
  )
}
