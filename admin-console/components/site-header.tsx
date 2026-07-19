"use client"

import { usePathname } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"

const titles: Record<string, { title: string; description: string }> = {
  "/dashboard": {
    title: "运营总览",
    description: "反馈与分发渠道的实时工作面",
  },
  "/feedback": { title: "反馈处理", description: "追踪、归类并闭环客户端反馈" },
  "/channels": {
    title: "渠道配置",
    description: "管理 OAuth、功能入口与模型策略",
  },
}

export function SiteHeader() {
  const pathname = usePathname()
  const current =
    Object.entries(titles).find(([path]) => pathname.startsWith(path))?.[1] ??
    titles["/dashboard"]

  return (
    <header className="flex h-(--header-height) shrink-0 items-center border-b bg-background/90 backdrop-blur">
      <div className="flex w-full items-center gap-3 px-4 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="h-4" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{current.title}</h1>
          <p className="hidden truncate text-xs text-muted-foreground md:block">
            {current.description}
          </p>
        </div>
        <Badge variant="outline" className="font-mono font-normal">
          ADMIN · LIVE
        </Badge>
      </div>
    </header>
  )
}
