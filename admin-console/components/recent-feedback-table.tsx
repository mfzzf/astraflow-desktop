import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AstraflowV1FeedbackSummary } from "@/lib/generated/astraflow-api"

const statusLabels: Record<string, string> = {
  new: "新反馈",
  reviewing: "处理中",
  resolved: "已解决",
  closed: "已关闭",
}

export function RecentFeedbackTable({
  feedbacks,
}: {
  feedbacks: AstraflowV1FeedbackSummary[]
}) {
  return (
    <Card className="shadow-xs">
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle className="font-heading text-xl">最新反馈</CardTitle>
          <CardDescription>最近进入处理队列的客户端问题。</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/feedback">查看全部</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-center">描述</TableHead>
                <TableHead className="text-center">渠道</TableHead>
                <TableHead className="text-center">状态</TableHead>
                <TableHead className="text-center">提交时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {feedbacks.slice(0, 6).map((feedback) => (
                <TableRow key={feedback.id}>
                  <TableCell className="max-w-96 text-center">
                    <span className="line-clamp-1">{feedback.description}</span>
                  </TableCell>
                  <TableCell className="text-center font-mono text-xs">
                    {feedback.channelSlug || "default"}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="outline">
                      {statusLabels[feedback.status ?? ""] ?? feedback.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center text-muted-foreground">
                    {feedback.createdAt
                      ? new Date(feedback.createdAt).toLocaleString("zh-CN")
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
