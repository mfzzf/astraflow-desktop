"use client"

import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import {
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelRightClose,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { ResizeHandle } from "./desktop-app-shell"

const DEFAULT_PANEL_WIDTH = 600
const MIN_PANEL_WIDTH = 320
const MAX_PANEL_WIDTH = 960

type SidePanelTab = {
  id: string
  title: React.ReactNode
  icon?: React.ReactNode
  highlightedIcon?: React.ReactNode
  trailingContent?: React.ReactNode
  tooltip?: React.ReactNode
  content: React.ReactNode
  closable?: boolean
  preview?: boolean
  labelOnly?: boolean
  highlighted?: boolean
  onActivate?: () => void
  onBeforeClose?: () => boolean
  onClose?: () => void
  menuItems?: Array<{
    id: string
    label: React.ReactNode
    onSelect: () => void
    disabled?: boolean
    destructive?: boolean
  }>
}

type SidePanelController = {
  tabs: SidePanelTab[]
  activeTabId: string | null
  isOpen: boolean
  openPanel: () => void
  closePanel: () => void
  togglePanel: (open?: boolean) => void
  openTab: (
    tab: SidePanelTab,
    options?: { activate?: boolean; insertAfterTabId?: string }
  ) => void
  updateTab: (id: string, patch: Partial<SidePanelTab>) => void
  closeTab: (id: string) => void
  closeActiveTab: () => boolean
  closeOtherTabs: (id: string) => void
  closeTabsToRight: (id: string) => void
  activateTab: (id: string | null) => void
  activateAdjacentTab: (direction: "next" | "previous") => boolean
  moveTab: (id: string, targetId: string) => void
  pinTab: (id: string) => void
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function clampPanelWidth(width: number) {
  return clamp(width, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH)
}

function readStoredPanelWidth(key: string, fallback: number) {
  if (typeof window === "undefined") {
    return fallback
  }

  const stored = Number.parseFloat(window.localStorage.getItem(key) ?? "")

  return Number.isFinite(stored) ? clampPanelWidth(stored) : fallback
}

function getNextActiveTabId(
  tabs: SidePanelTab[],
  closedId: string,
  recentTabIds: string[]
) {
  const index = tabs.findIndex((tab) => tab.id === closedId)
  const remaining = tabs.filter((tab) => tab.id !== closedId)
  const remainingIds = new Set(remaining.map((tab) => tab.id))
  const recent = recentTabIds.find((id) => id !== closedId && remainingIds.has(id))

  return recent ?? remaining[index - 1]?.id ?? remaining[index]?.id ?? null
}

function placeTab(
  tabs: SidePanelTab[],
  tab: SidePanelTab,
  insertAfterTabId?: string
) {
  const existingIndex = tabs.findIndex((item) => item.id === tab.id)
  const current = existingIndex === -1 ? tabs.filter((item) => !item.preview) : tabs
  const normalized =
    existingIndex === -1
      ? tab
      : {
          ...tab,
          preview: tabs[existingIndex]?.preview === false ? false : tab.preview,
        }

  if (existingIndex !== -1) {
    return current.map((item) => (item.id === tab.id ? normalized : item))
  }

  const insertionIndex = insertAfterTabId
    ? current.findIndex((item) => item.id === insertAfterTabId)
    : -1

  if (insertionIndex === -1) {
    return [...current, normalized]
  }

  return [
    ...current.slice(0, insertionIndex + 1),
    normalized,
    ...current.slice(insertionIndex + 1),
  ]
}

function useSidePanelController(initialTabs: SidePanelTab[] = []) {
  const [tabs, setTabs] = React.useState(initialTabs)
  const [activeTabId, setActiveTabId] = React.useState<string | null>(
    initialTabs[0]?.id ?? null
  )
  const [recentTabIds, setRecentTabIds] = React.useState<string[]>([])
  const [isOpen, setIsOpen] = React.useState(initialTabs.length > 0)

  function activateTab(id: string | null) {
    setActiveTabId(id)

    if (id != null) {
      setRecentTabIds((current) => [id, ...current.filter((item) => item !== id)])
      setIsOpen(true)
      tabs.find((tab) => tab.id === id)?.onActivate?.()
    }
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const closingTab = current.find((tab) => tab.id === id)

      if (!closingTab || closingTab.onBeforeClose?.() === false) {
        return current
      }

      const nextActive = getNextActiveTabId(current, id, recentTabIds)
      closingTab.onClose?.()

      setRecentTabIds((recent) => recent.filter((item) => item !== id))
      setActiveTabId((active) => (active === id ? nextActive : active))
      setIsOpen((open) => (nextActive == null ? false : open))

      return current.filter((tab) => tab.id !== id)
    })
  }

  const controller: SidePanelController = {
    tabs,
    activeTabId,
    isOpen,
    openPanel: () => setIsOpen(true),
    closePanel: () => setIsOpen(false),
    togglePanel: (open) => {
      setIsOpen((current) => open ?? !current)
    },
    openTab: (tab, options = {}) => {
      const activate = options.activate ?? true

      setTabs((current) => placeTab(current, tab, options.insertAfterTabId))

      if (activate) {
        setActiveTabId(tab.id)
        setRecentTabIds((current) => [
          tab.id,
          ...current.filter((item) => item !== tab.id),
        ])
        setIsOpen(true)
        tab.onActivate?.()
      }
    },
    updateTab: (id, patch) => {
      setTabs((current) =>
        current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab))
      )
    },
    closeTab,
    closeActiveTab: () => {
      if (activeTabId == null) {
        return false
      }

      closeTab(activeTabId)
      return true
    },
    closeOtherTabs: (id) => {
      setTabs((current) => {
        const active = current.find((tab) => tab.id === id)
        const closing = current.filter(
          (tab) => tab.id !== id && tab.closable !== false
        )

        if (!active || closing.some((tab) => tab.onBeforeClose?.() === false)) {
          return current
        }

        closing.forEach((tab) => tab.onClose?.())
        setActiveTabId(id)
        setRecentTabIds([id])
        setIsOpen(true)
        return current.filter((tab) => tab.id === id || tab.closable === false)
      })
    },
    closeTabsToRight: (id) => {
      setTabs((current) => {
        const index = current.findIndex((tab) => tab.id === id)

        if (index === -1) {
          return current
        }

        const closing = current
          .slice(index + 1)
          .filter((tab) => tab.closable !== false)

        if (closing.some((tab) => tab.onBeforeClose?.() === false)) {
          return current
        }

        const closingIds = new Set(closing.map((tab) => tab.id))
        closing.forEach((tab) => tab.onClose?.())
        setRecentTabIds((recent) => recent.filter((tabId) => !closingIds.has(tabId)))
        setActiveTabId((active) =>
          active != null && closingIds.has(active) ? id : active
        )
        return current.filter((tab) => !closingIds.has(tab.id))
      })
    },
    activateTab,
    activateAdjacentTab: (direction) => {
      if (!isOpen || tabs.length < 2) {
        return false
      }

      const index =
        activeTabId == null
          ? -1
          : tabs.findIndex((tab) => tab.id === activeTabId)
      const next =
        index === -1
          ? direction === "next"
            ? tabs[0]
            : tabs.at(-1)
          : direction === "next"
            ? tabs[(index + 1) % tabs.length]
            : tabs[(index - 1 + tabs.length) % tabs.length]

      if (!next) {
        return false
      }

      activateTab(next.id)
      return true
    },
    moveTab: (id, targetId) => {
      setTabs((current) => {
        const from = current.findIndex((tab) => tab.id === id)
        const to = current.findIndex((tab) => tab.id === targetId)

        if (from === -1 || to === -1 || from === to) {
          return current
        }

        const next = [...current]
        const [tab] = next.splice(from, 1)

        if (!tab) {
          return current
        }

        next.splice(to, 0, tab)
        return next
      })
    },
    pinTab: (id) => {
      setTabs((current) =>
        current.map((tab) => (tab.id === id ? { ...tab, preview: false } : tab))
      )
    },
  }

  return controller
}

