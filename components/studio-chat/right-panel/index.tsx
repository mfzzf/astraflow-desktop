"use client"

import * as React from "react"
import { RiAddLine, RiLoader4Line } from "@remixicon/react"
import {
  Folder,
  GitCompareArrows,
  Globe,
  MessageSquare,
  SquareTerminal,
} from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import {
  STUDIO_OPEN_REVIEW_PANEL_EVENT,
  type StudioOpenReviewPanelDetail,
  type StudioReviewFileChange,
} from "@/lib/studio-review-panel"
import type { StudioLocalProjectWithGitInfo } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { getBrowserTabTitle } from "../browser-utils"
import {
  createSidePanelEntryFromPath,
  getMarkdownTargetBrowserUrl,
  getMarkdownTargetFilePath,
  resolveRelativeWorkspaceFilePath,
} from "../markdown-targets"
import {
  createWorkspaceBrowserTab,
  createWorkspaceFileTab,
  createWorkspaceReviewTab,
  createWorkspaceSideChatTab,
  createWorkspaceTerminalTab,
  formatTerminalTabTitle,
  getPathTail,
  getWorkspaceTabMode,
  useCloseTabCommand,
} from "../workspace-tabs"
import type {
  StudioRightPanelMode,
  StudioWorkspaceBrowserTab,
  StudioWorkspaceFileTab,
  StudioWorkspaceReviewTab,
  StudioWorkspaceSideChatTab,
  StudioWorkspaceTab,
  StudioWorkspaceTerminalTab,
} from "../types"
import {
  StudioRightPanelBrowser,
  StudioRightPanelBrowserSettings,
} from "./browser"
import { StudioRightPanelFiles } from "./files"
import {
  getStudioRightPanelLabels,
  type StudioRightPanelLabels,
} from "./labels"
import { StudioReviewPanel } from "./review"
import { StudioRightPanelSideChat } from "./side-chat"
import { StudioWorkspaceTabStrip } from "./tab-strip"
import { StudioSideTerminal } from "./terminal"

