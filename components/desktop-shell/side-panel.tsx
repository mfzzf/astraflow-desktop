"use client"

import * as React from "react"
import { useAtomValue } from "jotai"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable"
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
import {
  appShellStore,
  rightPanelOpenAtom,
  setRightPanelOpen,
} from "@/lib/app-shell/store"
import {
  createRightPanelController,
  type AppShellTabController,
} from "@/lib/app-shell/tab-controller"
import {
  AppShellSortableTab,
  AppShellTabDragDropContext,
  AppShellTabDragOverlay,
  getTabInsertionPlacementFromEvent,
  toTabPayload,
} from "@/lib/app-shell/tab-dnd"

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
  tabController: AppShellTabController
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

function useSidePanelController(initialTabs: SidePanelTab[] = []) {
  const tabController = React.useMemo(() => createRightPanelController(), [])
  const records = useAtomValue(tabController.tabsAtom, { store: appShellStore })
  const activeTabId = useAtomValue(tabController.activeTabAtom, {
    store: appShellStore,
  })
  const isOpen = useAtomValue(rightPanelOpenAtom, { store: appShellStore })

  React.useEffect(() => {
    for (const tab of initialTabs) {
      tabController.openTab(appShellStore, {
        id: tab.id,
        title: tab.title,
        tooltip: tab.tooltip,
        icon: tab.icon,
        highlightedIcon: tab.highlightedIcon,
        trailingContent: tab.trailingContent,
        isClosable: tab.closable,
        isPreview: tab.preview,
        isLabel: tab.labelOnly,
        isHighlighted: tab.highlighted,
        contextMenuItems: tab.menuItems,
        props: { content: tab.content },
        onActivate: tab.onActivate,
        onBeforeClose: () => tab.onBeforeClose?.(),
        onClose: tab.onClose,
      })
    }
  }, [initialTabs, tabController])

  const tabs = React.useMemo<SidePanelTab[]>(
    () =>
      records.map((tab) => ({
        id: tab.tabId,
        title: tab.title,
        icon: tab.icon,
        highlightedIcon: tab.highlightedIcon,
        trailingContent: tab.trailingContent,
        tooltip: tab.tooltip,
        content: tab.props.content as React.ReactNode,
        closable: tab.isClosable,
        preview: tab.isPreview,
        labelOnly: tab.isLabel,
        highlighted: tab.isHighlighted,
        onActivate: tab.onActivate,
        onBeforeClose: () => tab.onBeforeClose?.(appShellStore) !== false,
        onClose: tab.onClose,
        menuItems: tab.contextMenuItems,
      })),
    [records],
  )

  const controller: SidePanelController = {
    tabs,
    activeTabId,
    isOpen,
    tabController,
    openPanel: () => setRightPanelOpen(appShellStore, true),
    closePanel: () => setRightPanelOpen(appShellStore, false),
    togglePanel: (open) => {
      setRightPanelOpen(appShellStore, open ?? !isOpen)
    },
    openTab: (tab, options = {}) =>
      void tabController.openTab(appShellStore, {
        id: tab.id,
        title: tab.title,
        tooltip: tab.tooltip,
        icon: tab.icon,
        highlightedIcon: tab.highlightedIcon,
        trailingContent: tab.trailingContent,
        isClosable: tab.closable,
        isPreview: tab.preview,
        isLabel: tab.labelOnly,
        isHighlighted: tab.highlighted,
        contextMenuItems: tab.menuItems,
        insertAfterTabId: options.insertAfterTabId,
        activate: options.activate,
        props: { content: tab.content },
        onActivate: tab.onActivate,
        onBeforeClose: () => tab.onBeforeClose?.(),
        onClose: tab.onClose,
      }),
    updateTab: (id, patch) => {
      tabController.updateTab(appShellStore, id, {
        title: patch.title,
        tooltip: patch.tooltip,
        icon: patch.icon,
        highlightedIcon: patch.highlightedIcon,
        trailingContent: patch.trailingContent,
        isClosable: patch.closable,
        isPreview: patch.preview,
        isLabel: patch.labelOnly,
        isHighlighted: patch.highlighted,
        contextMenuItems: patch.menuItems,
        props: patch.content === undefined ? undefined : { content: patch.content },
      })
    },
    closeTab: (id) => tabController.closeTab(appShellStore, id),
    closeActiveTab: () => {
      return tabController.closeActiveTab(appShellStore)
    },
    closeOtherTabs: (id) => tabController.closeOtherTabs(appShellStore, id),
    closeTabsToRight: (id) => tabController.closeTabsToRight(appShellStore, id),
    activateTab: (id) => tabController.activateTab(appShellStore, id),
    activateAdjacentTab: (direction) =>
      tabController.activateAdjacentTab(appShellStore, direction),
    moveTab: (id, targetId) => tabController.reorderTab(appShellStore, id, targetId),
    pinTab: (id) => tabController.pinTab(appShellStore, id),
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
                <AppShellTabDragDropContext
                  onDragEnd={(event) => {
                    const activePayload = toTabPayload(event.active.data.current)
                    const overPayload = toTabPayload(event.over?.data.current)

                    if (activePayload && overPayload) {
                      controller.tabController.reorderTab(
                        appShellStore,
                        activePayload.tabId,
                        overPayload.tabId,
                        {
                          insertion: getTabInsertionPlacementFromEvent(event),
                        },
                      )
                    }
                  }}
                >
                <div className="isolate flex h-10 min-w-0 shrink-0 select-none items-center bg-token-main-surface-primary px-2 [contain:layout_paint]">
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
                    <SortableContext
                      items={controller.tabs.map((tab) => tab.id)}
                      strategy={horizontalListSortingStrategy}
                    >
                      <div className="relative z-0 flex gap-[3px]">
                        {controller.tabs.map((tab, index) => {
                          const active = tab.id === controller.activeTabId
                          const showSeparator =
                            index < controller.tabs.length - 1 &&
                            !active &&
                            controller.tabs[index + 1]?.id !== controller.activeTabId

                          return (
                            <AppShellSortableTab
                              data={{
                                kind: "app-shell-tab",
                                controller: controller.tabController,
                                tabId: tab.id,
                              }}
                              id={tab.id}
                              key={tab.id}
                            >
                              {({ setNodeRef, listeners, attributes, style }) => (
                                <div
                                  ref={setNodeRef}
                                  className="relative flex max-w-40 shrink-0 items-center pr-1 [contain:content]"
                                  aria-selected={active}
                                  style={style}
                                  {...attributes}
                                  {...listeners}
                                  role="tab"
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
                                      "absolute right-0 h-3 w-px shrink-0 bg-token-border-light transition-opacity duration-200",
                                      showSeparator ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                </div>
                              )}
                            </AppShellSortableTab>
                          )
                        })}
                      </div>
                    </SortableContext>
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
                <AppShellTabDragOverlay>
                  {(activeId) => {
                    const tab = controller.tabs.find((item) => item.id === activeId)
                    return tab ? (
                      <div className="scale-[1.02] rounded-(--radius-md) bg-token-main-surface-primary shadow-md">
                        <SidePanelTabButton
                          active
                          tab={tab}
                          onActivate={() => undefined}
                          onClose={() => undefined}
                          onPin={() => undefined}
                        />
                      </div>
                    ) : null
                  }}
                </AppShellTabDragOverlay>
                </AppShellTabDragDropContext>

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
