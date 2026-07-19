"use client"

import * as React from "react"

import { CentralIcon } from "@/components/central-icon"
import { useI18n } from "@/components/i18n-provider"
import { IconButton } from "@/components/ui/icon-button"
import { appShellStore, toggleSidebar } from "@/lib/app-shell/store"
import { cn } from "@/lib/utils"

type SidebarToggleButtonProps = {
  className?: string
  tooltipAlign?: React.ComponentProps<typeof IconButton>["tooltipAlign"]
  tooltipSide?: React.ComponentProps<typeof IconButton>["tooltipSide"]
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
    <IconButton
      type="button"
      variant="chrome"
      size="icon-sm"
      label={t.toggleSidebar}
      title={t.toggleSidebar}
      tooltipAlign={tooltipAlign}
      tooltipSide={tooltipSide}
      tooltip={
        <span className="flex items-center gap-2">
          <span>{t.toggleSidebar}</span>
          <span
            data-slot="kbd"
            className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
          >
            {isMac ? "Cmd+B" : "Ctrl+B"}
          </span>
        </span>
      }
      className={cn(
        "h-8 w-8 shrink-0 rounded-(--radius-md) text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground",
        className
      )}
      onClick={() => toggleSidebar(appShellStore, "sidebar_trigger")}
    >
      <CentralIcon name="sidebar-simple-left-wide" />
    </IconButton>
  )
}

export { SidebarToggleButton }
