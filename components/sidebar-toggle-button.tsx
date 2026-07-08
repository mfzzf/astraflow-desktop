"use client"

import * as React from "react"
import type { ComponentProps } from "react"
import { PanelLeft } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { appShellStore, toggleSidebar } from "@/lib/app-shell/store"
import { cn } from "@/lib/utils"

type SidebarToggleButtonProps = {
  className?: string
  tooltipAlign?: ComponentProps<typeof TooltipContent>["align"]
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"]
}

function isMacPlatform() {
  if (typeof document === "undefined") {
    return true
  }

  const platform = document.documentElement.dataset.astraflowPlatform
  if (platform) {
    return platform === "darwin"
  }

  return /Mac|iP(hone|ad|od)/i.test(navigator.platform || navigator.userAgent)
}

function SidebarToggleButton({
  className,
  tooltipAlign = "start",
  tooltipSide = "bottom",
}: SidebarToggleButtonProps) {
  const { t } = useI18n()
  const isMac = React.useMemo(() => isMacPlatform(), [])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t.toggleSidebar}
          title={t.toggleSidebar}
          className={cn(
            "h-8 w-8 shrink-0 rounded-(--radius-md) text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground",
            className
          )}
          onClick={() => toggleSidebar(appShellStore, "sidebar_trigger")}
        >
          <PanelLeft aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent
        align={tooltipAlign}
        side={tooltipSide}
        sideOffset={8}
        className="gap-2 shadow-lg"
      >
        <span>{t.toggleSidebar}</span>
        <span
          data-slot="kbd"
          className="bg-background/15 px-1.5 py-0.5 text-[11px] font-semibold text-background/80"
        >
          {isMac ? "Cmd+B" : "Ctrl+B"}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

export { SidebarToggleButton }
