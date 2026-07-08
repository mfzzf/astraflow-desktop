"use client"

import type * as React from "react"
import { RiCloseLine, RiFileTextLine } from "@remixicon/react"
import {
  GitCompareArrows,
  Globe,
  Maximize2,
  MessageSquare,
  Minimize2,
  SquareTerminal,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { getWorkspaceTabTitle } from "../workspace-tabs"
import type { StudioRightPanelMode, StudioWorkspaceTab } from "../types"
import type { StudioRightPanelLabels } from "./labels"
import { StudioRightPanelModeMenu } from "./index"
import { StudioSidePanelFileIcon } from "./files"

export function StudioWorkspaceTabStrip({
  activeMode,
  activeTabId,
  labels,
  extraModeItems = [],
  focused,
  tabs,
  onAddMode,
  onCloseTab,
  onSelectTab,
  onToggleFocused,
}: {
  activeMode: StudioRightPanelMode
  activeTabId: string
  labels: StudioRightPanelLabels
  extraModeItems?: Array<{
    key: string
    label: string
    icon: React.ComponentType<{ "aria-hidden"?: boolean; className?: string }>
    shortcut?: string
    onSelect: () => void
  }>
  focused: boolean
  tabs: StudioWorkspaceTab[]
  onAddMode: (mode: StudioRightPanelMode) => void
  onCloseTab: (tabId: string) => void
  onSelectTab: (tabId: string) => void
  onToggleFocused: () => void
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1.5 border-b px-3">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <div className="max-w-full min-w-0 [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max items-center gap-1">
            {tabs.map((tab) => {
              const isSelected = tab.id === activeTabId

              return (
                <div
                  key={tab.id}
                  className={cn(
                    "group flex h-8 max-w-48 min-w-0 items-center rounded-lg text-xs transition-colors",
                    isSelected
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                  title={getWorkspaceTabTitle(tab)}
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left"
                    aria-current={isSelected ? "page" : undefined}
                    onClick={() => onSelectTab(tab.id)}
                  >
                    <StudioWorkspaceTabIcon tab={tab} />
                    <span className="truncate">
                      {getWorkspaceTabTitle(tab)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "mr-1 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-opacity group-focus-within:opacity-75 group-hover:opacity-75 hover:bg-background/80 hover:text-foreground",
                      isSelected ? "opacity-70" : "opacity-0"
                    )}
                    aria-label="Close tab"
                    title="Close tab"
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                  >
                    <RiCloseLine aria-hidden className="size-3" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <StudioRightPanelModeMenu
          activeMode={activeMode}
          extraItems={extraModeItems}
          labels={labels}
          includeActiveMode
          onModeChange={onAddMode}
        />
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={labels.focusWorkspace}
            title={labels.focusWorkspace}
            className={cn(
              "size-7 shrink-0 rounded-lg bg-transparent text-muted-foreground shadow-none hover:bg-muted/70 hover:text-foreground",
              focused && "bg-muted text-foreground"
            )}
            onClick={onToggleFocused}
          >
            {focused ? (
              <Minimize2 aria-hidden className="size-3.5" />
            ) : (
              <Maximize2 aria-hidden className="size-3.5" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent align="end" side="bottom">
          {labels.focusWorkspace}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export function StudioWorkspaceTabIcon({ tab }: { tab: StudioWorkspaceTab }) {
  if (tab.kind === "browser") {
    return <Globe aria-hidden className="size-3.5 shrink-0" />
  }

  if (tab.kind === "terminal") {
    return <SquareTerminal aria-hidden className="size-3.5 shrink-0" />
  }

  if (tab.kind === "side-chat") {
    return <MessageSquare aria-hidden className="size-3.5 shrink-0" />
  }

  if (tab.kind === "review") {
    return <GitCompareArrows aria-hidden className="size-3.5 shrink-0" />
  }

  return tab.entry ? (
    <StudioSidePanelFileIcon entry={tab.entry} />
  ) : (
    <RiFileTextLine aria-hidden className="size-3.5 shrink-0" />
  )
}
