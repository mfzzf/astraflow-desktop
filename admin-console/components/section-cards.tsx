import {
  CheckCircle2Icon,
  MessageSquareTextIcon,
  RadioTowerIcon,
  ScanSearchIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type SummaryCardsProps = {
  feedbackTotal: number
  feedbackOpen: number
  activeChannels: number
  resolvedFeedback: number
}

export function SectionCards({
  feedbackTotal,
  feedbackOpen,
  activeChannels,
  resolvedFeedback,
}: SummaryCardsProps) {
  const cards = [
    {
      label: "全部反馈",
      value: feedbackTotal,
      detail: "当前可检索的反馈记录",
      badge: "累计",
      icon: MessageSquareTextIcon,
    },
    {
      label: "待处理",
      value: feedbackOpen,
      detail: "New 与 Reviewing 状态",
      badge: feedbackOpen > 0 ? "需要关注" : "已清空",
      icon: ScanSearchIcon,
    },
    {
      label: "活跃渠道",
      value: activeChannels,
      detail: "正在向客户端下发策略",
      badge: "Active",
      icon: RadioTowerIcon,
    },
    {
      label: "已解决",
      value: resolvedFeedback,
      detail: "已完成闭环的反馈",
      badge: "Resolved",
      icon: CheckCircle2Icon,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 px-4 lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="@container/card shadow-xs">
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <card.icon aria-hidden />
              {card.label}
            </CardDescription>
            <CardTitle className="font-heading text-4xl font-semibold tabular-nums">
              {card.value.toLocaleString("zh-CN")}
            </CardTitle>
            <CardAction>
              <Badge variant="outline">{card.badge}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="sr-only">{card.detail}</CardContent>
          <CardFooter className="text-sm text-muted-foreground">
            {card.detail}
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
