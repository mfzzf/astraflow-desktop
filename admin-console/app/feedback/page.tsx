import { connection } from "next/server"

import { FeedbackTable } from "@/components/feedback-table"
import { listFeedbacks } from "@/lib/admin-data"

export default async function FeedbackPage() {
  await connection()
  const response = await listFeedbacks()

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold">反馈工作队列</h2>
        <p className="text-sm text-muted-foreground">
          从问题进入、分配到解决，保留完整客户端上下文。
        </p>
      </div>
      <FeedbackTable feedbacks={response.feedbacks ?? []} />
    </div>
  )
}
