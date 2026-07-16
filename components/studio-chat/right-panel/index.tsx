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

import {
  TabbedSidePanel,
  useSidePanelController,
  type SidePanelController,
  type SidePanelTab,
} from "@/components/desktop-shell/side-panel"
import { useI18n } from "@/components/i18n-provider"
import { StudioAgentGlyph } from "@/components/studio-agent-glyph"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { StudioTerminalSurface } from "@/components/studio-terminal-panel"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import {
  STUDIO_OPEN_REVIEW_PANEL_EVENT,
  type StudioOpenReviewPanelDetail,
  type StudioReviewFileChange,
} from "@/lib/studio-review-panel"
import {
  createStudioWorkspaceReviewDetail,
  loadStudioWorkspaceReviewData,
} from "@/lib/studio-review-data"
import type { StudioWorkspace } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { getBrowserTabTitle } from "../browser-utils"
import { resolveSidePanelRootDirectory } from "../side-panel-utils"
import { openStudioLocalFilePath } from "../workspace-transport"
import {
  createSidePanelEntryFromPath,
  resolveStudioMarkdownOpenTarget,
} from "../markdown-targets"
import {
  createWorkspaceBrowserTab,
  createWorkspaceFileTab,
  createWorkspaceReviewTab,
  createWorkspaceSideChatTab,
  createWorkspaceSubagentTab,
  createWorkspaceTerminalTab,
  findReusableWorkspaceFilePreviewTab,
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
  StudioSubagentPanelRequest,
  StudioSubagentPanelItem,
  StudioWorkspaceSubagentTab,
  StudioWorkspaceTab,
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
import { StudioRightPanelSubagentChat } from "./subagent-chat"
import { RIGHT_PANEL_WIDTH_STORAGE_KEY } from "../constants"

const FILES_TAB_ID = "studio-right-panel:files"
const REVIEW_TAB_ID = "studio-right-panel:review"
const SIDE_CHAT_TAB_ID = "studio-right-panel:side-chat"
const BROWSER_SETTINGS_TAB_ID = "studio-right-panel:browser-settings"

export function StudioRightPanel({
  open,
  focused,
  sessionId,
  workspace,
  mode,
  subagents,
  getSessionFileChanges,
  subagentPanelRequest,
  onOpenChange,
  onFocusedChange,
  onModeChange,
}: {
  open: boolean
  focused: boolean
  sessionId: string
  workspace: StudioWorkspace
  mode: StudioRightPanelMode
  subagents: StudioSubagentPanelItem[]
  getSessionFileChanges?: () => StudioReviewFileChange[]
  subagentPanelRequest?: StudioSubagentPanelRequest | null
  onOpenChange: (open: boolean) => void
  onFocusedChange: (focused: boolean) => void
  onModeChange: (mode: StudioRightPanelMode) => void
}) {
  const { locale, t } = useI18n()
  const labels = React.useMemo(
    () => getStudioRightPanelLabels(locale),
    [locale]
  )
  const controller = useSidePanelController()
  const controllerRef = React.useRef(controller)
  const [workspaceTabs, setWorkspaceTabs] = React.useState<
    StudioWorkspaceTab[]
  >([])
  const defaultFilesDirectory = workspace.rootPath
  const workspaceTabsRef = React.useRef(workspaceTabs)

  React.useEffect(() => {
    workspaceTabsRef.current = workspaceTabs
  }, [workspaceTabs])
  const [nextTerminalSequence, setNextTerminalSequence] = React.useState(1)
  const [reviewLoading, setReviewLoading] = React.useState(false)
  const pendingActivateTabIdRef = React.useRef<string | null>(null)
  const reconciledModeRef = React.useRef<StudioRightPanelMode | null>(null)
  const lastSubagentPanelRequestIdRef = React.useRef<string | null>(null)
  const previousSessionIdRef = React.useRef(sessionId)
  const previousWorkspaceIdRef = React.useRef(workspace.id)
  const activeTabId = controller.activeTabId ?? ""
  const fileTabs = React.useMemo(
    () =>
      workspaceTabs.filter(
        (tab): tab is StudioWorkspaceFileTab => tab.kind === "files"
      ),
    [workspaceTabs]
  )
  const hasReviewTab = workspaceTabs.some((tab) => tab.kind === "review")
  const displayWorkspaceTabs = React.useMemo(() => {
    const latestByTaskId = new Map(
      subagents.map((item) => [item.subagent.taskId, item])
    )

    return workspaceTabs.map((tab) => {
      if (tab.kind !== "subagent") {
        return tab
      }

      const latest = latestByTaskId.get(tab.subagent.taskId)

      return latest
        ? {
            ...tab,
            title: latest.subagent.name,
            subagent: latest.subagent,
            environment: latest.environment,
          }
        : tab
    })
  }, [subagents, workspaceTabs])

  React.useEffect(() => {
    controllerRef.current = controller
  }, [controller])

  React.useEffect(() => {
    if (previousSessionIdRef.current === sessionId) {
      return
    }

    previousSessionIdRef.current = sessionId
    pendingActivateTabIdRef.current = null
    lastSubagentPanelRequestIdRef.current = null
    const sessionScopedTabs = workspaceTabs.filter(
      (tab) => tab.kind === "review" || tab.kind === "subagent"
    )

    for (const tab of sessionScopedTabs) {
      controllerRef.current.closeTab(tab.id)
    }
    setWorkspaceTabs((current) =>
      current.filter(
        (tab) => tab.kind !== "review" && tab.kind !== "subagent"
      )
    )

    if (mode === "review") {
      onModeChange("launcher")
    }
  }, [mode, onModeChange, sessionId, workspaceTabs])

  React.useEffect(() => {
    if (previousWorkspaceIdRef.current === workspace.id) {
      return
    }

    previousWorkspaceIdRef.current = workspace.id
    pendingActivateTabIdRef.current = null
    const workspaceScopedTabs = workspaceTabs.filter(
      (tab) =>
        tab.kind === "files" ||
        tab.kind === "terminal" ||
        tab.kind === "review" ||
        tab.kind === "subagent"
    )

    for (const tab of workspaceScopedTabs) {
      controllerRef.current.closeTab(tab.id)
    }
    setWorkspaceTabs((current) =>
      current.filter(
        (tab) => tab.kind === "browser" || tab.kind === "side-chat"
      )
    )

    if (["files", "terminal", "review", "subagent"].includes(mode)) {
      onModeChange("launcher")
    }
  }, [mode, onModeChange, workspace.id, workspaceTabs])

  const openOrReplaceWorkspaceTab = React.useCallback(
    (nextTab: StudioWorkspaceTab, options: { activate?: boolean } = {}) => {
      if (options.activate !== false) {
        pendingActivateTabIdRef.current = nextTab.id
        onModeChange(getWorkspaceTabMode(nextTab))
      }

      setWorkspaceTabs((current) => {
        const existingIndex = current.findIndex((tab) => tab.id === nextTab.id)

        if (existingIndex === -1) {
          return [...current, nextTab]
        }

        return current.map((tab) => (tab.id === nextTab.id ? nextTab : tab))
      })
      onOpenChange(true)
      controllerRef.current.openPanel()
    },
    [onModeChange, onOpenChange]
  )

  const activateWorkspaceTab = React.useCallback(
    (tab: StudioWorkspaceTab) => {
      controllerRef.current.activateTab(tab.id)
      controllerRef.current.openPanel()
      onModeChange(getWorkspaceTabMode(tab))
      onOpenChange(true)
    },
    [onModeChange, onOpenChange]
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

  const handleCloseWorkspaceTabState = React.useCallback(
    (tabId: string) => {
      // Read through the ref: this runs from tab onClose callbacks whose
      // closures may predate the latest workspaceTabs state (the side-panel
      // store keeps the handler from when the tab was opened).
      const current = workspaceTabsRef.current
      const closedTab = current.find((tab) => tab.id === tabId)
      const remaining = current.filter((tab) => tab.id !== tabId)

      setWorkspaceTabs((tabs) => tabs.filter((tab) => tab.id !== tabId))

      // Without this fallback the mode-reconcile effect would immediately
      // recreate the tab the user just closed.
      if (
        closedTab &&
        getWorkspaceTabMode(closedTab) === mode &&
        !remaining.some((tab) => getWorkspaceTabMode(tab) === mode)
      ) {
        onModeChange("launcher")
      }
    },
    [mode, onModeChange]
  )

  const handleResolvedTerminalCwd = React.useCallback(
    (tabId: string, resolvedCwd: string) => {
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
    },
    [handleUpdateWorkspaceTab, t.studioTerminalTab]
  )

  const handleOpenFileTab = React.useCallback(
    (
      entry: AstraFlowSidePanelDirectoryEntry,
      focusLine?: number | null,
      focusColumn?: number | null,
      focusEndLine?: number | null
    ) => {
      const nextFocusLine = focusLine ?? null
      const nextFocusColumn = focusColumn ?? null
      const nextFocusEndLine = focusEndLine ?? null
      const existingTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceFileTab =>
          tab.kind === "files" && tab.entry?.path === entry.path
      )

      if (existingTab) {
        const nextTab =
          existingTab.focusLine === nextFocusLine &&
          existingTab.focusColumn === nextFocusColumn &&
          existingTab.focusEndLine === nextFocusEndLine
            ? existingTab
            : {
                ...existingTab,
                focusLine: nextFocusLine,
                focusColumn: nextFocusColumn,
                focusEndLine: nextFocusEndLine,
              }
        openOrReplaceWorkspaceTab(nextTab)
        return
      }

      const reusableEmptyFileTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceFileTab =>
          tab.kind === "files" && tab.entry === null
      )
      const previewTabIds = new Set(
        controllerRef.current.tabs
          .filter((tab) => tab.preview)
          .map((tab) => tab.id)
      )
      const reusablePreviewFileTab = findReusableWorkspaceFilePreviewTab(
        workspaceTabs,
        previewTabIds
      )
      const reusableFileTab = reusableEmptyFileTab ?? reusablePreviewFileTab
      const nextTab: StudioWorkspaceFileTab = reusableFileTab
        ? {
            ...reusableFileTab,
            title: entry.name,
            entry,
            focusLine: nextFocusLine,
            focusColumn: nextFocusColumn,
            focusEndLine: nextFocusEndLine,
          }
        : createWorkspaceFileTab(
            entry,
            labels.files,
            nextFocusLine,
            nextFocusColumn,
            nextFocusEndLine
          )

      openOrReplaceWorkspaceTab(nextTab)
    },
    [labels.files, openOrReplaceWorkspaceTab, workspaceTabs]
  )

  const handleOpenSubagentTab = React.useCallback(
    ({ subagent, environment }: StudioSubagentPanelItem) => {
      const existingTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceSubagentTab =>
          tab.kind === "subagent" && tab.subagent.taskId === subagent.taskId
      )
      const nextTab = existingTab
        ? {
            ...existingTab,
            title: subagent.name,
            subagent,
            environment,
          }
        : createWorkspaceSubagentTab({
            title: subagent.name,
            subagent,
            environment,
          })

      openOrReplaceWorkspaceTab(nextTab)
    },
    [openOrReplaceWorkspaceTab, workspaceTabs]
  )

  React.useEffect(() => {
    if (!subagentPanelRequest) {
      return
    }

    if (
      lastSubagentPanelRequestIdRef.current === subagentPanelRequest.requestId
    ) {
      return
    }

    lastSubagentPanelRequestIdRef.current = subagentPanelRequest.requestId
    handleOpenSubagentTab(subagentPanelRequest)
  }, [handleOpenSubagentTab, subagentPanelRequest])

  const handleOpenProjectReview = React.useCallback(async () => {
    if (reviewLoading) {
      return
    }

    setReviewLoading(true)

    try {
      const data = await loadStudioWorkspaceReviewData(
        workspace,
        labels.envLoadChangesFailed
      )
      const detail: StudioOpenReviewPanelDetail = data.gitAvailable
        ? createStudioWorkspaceReviewDetail({
            ...data,
            scopeLabel: labels.envUncommittedChanges,
          })
        : {
            scopeLabel: labels.envSessionChanges,
            files: getSessionFileChanges?.() ?? [],
            truncated: false,
            git: null,
          }
      const existingReviewTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceReviewTab => tab.kind === "review"
      )
      const nextTab: StudioWorkspaceReviewTab = existingReviewTab
        ? { ...existingReviewTab, detail }
        : {
            ...createWorkspaceReviewTab(labels.review, detail),
            id: REVIEW_TAB_ID,
          }

      openOrReplaceWorkspaceTab(nextTab)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : labels.envLoadChangesFailed
      )
      onModeChange("launcher")
    } finally {
      setReviewLoading(false)
    }
  }, [
    getSessionFileChanges,
    labels.envLoadChangesFailed,
    labels.envSessionChanges,
    labels.envUncommittedChanges,
    labels.review,
    onModeChange,
    openOrReplaceWorkspaceTab,
    reviewLoading,
    workspace,
    workspaceTabs,
  ])

  const openBrowserSettingsTab = React.useCallback(() => {
    controllerRef.current.openTab(
      {
        id: BROWSER_SETTINGS_TAB_ID,
        title: labels.browserSettings,
        icon: <Globe aria-hidden className="size-4" />,
        content: (
          <StudioRightPanelBrowserSettings
            labels={labels}
            onModeChange={(nextMode) => {
              if (nextMode === "browser") {
                const existingBrowserTab = workspaceTabs.find(
                  (tab): tab is StudioWorkspaceBrowserTab =>
                    tab.kind === "browser"
                )

                openOrReplaceWorkspaceTab(
                  existingBrowserTab ?? createWorkspaceBrowserTab()
                )
                return
              }

              onModeChange(nextMode)
            }}
          />
        ),
        closable: true,
        onActivate: () => onModeChange("browser-settings"),
        onClose: () => onModeChange("launcher"),
      },
      { activate: true }
    )
    onModeChange("browser-settings")
    onOpenChange(true)
  }, [
    labels,
    onModeChange,
    onOpenChange,
    openOrReplaceWorkspaceTab,
    workspaceTabs,
  ])

  const handleAddWorkspaceMode = React.useCallback(
    (nextMode: StudioRightPanelMode) => {
      if (nextMode === "launcher") {
        onModeChange("launcher")
        return
      }

      if (nextMode === "browser-settings") {
        openBrowserSettingsTab()
        return
      }

      if (nextMode === "subagent") {
        onModeChange("launcher")
        return
      }

      if (nextMode === "files") {
        const existingFileTab = workspaceTabs.find(
          (tab): tab is StudioWorkspaceFileTab => tab.kind === "files"
        )
        const nextTab: StudioWorkspaceFileTab =
          existingFileTab ??
          ({
            ...createWorkspaceFileTab(null, labels.files),
            id: FILES_TAB_ID,
          } satisfies StudioWorkspaceFileTab)

        openOrReplaceWorkspaceTab(nextTab)
        return
      }

      if (nextMode === "browser") {
        const nextTab = createWorkspaceBrowserTab()

        openOrReplaceWorkspaceTab(nextTab)
        return
      }

      if (nextMode === "terminal") {
        const nextTab = createWorkspaceTerminalTab(
          workspace,
          t.studioTerminalTab,
          nextTerminalSequence
        )

        setNextTerminalSequence((current) => current + 1)
        openOrReplaceWorkspaceTab(nextTab)
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
      const nextTab: StudioWorkspaceSideChatTab =
        existingSideChatTab ??
        ({
          ...createWorkspaceSideChatTab(labels.sideChat),
          id: SIDE_CHAT_TAB_ID,
        } satisfies StudioWorkspaceSideChatTab)

      openOrReplaceWorkspaceTab(nextTab)
    },
    [
      activateWorkspaceTab,
      handleOpenProjectReview,
      labels.files,
      labels.sideChat,
      nextTerminalSequence,
      onModeChange,
      openBrowserSettingsTab,
      openOrReplaceWorkspaceTab,
      t.studioTerminalTab,
      workspace,
      workspaceTabs,
    ]
  )

  const handleOpenMarkdownTarget = React.useCallback(
    async (
      href: string,
      line?: number | null,
      column?: number | null,
      endLine?: number | null
    ) => {
      const target = resolveStudioMarkdownOpenTarget({
        href,
        sessionId,
        workspace,
        line,
        column,
        endLine,
      })

      if (target.kind === "workspace_file") {
        handleOpenFileTab(
          createSidePanelEntryFromPath(target.path),
          target.line,
          target.column,
          target.endLine
        )
        return
      }

      if (target.kind === "external_file") {
        const opened = await openStudioLocalFilePath(target.path).catch(
          () => false
        )

        if (!opened) {
          toast.error(labels.fileTargetUnavailable)
        }
        return
      }

      if (target.kind === "unavailable") {
        toast.error(labels.fileTargetUnavailable)
        return
      }

      const nextTab: StudioWorkspaceBrowserTab = {
        ...createWorkspaceBrowserTab(),
        address: target.url,
        title: getBrowserTabTitle(target.url),
        url: target.url,
      }

      // Add and activate the fully configured tab in one state transition.
      // Opening the panel before the tab exists briefly shows the launcher.
      openOrReplaceWorkspaceTab(nextTab)
    },
    [
      handleOpenFileTab,
      labels.fileTargetUnavailable,
      openOrReplaceWorkspaceTab,
      sessionId,
      workspace,
    ]
  )

  const handleOpenReviewPanel = React.useCallback(
    (detail: StudioOpenReviewPanelDetail) => {
      const existingReviewTab = workspaceTabs.find(
        (tab): tab is StudioWorkspaceReviewTab => tab.kind === "review"
      )
      const nextTab: StudioWorkspaceReviewTab = existingReviewTab
        ? { ...existingReviewTab, detail }
        : {
            ...createWorkspaceReviewTab(labels.review, detail),
            id: REVIEW_TAB_ID,
          }

      openOrReplaceWorkspaceTab(nextTab)
    },
    [labels.review, openOrReplaceWorkspaceTab, workspaceTabs]
  )

  React.useEffect(() => {
    function handleEvent(event: Event) {
      const detail = (event as CustomEvent<StudioOpenMarkdownTargetDetail>)
        .detail

      if (detail?.href) {
        void handleOpenMarkdownTarget(
          detail.href,
          detail.line,
          detail.column,
          detail.endLine
        )
      }
    }

    window.addEventListener(STUDIO_OPEN_MARKDOWN_TARGET_EVENT, handleEvent)

    return () =>
      window.removeEventListener(STUDIO_OPEN_MARKDOWN_TARGET_EVENT, handleEvent)
  }, [handleOpenMarkdownTarget])

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
      if (event.key !== "Escape") {
        return
      }

      if (focused) {
        onFocusedChange(false)
        return
      }

      controllerRef.current.closePanel()
      onOpenChange(false)
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [focused, onFocusedChange, onOpenChange, open])

  React.useEffect(() => {
    if (open && !controller.isOpen) {
      controller.openPanel()
    } else if (!open && controller.isOpen) {
      controller.closePanel()
    }
  }, [controller, controller.isOpen, open])

  React.useEffect(() => {
    if (!open) {
      reconciledModeRef.current = null
      return
    }

    if (mode === "launcher") {
      reconciledModeRef.current = mode
      return
    }

    // A tab creation is still being flushed into the controller; the
    // controller's activeTabId lags one commit behind, so acting now would
    // create a duplicate tab.
    if (pendingActivateTabIdRef.current) {
      reconciledModeRef.current = mode
      return
    }

    const activeTab = workspaceTabs.find((tab) => tab.id === activeTabId)

    if (activeTab && getWorkspaceTabMode(activeTab) === mode) {
      reconciledModeRef.current = mode
      return
    }

    // Only align tabs when the mode itself changed (launcher buttons,
    // titlebar shortcuts). Tab-state churn — creating a tab, replacing a
    // preview tab, closing — keeps activeTabId a commit behind
    // workspaceTabs; re-activating the first same-mode tab during that
    // window would yank the user back to it.
    if (reconciledModeRef.current === mode) {
      return
    }

    reconciledModeRef.current = mode

    const existingTab = workspaceTabs.find(
      (tab) => getWorkspaceTabMode(tab) === mode
    )

    // Re-check the pending ref inside the microtask: StrictMode re-runs
    // this effect and would otherwise queue the creation twice.
    queueMicrotask(() => {
      if (pendingActivateTabIdRef.current) {
        return
      }

      if (existingTab) {
        activateWorkspaceTab(existingTab)
      } else {
        handleAddWorkspaceMode(mode)
      }
    })
  }, [
    activateWorkspaceTab,
    activeTabId,
    handleAddWorkspaceMode,
    mode,
    open,
    workspaceTabs,
  ])

  useCloseTabCommand(
    () => {
      if (controllerRef.current.closeActiveTab()) {
        if (controllerRef.current.tabs.length <= 1) {
          onModeChange("launcher")
          onOpenChange(false)
        }
      }
    },
    open && controller.tabs.length > 0
  )

  const createWorkspaceTabMenuItems = React.useCallback(
    (tabId: string): SidePanelTab["menuItems"] => [
      {
        id: "close-tab",
        label: labels.closePanel,
        onSelect: () => controllerRef.current.closeTab(tabId),
      },
      {
        id: "close-other-tabs",
        label: labels.closeOtherTabs,
        onSelect: () => controllerRef.current.closeOtherTabs(tabId),
        disabled: controllerRef.current.tabs.length <= 1,
      },
      {
        id: "close-tabs-to-right",
        label: labels.closeTabsToRight,
        onSelect: () => controllerRef.current.closeTabsToRight(tabId),
      },
    ],
    [labels.closePanel, labels.closeOtherTabs, labels.closeTabsToRight]
  )

  React.useEffect(() => {
    const panel = controllerRef.current
    const existingIds = new Set(panel.tabs.map((tab) => tab.id))
    const existingTabsById = new Map(panel.tabs.map((tab) => [tab.id, tab]))

    for (const tab of displayWorkspaceTabs) {
      const active = tab.id === activeTabId
      const existingPanelTab = existingTabsById.get(tab.id)
      const menuItems = createWorkspaceTabMenuItems(tab.id)
      const common = {
        id: tab.id,
        title: getWorkspaceTabTitle(tab),
        closable: true,
        menuItems,
        onActivate: () => onModeChange(getWorkspaceTabMode(tab)),
        onClose: () => handleCloseWorkspaceTabState(tab.id),
      } satisfies Partial<SidePanelTab>
      let nextTab: SidePanelTab

      if (tab.kind === "files") {
        nextTab = {
          ...common,
          id: tab.id,
          title: getWorkspaceTabTitle(tab),
          icon: tab.entry ? (
            <StudioFileTypeIcon
              path={tab.entry.path}
              size="small"
              className="size-4 rounded-[4px] text-[8px]"
            />
          ) : (
            <Folder aria-hidden className="size-4" />
          ),
          preview:
            tab.entry !== null &&
            tab.id !== FILES_TAB_ID &&
            existingPanelTab?.preview !== false,
          content: (
            <StudioRightPanelFiles
              activeFileTabId={tab.id}
              workspace={workspace}
              labels={labels}
              defaultDirectory={resolveSidePanelRootDirectory(
                tab.entry?.path,
                defaultFilesDirectory
              )}
              fileTabs={fileTabs}
              open={open && active}
              onOpenFile={handleOpenFileTab}
            />
          ),
        }
      } else if (tab.kind === "browser") {
        nextTab = {
          ...common,
          id: tab.id,
          title: getWorkspaceTabTitle(tab),
          icon: <Globe aria-hidden className="size-4" />,
          content: (
            <StudioRightPanelBrowser
              labels={labels}
              tab={tab}
              onModeChange={handleAddWorkspaceMode}
              onTabChange={(updater) =>
                handleUpdateWorkspaceTab(tab.id, (currentTab) =>
                  currentTab.kind === "browser"
                    ? updater(currentTab)
                    : currentTab
                )
              }
            />
          ),
        }
      } else if (tab.kind === "terminal") {
        nextTab = {
          ...common,
          id: tab.id,
          title: getWorkspaceTabTitle(tab),
          icon: <SquareTerminal aria-hidden className="size-4" />,
          content: (
            <div
              aria-label={labels.terminal}
              className="relative h-full min-h-0 bg-background"
            >
              <StudioTerminalSurface
                active={open && active}
                cwd={tab.cwd}
                fitEnabled={open && active}
                workspace={workspace}
                onResolvedCwd={(resolvedCwd) =>
                  handleResolvedTerminalCwd(tab.id, resolvedCwd)
                }
              />
            </div>
          ),
        }
      } else if (tab.kind === "subagent") {
        nextTab = {
          ...common,
          id: tab.id,
          title: getWorkspaceTabTitle(tab),
          icon: (
            <StudioAgentGlyph
              identity={tab.subagent.taskId || tab.subagent.name}
              status={tab.subagent.status}
              className="size-4"
            />
          ),
          content: (
            <StudioRightPanelSubagentChat
              sessionId={sessionId}
              subagent={tab.subagent}
              environment={tab.environment}
              workspace={workspace}
            />
          ),
        }
      } else if (tab.kind === "review") {
        nextTab = {
          ...common,
          id: tab.id,
          title: getWorkspaceTabTitle(tab),
          icon: <GitCompareArrows aria-hidden className="size-4" />,
          content: (
            <StudioReviewPanel
              labels={labels}
              detail={tab.detail}
              onOpenFile={handleOpenMarkdownTarget}
            />
          ),
        }
      } else {
        nextTab = {
          ...common,
          id: tab.id,
          title: getWorkspaceTabTitle(tab),
          icon: <MessageSquare aria-hidden className="size-4" />,
          content: (
            <StudioRightPanelSideChat labels={labels} sessionId={sessionId} />
          ),
        }
      }

      if (existingIds.has(tab.id)) {
        panel.updateTab(tab.id, nextTab)
      } else {
        panel.openTab(nextTab, {
          activate: pendingActivateTabIdRef.current === tab.id,
        })
      }
    }

    const pendingActivateTabId = pendingActivateTabIdRef.current

    if (
      pendingActivateTabId &&
      displayWorkspaceTabs.some((tab) => tab.id === pendingActivateTabId)
    ) {
      panel.activateTab(pendingActivateTabId)
      panel.openPanel()
      pendingActivateTabIdRef.current = null
    }
  }, [
    activeTabId,
    createWorkspaceTabMenuItems,
    defaultFilesDirectory,
    displayWorkspaceTabs,
    fileTabs,
    handleAddWorkspaceMode,
    handleOpenFileTab,
    handleOpenMarkdownTarget,
    handleResolvedTerminalCwd,
    handleUpdateWorkspaceTab,
    handleCloseWorkspaceTabState,
    labels,
    onModeChange,
    open,
    sessionId,
    workspace,
  ])

  const controlledController = React.useMemo<SidePanelController>(() => {
    const closePanel = () => {
      controller.closePanel()
      onFocusedChange(false)
      onModeChange("launcher")
      onOpenChange(false)
    }

    return {
      ...controller,
      closePanel,
      togglePanel: (nextOpen?: boolean) => {
        const targetOpen = nextOpen ?? !controller.isOpen
        controller.togglePanel(targetOpen)
        onOpenChange(targetOpen)

        if (!targetOpen) {
          onFocusedChange(false)
          onModeChange("launcher")
        }
      },
      closeTab: (tabId: string) => {
        const closingLast = controller.tabs.length <= 1
        controller.closeTab(tabId)

        if (closingLast) {
          closePanel()
        }
      },
      closeActiveTab: () => {
        const closingLast = controller.tabs.length <= 1
        const closed = controller.closeActiveTab()

        if (closed && closingLast) {
          closePanel()
        }

        return closed
      },
    }
  }, [controller, onFocusedChange, onModeChange, onOpenChange])

  const emptyState = (
    <StudioRightPanelLauncher
      canReview
      labels={labels}
      reviewLoading={reviewLoading}
      onModeChange={handleAddWorkspaceMode}
    />
  )
  return (
    <TabbedSidePanel
      className={cn(focused && "z-40")}
      controller={controlledController}
      expanded={focused}
      onExpandedChange={onFocusedChange}
      storageKey={RIGHT_PANEL_WIDTH_STORAGE_KEY}
      testId="studio-right-panel"
      afterTabsSticky={
        <StudioSidePanelAddMenu
          canReview={!hasReviewTab}
          labels={labels}
          reviewLoading={reviewLoading}
          onModeChange={handleAddWorkspaceMode}
        />
      }
      emptyState={emptyState}
    />
  )
}

