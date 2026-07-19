"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CalendarDaysIcon, RadioTowerIcon } from "lucide-react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type ChannelOption = {
  slug: string
  name: string
}

export function AnalyticsFilters({
  days,
  channel,
  channels,
}: {
  days: number
  channel: string
  channels: ChannelOption[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function update(key: "days" | "channel", value: string) {
    const next = new URLSearchParams(searchParams.toString())
    if (key === "channel" && value === "all") next.delete("channel")
    else next.set(key, value)
    router.replace(`${pathname}?${next.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={String(days)}
        onValueChange={(value) => update("days", value)}
      >
        <SelectTrigger size="sm" className="gap-2 bg-card shadow-xs">
          <CalendarDaysIcon aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="7">最近 7 天</SelectItem>
          <SelectItem value="30">最近 30 天</SelectItem>
          <SelectItem value="90">最近 90 天</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={channel || "all"}
        onValueChange={(value) => update("channel", value)}
      >
        <SelectTrigger size="sm" className="max-w-56 gap-2 bg-card shadow-xs">
          <RadioTowerIcon aria-hidden />
          <SelectValue placeholder="全部渠道" />
        </SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="all">全部渠道</SelectItem>
          {channels.map((item) => (
            <SelectItem key={item.slug} value={item.slug}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
