"use client"

import {
  CalendarDaysIcon,
  MonitorSmartphoneIcon,
  MessagesSquareIcon,
  UserRoundCheckIcon,
  UsersIcon,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
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
import type { AstraflowV1AnalyticsOverview } from "@/lib/generated/astraflow-api"

const activeUsersConfig = {
  users: { label: "日活用户", color: "var(--chart-1)" },
} satisfies ChartConfig

const actionConfig = {
  events: { label: "点击次数", color: "var(--chart-2)" },
} satisfies ChartConfig

const agentConfig = {
  events: { label: "使用次数", color: "var(--chart-3)" },
} satisfies ChartConfig

const terminalConfig = {
  events: { label: "终端数", color: "var(--chart-4)" },
} satisfies ChartConfig

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

function rankedItems(
  items: AstraflowV1AnalyticsOverview["topEvents"] | undefined,
  fallback: string
) {
  return (items ?? []).slice(0, 8).map((item) => ({
    name: item.label || item.key || fallback,
    events: count(item.eventCount),
    users: count(item.uniqueUsers),
  }))
}

function RankingChart({
  data,
  config,
  empty,
}: {
  data: ReturnType<typeof rankedItems>
  config: ChartConfig
  empty: string
}) {
  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center text-sm text-muted-foreground">
        {empty}
      </div>
    )
  }

  return (
    <ChartContainer config={config} className="h-72 w-full">
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
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
  )
}

export function BehaviorAnalyticsDashboard({
  data,
}: {
  data: AstraflowV1AnalyticsOverview
}) {
  const activeUsers = (data.trend ?? []).map((item) => ({
    date: formatDate(item.date),
    users: count(item.uniqueUsers),
  }))
  const topActions = rankedItems(data.topEvents, "未知操作")
  const agentUsage = rankedItems(data.agentUsage, "未知 Agent")
  const clientVersions = rankedItems(data.clientVersions, "未知版本")
  const platforms = rankedItems(data.platforms, "未知平台")
  const metrics = [
    {
      label: "日活用户",
      value: formatCount(data.dailyActiveUsers),
      hint: "UTC 今日打开或使用客户端",
      icon: UserRoundCheckIcon,
    },
    {
      label: "月活用户",
      value: formatCount(data.monthlyActiveUsers),
      hint: "最近 30 个 UTC 自然日",
      icon: CalendarDaysIcon,
    },
    {
      label: "总用户数",
      value: formatCount(data.totalUsers),
      hint: "有账号按账号、未登录按终端去重",
      icon: UsersIcon,
    },
    {
      label: "总终端数",
      value: formatCount(data.totalTerminals),
      hint: "历史安装终端匿名标识去重",
      icon: MonitorSmartphoneIcon,
    },
    {
      label: "总会话数",
      value: formatCount(data.totalStudioSessions),
      hint: "实际发起过对话的 Studio 会话",
      icon: MessagesSquareIcon,
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

      <Card className="shadow-xs">
        <CardHeader>
          <CardTitle className="text-xl">日活趋势</CardTitle>
          <CardDescription>
            按天观察真实打开或使用 AstraFlow Desktop 的用户数。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={activeUsersConfig} className="h-72 w-full">
            <AreaChart data={activeUsers} margin={{ left: -20, right: 8 }}>
              <defs>
                <linearGradient
                  id="analytics-active-users"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor="var(--color-users)"
                    stopOpacity={0.35}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-users)"
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
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <ChartTooltip
                content={<ChartTooltipContent indicator="line" />}
              />
              <Area
                dataKey="users"
                type="monotone"
                fill="url(#analytics-active-users)"
                stroke="var(--color-users)"
                strokeWidth={2}
              />
            </AreaChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">关键按钮点击</CardTitle>
            <CardDescription>
              只统计侧边栏和对话输入区中明确标记的运营入口。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RankingChart
              data={topActions}
              config={actionConfig}
              empty="暂无关键按钮点击数据"
            />
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">Agent 使用</CardTitle>
            <CardDescription>
              按实际发送的对话轮次统计各 Agent 的使用次数。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RankingChart
              data={agentUsage}
              config={agentConfig}
              empty="暂无 Agent 使用数据"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">客户端版本</CardTitle>
            <CardDescription>
              按所选周期内每个活跃终端最后上报的版本统计。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RankingChart
              data={clientVersions}
              config={terminalConfig}
              empty="暂无客户端版本数据"
            />
          </CardContent>
        </Card>

        <Card className="shadow-xs">
          <CardHeader>
            <CardTitle className="text-xl">终端平台</CardTitle>
            <CardDescription>
              按所选周期内每个活跃终端最后上报的平台统计。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RankingChart
              data={platforms}
              config={terminalConfig}
              empty="暂无终端平台数据"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