function getWorkspaceTabTitle(tab: StudioWorkspaceTab) {
  if (tab.kind === "files") {
    return tab.entry?.name ?? tab.title
  }

  return tab.title
}

function StudioSidePanelAddMenu({
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
  const items = [
    {
      mode: "terminal" as const,
      label: labels.terminal,
      icon: SquareTerminal,
    },
    {
      mode: "browser" as const,
      label: labels.browser,
      icon: Globe,
    },
    {
      mode: "files" as const,
      label: labels.files,
      icon: Folder,
    },
    {
      mode: "side-chat" as const,
      label: labels.sideChat,
      icon: MessageSquare,
    },
  ]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={labels.add}
          title={labels.add}
          className="size-8 rounded-lg"
        >
          <RiAddLine aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        {items.map((item) => {
          const Icon = item.icon

          return (
            <DropdownMenuItem
              key={item.mode}
              onSelect={() => onModeChange(item.mode)}
            >
              <Icon aria-hidden className="size-4 text-muted-foreground" />
              <span>{item.label}</span>
            </DropdownMenuItem>
          )
        })}
        {canReview ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={reviewLoading}
              onSelect={() => onModeChange("review")}
            >
              {reviewLoading ? (
                <RiLoader4Line
                  aria-hidden
                  className="size-4 animate-spin text-muted-foreground"
                />
              ) : (
                <GitCompareArrows
                  aria-hidden
                  className="size-4 text-muted-foreground"
                />
              )}
              <span>{labels.review}</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
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
      mode: "terminal" as const,
      label: labels.terminal,
      shortcut: "",
      icon: SquareTerminal,
    },
    {
      mode: "browser" as const,
      label: labels.browser,
      shortcut: "⌘T",
      icon: Globe,
    },
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
  ]
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
export { StudioSideTerminal } from "./terminal"
export { getStudioRightPanelLabels }
export type { StudioRightPanelLabels }
