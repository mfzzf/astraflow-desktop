"use client"

import {
  ActivityIcon,
  MousePointerClickIcon,
  ScanSearchIcon,
  UsersIcon,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"

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
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { AstraflowV1AnalyticsOverview } from "@/lib/generated/astraflow-api"

const trendConfig = {
  events: { label: "点击", color: "var(--chart-1)" },
  users: { label: "用户", color: "var(--chart-2)" },
} satisfies ChartConfig

const rankingConfig = {
  events: { label: "点击次数", color: "var(--chart-1)" },
} satisfies ChartConfig

const channelColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function count(value?: string) {
  return Number(value ?? 0)
}

function formatCount(value?: string) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(
    count(value)
  )
}

function formatDate(value?: string) {
  if (!value) return "—"
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
  })
}

function formatDateTime(value?: string) {
  if (!value) return "—"
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function BehaviorAnalyticsDashboard({
  data,
}: {
  data: AstraflowV1AnalyticsOverview
}) {
  const trend = (data.trend ?? []).map((item) => ({
    date: formatDate(item.date),
    events: count(item.eventCount),
    users: count(item.uniqueUsers),
  }))
  const topEvents = (data.topEvents ?? []).slice(0, 8).map((item) => ({
    name: item.label || item.key || "未知控件",
    events: count(item.eventCount),
  }))
  const channels = (data.channels ?? []).map((item) => ({
    name: item.label || item.key || "default",
    value: count(item.eventCount),
  }))
  const totalEvents = count(data.totalEvents)
  const uniqueUsers = count(data.uniqueUsers)
  const averageClicks =
    uniqueUsers > 0 ? (totalEvents / uniqueUsers).toFixed(1) : "0"
  const metrics = [
    {
      label: "总点击量",
      value: formatCount(data.totalEvents),
      hint: `${data.periodDays ?? 30} 天累计`,
      icon: MousePointerClickIcon,
    },
    {
      label: "独立用户",
      value: formatCount(data.uniqueUsers),
      hint: `人均 ${averageClicks} 次点击`,
      icon: UsersIcon,
    },
    {
      label: "访问会话",
      value: formatCount(data.uniqueSessions),
      hint: "按客户端会话去重",
      icon: ScanSearchIcon,
    },
    {
      label: "今日点击",
      value: formatCount(data.todayEvents),
      hint: "UTC 自然日",
      icon: ActivityIcon,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label} size="sm" className="shadow-xs">
            <CardHeader className="grid grid-cols-[1fr_auto] items-center gap-3">
              <div>
                <CardDescription>{metric.label}</CardDescription>
                <CardTitle className="mt-2 font-mono text-3xl font-medium tabular-nums">
                  {metric.value}
                </CardTitle>
              </div>
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <metric.icon className="size-5" aria-hidden />
              </span>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {metric.hint}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">点击活跃趋势</CardTitle>
            <CardDescription>
              观察交互量与独立用户是否同步变化。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={trendConfig} className="h-72 w-full">
              <AreaChart data={trend} margin={{ left: -20, right: 8 }}>
                <defs>
                  <linearGradient
                    id="analytics-events"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="var(--color-events)"
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-events)"
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
                  minTickGap={24}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip
                  content={<ChartTooltipContent indicator="line" />}
                />
                <Area
                  dataKey="events"
                  type="monotone"
                  fill="url(#analytics-events)"
                  stroke="var(--color-events)"
                  strokeWidth={2}
                />
                <Area
                  dataKey="users"
                  type="monotone"
                  fill="transparent"
                  stroke="var(--color-users)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">渠道构成</CardTitle>
            <CardDescription>不同分发渠道贡献的点击占比。</CardDescription>
          </CardHeader>
          <CardContent>
            {channels.length > 0 ? (
              <>
                <ChartContainer
                  config={{ value: { label: "点击" } }}
                  className="mx-auto h-52 w-full"
                >
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                    <Pie
                      data={channels}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={54}
                      outerRadius={82}
                      paddingAngle={2}
                    >
                      {channels.map((item, index) => (
                        <Cell
                          key={item.name}
                          fill={channelColors[index % channelColors.length]}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
                  {channels.map((item, index) => (
                    <span
                      key={item.name}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{
                          background:
                            channelColors[index % channelColors.length],
                        }}
                      />
                      {item.name} · {item.value}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                暂无渠道点击数据
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">高频交互</CardTitle>
            <CardDescription>最常被点击的控件与操作入口。</CardDescription>
          </CardHeader>
          <CardContent>
            {topEvents.length > 0 ? (
              <ChartContainer config={rankingConfig} className="h-80 w-full">
                <BarChart
                  data={topEvents}
                  layout="vertical"
                  margin={{ left: 8, right: 16 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={132}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => String(value).slice(0, 18)}
                  />
                  <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                  <Bar
                    dataKey="events"
                    fill="var(--color-events)"
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
                暂无控件点击数据
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">页面访问深度</CardTitle>
            <CardDescription>按页面汇总点击次数与独立用户。</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>页面</TableHead>
                  <TableHead>点击</TableHead>
                  <TableHead>用户</TableHead>
                  <TableHead>人均</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.topPages ?? []).map((item) => {
                  const events = count(item.eventCount)
                  const users = count(item.uniqueUsers)
                  return (
                    <TableRow key={item.key}>
                      <TableCell
                        className="max-w-64 truncate text-left font-mono text-xs"
                        title={item.key}
                      >
                        {item.label || item.key}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {events}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {users}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {users > 0 ? (events / users).toFixed(1) : "0"}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {(data.topPages ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-28 text-muted-foreground"
                    >
                      暂无页面点击数据
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle className="text-xl">最近交互流</CardTitle>
          <CardDescription>
            用于快速确认埋点是否正常到达，不包含输入内容。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>事件</TableHead>
                <TableHead>控件</TableHead>
                <TableHead>页面</TableHead>
                <TableHead>渠道</TableHead>
                <TableHead>平台</TableHead>
                <TableHead>时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.recentEvents ?? []).map((item, index) => (
                <TableRow key={`${item.eventName}-${item.occurredAt}-${index}`}>
                  <TableCell
                    className="max-w-64 truncate text-left font-mono text-xs"
                    title={item.eventName}
                  >
                    {item.eventName}
                  </TableCell>
                  <TableCell
                    className="max-w-56 truncate text-left"
                    title={item.targetLabel}
                  >
                    {item.targetLabel || "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.path}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {item.channelSlug || "default"}
                    </Badge>
                  </TableCell>
                  <TableCell>{item.platform || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(item.occurredAt)}
                  </TableCell>
                </TableRow>
              ))}
              {(data.recentEvents ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-muted-foreground">
                    暂无事件，客户端登录并产生点击后会出现在这里。
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