export function StudioRightPanel({
  open,
  focused,
  mode,
  width,
  project,
  onOpenChange,
  onFocusedChange,
  onModeChange,
  onWidthChange,
}: {
  open: boolean
  focused: boolean
  mode: StudioRightPanelMode
  width: number
  project: StudioLocalProjectWithGitInfo | null
  onOpenChange: (open: boolean) => void
  onFocusedChange: (focused: boolean) => void
  onModeChange: (mode: StudioRightPanelMode) => void
  onWidthChange: (width: number) => void
}) {
  const { locale, t } = useI18n()
  const labels = React.useMemo(
    () => getStudioRightPanelLabels(locale),
    [locale]
  )
  const [workspaceTabs, setWorkspaceTabs] = React.useState<
    StudioWorkspaceTab[]
  >([])
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = React.useState("")
  const [nextTerminalSequence, setNextTerminalSequence] = React.useState(1)
  const [reviewLoading, setReviewLoading] = React.useState(false)
  const suppressAutoOpenModeRef = React.useRef<StudioRightPanelMode | null>(
    null
  )
  const activeWorkspaceTab =
    workspaceTabs.find((tab) => tab.id === activeWorkspaceTabId) ??
    workspaceTabs[0] ??
    null
  const activeWorkspaceMode = activeWorkspaceTab
    ? getWorkspaceTabMode(activeWorkspaceTab)
    : mode
  const fileTabs = workspaceTabs.filter(
    (tab): tab is StudioWorkspaceFileTab => tab.kind === "files"
  )
  const terminalTabs = workspaceTabs.filter(
    (tab): tab is StudioWorkspaceTerminalTab => tab.kind === "terminal"
  )

  const activateWorkspaceTab = React.useCallback(
    (tab: StudioWorkspaceTab) => {
      setActiveWorkspaceTabId(tab.id)
      onModeChange(getWorkspaceTabMode(tab))
    },
    [onModeChange]
  )

  const handleOpenFileTab = React.useCallback(
    (entry: AstraFlowSidePanelDirectoryEntry, focusLine?: number | null) => {
      const nextFocusLine = focusLine ?? null
      const existingTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceFileTab =>
          tab.kind === "files" && tab.entry?.path === entry.path
      )

      if (existingTab) {
        if (existingTab.focusLine !== nextFocusLine) {
          setWorkspaceTabs((current) =>
            current.map((tab) =>
              tab.id === existingTab.id
                ? { ...existingTab, focusLine: nextFocusLine }
                : tab
            )
          )
        }

        activateWorkspaceTab(existingTab)
        return
      }

      const reusableEmptyFileTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceFileTab =>
          tab.kind === "files" && tab.entry === null
      )
      const nextTab: StudioWorkspaceFileTab = reusableEmptyFileTab
        ? {
            ...reusableEmptyFileTab,
            title: entry.name,
            entry,
            focusLine: nextFocusLine,
          }
        : createWorkspaceFileTab(entry, labels.files, nextFocusLine)

      setWorkspaceTabs((current) => {
        if (reusableEmptyFileTab) {
          return current.map((tab) =>
            tab.id === reusableEmptyFileTab.id ? nextTab : tab
          )
        }

        return [...current, nextTab]
      })
      activateWorkspaceTab(nextTab)
    },
    [activateWorkspaceTab, labels.files, workspaceTabs]
  )

  const handleOpenProjectReview = React.useCallback(async () => {
    if (!project || reviewLoading) {
      return
    }

    setReviewLoading(true)

    try {
      const response = await fetch(
        `/api/studio/local-projects/git?id=${encodeURIComponent(project.id)}`
      )
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        data?: { files?: StudioReviewFileChange[] }
      } | null

      if (!response.ok || !payload?.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : labels.envLoadChangesFailed
        )
      }

      const detail: StudioOpenReviewPanelDetail = {
        scopeLabel: labels.envUncommittedChanges,
        files: payload.data?.files ?? [],
      }
      const existingReviewTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceReviewTab => tab.kind === "review"
      )
      const nextTab = existingReviewTab
        ? { ...existingReviewTab, detail }
        : createWorkspaceReviewTab(labels.review, detail)

      setWorkspaceTabs((current) =>
        existingReviewTab
          ? current.map((tab) => (tab.id === nextTab.id ? nextTab : tab))
          : [...current, nextTab]
      )
      activateWorkspaceTab(nextTab)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : labels.envLoadChangesFailed
      )
      onModeChange("launcher")
    } finally {
      setReviewLoading(false)
    }
  }, [
    activateWorkspaceTab,
    labels.envLoadChangesFailed,
    labels.envUncommittedChanges,
    labels.review,
    onModeChange,
    project,
    reviewLoading,
    workspaceTabs,
  ])

  const handleAddWorkspaceMode = React.useCallback(
    (nextMode: StudioRightPanelMode) => {
      if (nextMode === "launcher" || nextMode === "browser-settings") {
        onModeChange(nextMode)
        return
      }

      if (nextMode === "files") {
        const existingFileTab = workspaceTabs.find(
          (tab): tab is StudioWorkspaceFileTab => tab.kind === "files"
        )
        const nextTab =
          existingFileTab ?? createWorkspaceFileTab(null, labels.files)

        if (!existingFileTab) {
          setWorkspaceTabs((current) => [...current, nextTab])
        }

        activateWorkspaceTab(nextTab)
        return
      }

      if (nextMode === "browser") {
        if (mode === "browser-settings") {
          const existingBrowserTab =
            activeWorkspaceTab?.kind === "browser"
              ? activeWorkspaceTab
              : workspaceTabs.find(
                  (tab): tab is StudioWorkspaceBrowserTab =>
                    tab.kind === "browser"
                )

          if (existingBrowserTab) {
            activateWorkspaceTab(existingBrowserTab)
            return
          }
        }

        const nextTab = createWorkspaceBrowserTab()

        setWorkspaceTabs((current) => [...current, nextTab])
        activateWorkspaceTab(nextTab)
        return
      }

      if (nextMode === "terminal") {
        const nextTab = createWorkspaceTerminalTab(
          project,
          t.studioTerminalTab,
          nextTerminalSequence
        )

        setNextTerminalSequence((current) => current + 1)
        setWorkspaceTabs((current) => [...current, nextTab])
        activateWorkspaceTab(nextTab)
        return
      }

      if (nextMode === "review") {
        const existingReviewTab = workspaceTabs.find(
          (tab): tab is StudioWorkspaceReviewTab => tab.kind === "review"
        )

        if (existingReviewTab) {
          activateWorkspaceTab(existingReviewTab)
        } else {
          void handleOpenProjectReview()
        }
        return
      }

      const existingSideChatTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceSideChatTab => tab.kind === "side-chat"
      )
      const nextTab =
        existingSideChatTab ?? createWorkspaceSideChatTab(labels.sideChat)

      if (!existingSideChatTab) {
        setWorkspaceTabs((current) => [...current, nextTab])
      }

      activateWorkspaceTab(nextTab)
    },
    [
      activateWorkspaceTab,
      labels.files,
      labels.sideChat,
      activeWorkspaceTab,
      handleOpenProjectReview,
      mode,
      nextTerminalSequence,
      onModeChange,
      project,
      t.studioTerminalTab,
      workspaceTabs,
    ]
  )

  const handleUpdateWorkspaceTab = React.useCallback(
    (
      tabId: string,
      updater: (tab: StudioWorkspaceTab) => StudioWorkspaceTab
    ) => {
      setWorkspaceTabs((current) =>
        current.map((tab) => (tab.id === tabId ? updater(tab) : tab))
      )
    },
    []
  )

  const handleCloseWorkspaceTab = React.useCallback(
    (tabId: string) => {
      const closingIndex = workspaceTabs.findIndex((tab) => tab.id === tabId)

      if (closingIndex < 0) {
        return
      }

      const nextTabs = workspaceTabs.filter((tab) => tab.id !== tabId)
      const nextActiveTab =
        activeWorkspaceTabId === tabId
          ? (nextTabs[Math.max(0, closingIndex - 1)] ?? nextTabs[0] ?? null)
          : (nextTabs.find((tab) => tab.id === activeWorkspaceTabId) ?? null)

      if (!nextActiveTab) {
        suppressAutoOpenModeRef.current = getWorkspaceTabMode(
          workspaceTabs[closingIndex]
        )
      }

      setWorkspaceTabs(nextTabs)
      setActiveWorkspaceTabId(nextActiveTab?.id ?? "")
      onModeChange(
        nextActiveTab ? getWorkspaceTabMode(nextActiveTab) : "launcher"
      )
    },
    [activeWorkspaceTabId, onModeChange, workspaceTabs]
  )
  const reviewModeMenuItems = React.useMemo(
    () =>
      project
        ? [
            {
              key: "review",
              label: labels.review,
              icon: GitCompareArrows,
              onSelect: () => handleAddWorkspaceMode("review"),
            },
          ]
        : [],
    [handleAddWorkspaceMode, labels.review, project]
  )

  useCloseTabCommand(
    () => {
      if (activeWorkspaceTab) {
        handleCloseWorkspaceTab(activeWorkspaceTab.id)
      }
    },
    open && Boolean(activeWorkspaceTab)
  )

  React.useEffect(() => {
    if (mode === "launcher" || mode === "browser-settings") {
      suppressAutoOpenModeRef.current = null
    }
  }, [mode])

  React.useEffect(() => {
    if (!open) {
      return
    }

    if (mode === "launcher" || mode === "browser-settings") {
      return
    }

    if (!activeWorkspaceTab && suppressAutoOpenModeRef.current === mode) {
      return
    }

    if (
      activeWorkspaceTab &&
      getWorkspaceTabMode(activeWorkspaceTab) === mode
    ) {
      return
    }

    queueMicrotask(() => handleAddWorkspaceMode(mode))
  }, [activeWorkspaceTab, handleAddWorkspaceMode, mode, open])

  const handleOpenMarkdownTarget = React.useCallback(
    (href: string, line?: number | null) => {
      const filePath =
        getMarkdownTargetFilePath(href) ??
        resolveRelativeWorkspaceFilePath(href, project?.path)

      onOpenChange(true)

      if (filePath) {
        handleOpenFileTab(createSidePanelEntryFromPath(filePath), line)
        return
      }

      const url = getMarkdownTargetBrowserUrl(href)

      if (!url) {
        return
      }

      const nextTab: StudioWorkspaceBrowserTab = {
        ...createWorkspaceBrowserTab(),
        address: url,
        title: getBrowserTabTitle(url),
        url,
      }

      setWorkspaceTabs((current) => [...current, nextTab])
      activateWorkspaceTab(nextTab)
    },
    [activateWorkspaceTab, handleOpenFileTab, onOpenChange, project?.path]
  )

  React.useEffect(() => {
    function handleEvent(event: Event) {
      const detail = (event as CustomEvent<StudioOpenMarkdownTargetDetail>)
        .detail

      if (detail?.href) {
        handleOpenMarkdownTarget(detail.href, detail.line)
      }
    }

    window.addEventListener(STUDIO_OPEN_MARKDOWN_TARGET_EVENT, handleEvent)

    return () =>
      window.removeEventListener(STUDIO_OPEN_MARKDOWN_TARGET_EVENT, handleEvent)
  }, [handleOpenMarkdownTarget])

  const handleOpenReviewPanel = React.useCallback(
    (detail: StudioOpenReviewPanelDetail) => {
      onOpenChange(true)

      const existingReviewTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceReviewTab => tab.kind === "review"
      )
      const nextTab = existingReviewTab
        ? { ...existingReviewTab, detail }
        : createWorkspaceReviewTab(labels.review, detail)

      setWorkspaceTabs((current) =>
        existingReviewTab
          ? current.map((tab) => (tab.id === nextTab.id ? nextTab : tab))
          : [...current, nextTab]
      )
      activateWorkspaceTab(nextTab)
    },
    [activateWorkspaceTab, labels.review, onOpenChange, workspaceTabs]
  )

  React.useEffect(() => {
    function handleEvent(event: Event) {
      const detail = (event as CustomEvent<StudioOpenReviewPanelDetail>).detail

      if (detail?.files) {
        handleOpenReviewPanel(detail)
      }
    }

    window.addEventListener(STUDIO_OPEN_REVIEW_PANEL_EVENT, handleEvent)

    return () =>
      window.removeEventListener(STUDIO_OPEN_REVIEW_PANEL_EVENT, handleEvent)
  }, [handleOpenReviewPanel])

  React.useEffect(() => {
    if (!open) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (focused) {
          onFocusedChange(false)
          return
        }

        onOpenChange(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [focused, onFocusedChange, onOpenChange, open])

  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()

    const startX = event.clientX
    const startWidth = width

    function handleMove(moveEvent: PointerEvent) {
      onWidthChange(startWidth + startX - moveEvent.clientX)
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
  }

  return (
    <aside
      data-testid="studio-right-panel"
      aria-hidden={!open}
      className={cn(
        "relative shrink-0 overflow-hidden border-l bg-background transition-[width,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        open ? "border-border" : "pointer-events-none border-transparent",
        focused && "min-w-0 flex-1 border-l-0"
      )}
      style={{ width: open ? (focused ? "100%" : width) : 0 }}
    >
      <div
        className={cn(
          "relative flex h-full min-h-0 flex-col bg-background transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          open ? "translate-x-0 opacity-100" : "translate-x-5 opacity-0"
        )}
        style={{ width: focused ? "100%" : width }}
      >
        {!focused ? (
          <div
            role="separator"
            aria-orientation="vertical"
            className="absolute top-0 left-0 z-20 h-full w-1 cursor-col-resize bg-transparent hover:bg-primary/25"
            onPointerDown={handleResizePointerDown}
          />
        ) : null}

        {mode === "launcher" && workspaceTabs.length === 0 ? (
          <StudioRightPanelLauncher
            canReview={Boolean(project)}
            labels={labels}
            reviewLoading={reviewLoading}
            onModeChange={onModeChange}
          />
        ) : (
          <>
            <StudioWorkspaceTabStrip
              activeMode={activeWorkspaceMode}
              activeTabId={activeWorkspaceTab?.id ?? ""}
              extraModeItems={reviewModeMenuItems}
              labels={labels}
              focused={focused}
              tabs={workspaceTabs}
              onAddMode={handleAddWorkspaceMode}
              onCloseTab={handleCloseWorkspaceTab}
              onSelectTab={(tabId) => {
                const nextTab = workspaceTabs.find((tab) => tab.id === tabId)

                if (nextTab) {
                  activateWorkspaceTab(nextTab)
                }
              }}
              onToggleFocused={() => onFocusedChange(!focused)}
            />

            <div className="relative min-h-0 flex-1">
              {mode === "browser-settings" ? (
                <StudioRightPanelBrowserSettings
                  labels={labels}
                  onModeChange={handleAddWorkspaceMode}
                />
              ) : null}

              <div
                className={cn(
                  "absolute inset-0 min-h-0",
                  mode === "browser-settings" ||
                    activeWorkspaceTab?.kind !== "files"
                    ? "hidden"
                    : "block"
                )}
              >
                <StudioRightPanelFiles
                  activeFileTabId={
                    activeWorkspaceTab?.kind === "files"
                      ? activeWorkspaceTab.id
                      : ""
                  }
                  labels={labels}
                  defaultDirectory={project?.path ?? null}
                  fileTabs={fileTabs}
                  open={
                    open &&
                    mode !== "browser-settings" &&
                    activeWorkspaceTab?.kind === "files"
                  }
                  onOpenFile={handleOpenFileTab}
                />
              </div>

              <div
                className={cn(
                  "absolute inset-0 min-h-0",
                  mode === "browser-settings" ||
                    activeWorkspaceTab?.kind !== "browser"
                    ? "hidden"
                    : "block"
                )}
              >
                {activeWorkspaceTab?.kind === "browser" ? (
                  <StudioRightPanelBrowser
                    labels={labels}
                    tab={activeWorkspaceTab}
                    onModeChange={handleAddWorkspaceMode}
                    onTabChange={(updater) =>
                      handleUpdateWorkspaceTab(activeWorkspaceTab.id, (tab) =>
                        tab.kind === "browser" ? updater(tab) : tab
                      )
                    }
                  />
                ) : null}
              </div>

              {activeWorkspaceTab?.kind === "side-chat" ? (
                <StudioRightPanelSideChat labels={labels} />
              ) : null}

              {activeWorkspaceTab?.kind === "review" ? (
                <div
                  className={cn(
                    "absolute inset-0 min-h-0",
                    mode === "browser-settings" ? "hidden" : "block"
                  )}
                >
                  <StudioReviewPanel
                    labels={labels}
                    detail={activeWorkspaceTab.detail}
                    project={project}
                    onOpenFile={handleOpenMarkdownTarget}
                  />
                </div>
              ) : null}

              {terminalTabs.length > 0 ? (
                <div
                  className={cn(
                    "absolute inset-0 min-h-0",
                    mode === "browser-settings" ||
                      activeWorkspaceTab?.kind !== "terminal"
                      ? "hidden"
                      : "block"
                  )}
                >
                  <StudioSideTerminal
                    active={
                      open &&
                      mode !== "browser-settings" &&
                      activeWorkspaceTab?.kind === "terminal"
                    }
                    activeTabId={
                      activeWorkspaceTab?.kind === "terminal"
                        ? activeWorkspaceTab.id
                        : ""
                    }
                    labels={labels}
                    tabs={terminalTabs}
                    onResolvedCwd={(tabId, resolvedCwd) =>
                      handleUpdateWorkspaceTab(tabId, (tab) => {
                        if (tab.kind !== "terminal") {
                          return tab
                        }

                        const title =
                          tab.cwd === null
                            ? formatTerminalTabTitle(
                                getPathTail(resolvedCwd) || t.studioTerminalTab,
                                tab.sequence
                              )
                            : tab.title

                        return {
                          ...tab,
                          resolvedCwd,
                          title,
                        }
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

export function StudioRightPanelLauncher({
  canReview,
  labels,
  reviewLoading,
  onModeChange,
}: {
  canReview: boolean
  labels: StudioRightPanelLabels
  reviewLoading: boolean
  onModeChange: (mode: StudioRightPanelMode) => void
}) {
  const items = getStudioRightPanelItems(labels, {
    canReview,
    reviewLoading,
  })

  return (
    <div className="flex h-full min-h-0 flex-col px-3 pt-12 pb-5">
      <div className="flex min-h-0 flex-1 items-center">
        <div className="flex w-full min-w-0 flex-col gap-1.5">
          {items.map((item) => {
            const Icon = item.icon

            return (
              <button
                key={item.mode}
                type="button"
                className="flex h-10 w-full min-w-0 items-center gap-2.5 rounded-lg bg-muted/55 px-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-muted/55"
                disabled={item.disabled}
                onClick={() => onModeChange(item.mode)}
              >
                {item.loading ? (
                  <RiLoader4Line
                    aria-hidden
                    className="size-4 shrink-0 animate-spin text-muted-foreground"
                  />
                ) : (
                  <Icon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {item.shortcut}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function getStudioRightPanelItems(
  labels: StudioRightPanelLabels,
  options: { canReview?: boolean; reviewLoading?: boolean } = {}
) {
  return [
    {
      mode: "files" as const,
      label: labels.files,
      shortcut: labels.filesShortcut,
      icon: Folder,
    },
    {
      mode: "side-chat" as const,
      label: labels.sideChat,
      shortcut: labels.sideChatShortcut,
      icon: MessageSquare,
    },
    {
      mode: "browser" as const,
      label: labels.browser,
      shortcut: "⌘T",
      icon: Globe,
    },
    ...(options.canReview
      ? [
          {
            mode: "review" as const,
            label: labels.review,
            shortcut: "",
            icon: GitCompareArrows,
            disabled: options.reviewLoading,
            loading: options.reviewLoading,
          },
        ]
      : []),
    {
      mode: "terminal" as const,
      label: labels.terminal,
      shortcut: "",
      icon: SquareTerminal,
    },
  ]
}

export function StudioRightPanelModeMenu({
  activeMode,
  labels,
  extraItems = [],
  includeActiveMode = false,
  onModeChange,
}: {
  activeMode: StudioRightPanelMode
  labels: StudioRightPanelLabels
  extraItems?: Array<{
    key: string
    label: string
    icon: React.ComponentType<{ "aria-hidden"?: boolean; className?: string }>
    shortcut?: string
    onSelect: () => void
  }>
  includeActiveMode?: boolean
  onModeChange: (mode: StudioRightPanelMode) => void
}) {
  const [open, setOpen] = React.useState(false)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const items = getStudioRightPanelItems(labels).filter(
    (item) => includeActiveMode || item.mode !== activeMode
  )

  React.useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    window.addEventListener("pointerdown", handlePointerDown)

    return () => window.removeEventListener("pointerdown", handlePointerDown)
  }, [open])

  return (
    <div ref={menuRef} className="relative shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-expanded={open}
        aria-label={labels.add}
        title={labels.add}
        className={cn("size-8 rounded-lg", open && "bg-muted text-foreground")}
        onClick={() => setOpen((current) => !current)}
      >
        <RiAddLine aria-hidden className="size-4" />
      </Button>

      {open ? (
        <div className="absolute top-9 left-0 z-40 w-44 rounded-lg border bg-background p-1.5 text-sm shadow-xl">
          {extraItems.map((item) => {
            const Icon = item.icon

            return (
              <button
                key={item.key}
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left font-medium hover:bg-muted"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <Icon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <span className="text-xs text-muted-foreground">
                    {item.shortcut}
                  </span>
                ) : null}
              </button>
            )
          })}
          {extraItems.length > 0 && items.length > 0 ? (
            <div className="my-1 h-px bg-border" />
          ) : null}
          {items.map((item) => {
            const Icon = item.icon

            return (
              <button
                key={item.mode}
                type="button"
                className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left font-medium hover:bg-muted disabled:cursor-default disabled:text-muted-foreground disabled:hover:bg-transparent"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  onModeChange(item.mode)
                }}
              >
                {item.loading ? (
                  <RiLoader4Line
                    aria-hidden
                    className="size-4 shrink-0 animate-spin text-muted-foreground"
                  />
                ) : (
                  <Icon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <span className="text-xs text-muted-foreground">
                    {item.shortcut}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export {
  StudioRightPanelBrowser,
  StudioRightPanelBrowserSettings,
} from "./browser"
export { StudioRightPanelFiles, StudioSidePanelFileIcon } from "./files"
export {
  StudioMarkdownFilePreview,
  StudioHtmlFilePreview,
  StudioSidePanelPreview,
  StudioTextFilePreview,
} from "./previews"
export { StudioReviewFileSection, StudioReviewPanel } from "./review"
export { StudioRightPanelSideChat } from "./side-chat"
export { StudioWorkspaceTabIcon, StudioWorkspaceTabStrip } from "./tab-strip"
export { StudioSideTerminal } from "./terminal"
export { getStudioRightPanelLabels }
export type { StudioRightPanelLabels }
