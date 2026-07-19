"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"

export type FeedbackTrendPoint = {
  date: string
  submitted: number
  resolved: number
}

const chartConfig = {
  submitted: { label: "提交", color: "var(--chart-1)" },
  resolved: { label: "解决", color: "var(--chart-2)" },
} satisfies ChartConfig

export function ChartAreaInteractive({ data }: { data: FeedbackTrendPoint[] }) {
  return (
    <Card className="shadow-xs">
      <CardHeader>
        <CardTitle className="font-heading text-xl">14 天反馈流量</CardTitle>
        <CardDescription>
          对比每天提交量与已解决量，观察处理队列是否积压。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-72 w-full">
          <AreaChart accessibilityLayer data={data} margin={{ left: -20 }}>
            <defs>
              <linearGradient id="fillSubmitted" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-submitted)"
                  stopOpacity={0.35}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-submitted)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
            <Area
              dataKey="submitted"
              type="monotone"
              fill="url(#fillSubmitted)"
              stroke="var(--color-submitted)"
              strokeWidth={2}
            />
            <Area
              dataKey="resolved"
              type="monotone"
              fill="transparent"
              stroke="var(--color-resolved)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