function SidePanelTabButton({
  tab,
  active,
  onActivate,
  onClose,
  onPin,
}: {
  tab: SidePanelTab
  active: boolean
  onActivate: () => void
  onClose: () => void
  onPin: () => void
}) {
  const icon = active && tab.highlightedIcon ? tab.highlightedIcon : tab.icon
  const content = (
    <div
      className={cn(
        "group/tab relative my-auto flex h-7 max-w-40 shrink-0 items-center gap-0.5 overflow-hidden rounded-lg px-2 py-1 text-sm",
        active
          ? "bg-background text-foreground shadow-[0_0_0_0.5px_var(--border)]"
          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
        tab.highlighted && "text-primary",
        tab.labelOnly && "pointer-events-none text-muted-foreground"
      )}
      data-tab-id={tab.id}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-default items-center gap-1.5 outline-none"
        disabled={tab.labelOnly}
        onClick={onActivate}
        onDoubleClick={tab.preview ? onPin : undefined}
      >
        {icon ? (
          <span className="flex size-4 shrink-0 items-center justify-center">
            {icon}
          </span>
        ) : null}
        <span className="truncate">{tab.title}</span>
        {tab.trailingContent ? (
          <span className="ml-1 shrink-0">{tab.trailingContent}</span>
        ) : null}
      </button>

      {tab.menuItems?.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="Tab actions"
              className="size-6 opacity-0 group-hover/tab:opacity-100 data-[state=open]:opacity-100"
              size="icon-xs"
              type="button"
              variant="ghost"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="size-3" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {tab.menuItems.map((item, index) => (
              <React.Fragment key={item.id}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuItem
                  className={item.destructive ? "text-destructive" : undefined}
                  disabled={item.disabled}
                  onSelect={item.onSelect}
                >
                  {item.label}
                </DropdownMenuItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {tab.closable !== false && !tab.labelOnly ? (
        <button
          type="button"
          aria-label="Close tab"
          className={cn(
            "invisible absolute inset-y-0 right-1 z-10 flex items-center pr-1 text-muted-foreground hover:text-foreground",
            "before:pointer-events-none before:absolute before:inset-y-0 before:right-1 before:w-7 before:bg-gradient-to-r before:from-transparent before:content-['']",
            active
              ? "before:to-background"
              : "before:to-muted group-hover/tab:visible group-hover/tab:before:to-muted"
          )}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }}
          onMouseDown={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <X className="relative size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  )

  if (!tab.tooltip) {
    return content
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent>{tab.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type TabbedSidePanelProps = {
  controller: SidePanelController
  storageKey?: string
  defaultWidth?: number
  className?: string
  emptyState?: React.ReactNode
  beforeTabs?: React.ReactNode
  afterTabs?: React.ReactNode
  afterTabsSticky?: React.ReactNode
}

function TabbedSidePanel({
  controller,
  storageKey = "astraflow.desktop-shell.side-panel-width",
  defaultWidth = DEFAULT_PANEL_WIDTH,
  className,
  emptyState,
  beforeTabs,
  afterTabs,
  afterTabsSticky,
}: TabbedSidePanelProps) {
  const shouldReduceMotion = useReducedMotion()
  const [width, setWidth] = React.useState(() =>
    readStoredPanelWidth(storageKey, defaultWidth)
  )
  const [expanded, setExpanded] = React.useState(false)
  const [isResizing, setIsResizing] = React.useState(false)
  const [tabListElement, setTabListElement] = React.useState<HTMLDivElement | null>(null)
  const activeTab =
    controller.tabs.find((tab) => tab.id === controller.activeTabId) ?? null

  React.useEffect(() => {
    if (!expanded) {
      window.localStorage.setItem(storageKey, String(width))
    }
  }, [expanded, storageKey, width])

  React.useEffect(() => {
    if (activeTab?.id == null || !tabListElement) {
      return
    }

    tabListElement
      .querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTab.id)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" })
  }, [activeTab?.id, tabListElement])

  const panelWidth = expanded
    ? "min(100vw, 100%)"
    : `${clampPanelWidth(width)}px`
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, duration: 0.36, bounce: 0.06 }

  return (
    <AnimatePresence initial={false}>
      {controller.isOpen ? (
        <motion.aside
          key="side-panel"
          data-app-shell-focus-area="right-panel"
          className={cn(
            "relative z-30 ml-auto h-full min-h-0 min-w-0 shrink-0 overflow-visible",
            isResizing && "cursor-col-resize select-none",
            className
          )}
          initial={shouldReduceMotion ? false : { width: 0, opacity: 0 }}
          animate={{ width: panelWidth, opacity: 1 }}
          exit={shouldReduceMotion ? { width: 0 } : { width: 0, opacity: 0 }}
          transition={transition}
        >
          {!expanded ? (
            <>
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 z-30 w-px shadow-[-8px_0_16px_-8px_rgb(0_0_0/0.18)]"
              />
              <ResizeHandle
                edge="left"
                onDrag={(delta) =>
                  setWidth((current) => clampPanelWidth(current + delta))
                }
                onResizingChange={setIsResizing}
              />
            </>
          ) : null}

          <div className="absolute inset-0 min-h-0 min-w-0 overflow-hidden">
            <motion.div
              className={cn(
                "absolute top-0 bottom-0 left-0 min-w-0 bg-background",
                !expanded && "border-l"
              )}
              style={{ minWidth: panelWidth, width: panelWidth }}
              transition={transition}
            >
              <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden [contain:layout_paint]">
                <div className="isolate flex h-10 min-w-0 shrink-0 select-none items-center bg-background px-2 [contain:layout_paint]">
                  {beforeTabs ? (
                    <div className="my-auto flex shrink-0 items-center" role="presentation">
                      {beforeTabs}
                    </div>
                  ) : null}

                  <div
                    ref={setTabListElement}
                    role="tablist"
                    className="relative isolate flex h-full min-w-0 flex-1 scroll-px-1 items-center overflow-x-auto overflow-y-hidden [contain:layout_paint] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    <div
                      aria-hidden
                      className="sticky left-0 z-10 h-full w-0 after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-10 after:bg-gradient-to-l after:from-transparent after:to-background after:content-['']"
                    />
                    <div className="relative z-0 flex gap-[3px]">
                      {controller.tabs.map((tab, index) => {
                        const active = tab.id === controller.activeTabId
                        const showSeparator =
                          index < controller.tabs.length - 1 &&
                          !active &&
                          controller.tabs[index + 1]?.id !== controller.activeTabId

                        return (
                          <div
                            className="relative flex max-w-40 shrink-0 items-center pr-1 [contain:content]"
                            key={tab.id}
                            role="tab"
                            aria-selected={active}
                          >
                            <SidePanelTabButton
                              active={active}
                              tab={tab}
                              onActivate={() => controller.activateTab(tab.id)}
                              onClose={() => controller.closeTab(tab.id)}
                              onPin={() => controller.pinTab(tab.id)}
                            />
                            <div
                              aria-hidden
                              className={cn(
                                "absolute right-0 h-3 w-px shrink-0 bg-border transition-opacity duration-200",
                                showSeparator ? "opacity-100" : "opacity-0"
                              )}
                            />
                          </div>
                        )
                      })}
                    </div>
                    <div
                      aria-hidden
                      className="sticky right-0 z-10 h-full w-0 after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-10 after:bg-gradient-to-r after:from-transparent after:to-background after:content-['']"
                    />
                    {afterTabsSticky ? (
                      <div className="sticky right-0 z-10 shrink-0 bg-background">
                        {afterTabsSticky}
                      </div>
                    ) : null}
                  </div>

                  {afterTabs ? (
                    <div className="my-auto flex shrink-0 items-center" role="presentation">
                      {afterTabs}
                    </div>
                  ) : null}

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label={expanded ? "Restore panel width" : "Expand panel"}
                          aria-pressed={expanded}
                          size="icon-sm"
                          type="button"
                          variant={expanded ? "secondary" : "ghost"}
                          onClick={() => setExpanded((current) => !current)}
                        >
                          {expanded ? (
                            <Minimize2 className="size-4" aria-hidden />
                          ) : (
                            <Maximize2 className="size-4" aria-hidden />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {expanded ? "Restore panel width" : "Expand panel"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label="Hide side panel"
                          size="icon-sm"
                          type="button"
                          variant="ghost"
                          onClick={controller.closePanel}
                        >
                          <PanelRightClose className="size-4" aria-hidden />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Hide side panel</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>

                <div className="relative min-h-0 flex-1 overflow-hidden">
                  {activeTab ? activeTab.content : emptyState}
                </div>
              </div>
            </motion.div>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

export { TabbedSidePanel, useSidePanelController }
export type { SidePanelController, SidePanelTab }
