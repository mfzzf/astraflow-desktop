"use client"

import * as React from "react"
import type {
  DidFailLoadEvent,
  DidNavigateEvent,
  DidNavigateInPageEvent,
  FoundInPageEvent,
  PageTitleUpdatedEvent,
  WebviewTag,
} from "electron"
import {
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiArrowUpSLine,
  RiCloseLine,
  RiRefreshLine,
} from "@remixicon/react"
import { Globe, MoreVertical, Search } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import { getBrowserTabTitle, normalizeBrowserUrl } from "../browser-utils"
import { readStoredBoolean } from "../panel-storage"
import type { StudioRightPanelMode, StudioWorkspaceBrowserTab } from "../types"
import { getWorkspaceBrowserRevisionKey } from "../workspace-tabs"
import type { StudioRightPanelLabels } from "./labels"

const studioBrowserTitleCache = new Map<string, string>()
const studioBrowserTitleRequests = new Map<string, Promise<string>>()
const SIDE_PANEL_BROWSER_PARTITION = "persist:astraflow-browser"
const BROWSER_ENABLED_STORAGE_KEY = "astraflow.studio.browser-enabled"
const LOCAL_URL_TARGET_STORAGE_KEY = "astraflow.studio.local-url-target"
const subscribeToClientReady = () => () => undefined
const getClientReadySnapshot = () => true
const getServerReadySnapshot = () => false
const browserSettingListeners = new Set<() => void>()

type LocalUrlTarget = "astraflow" | "system"
type DeviceViewport = "responsive" | "mobile" | "tablet"

function subscribeBrowserSettings(listener: () => void) {
  browserSettingListeners.add(listener)

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === BROWSER_ENABLED_STORAGE_KEY ||
      event.key === LOCAL_URL_TARGET_STORAGE_KEY
    ) {
      listener()
    }
  }

  window.addEventListener("storage", handleStorage)

  return () => {
    browserSettingListeners.delete(listener)
    window.removeEventListener("storage", handleStorage)
  }
}

function notifyBrowserSettingsChanged() {
  browserSettingListeners.forEach((listener) => listener())
}

function getBrowserEnabled() {
  return readStoredBoolean(BROWSER_ENABLED_STORAGE_KEY, true)
}

function setBrowserEnabled(enabled: boolean) {
  window.localStorage.setItem(BROWSER_ENABLED_STORAGE_KEY, String(enabled))
  notifyBrowserSettingsChanged()
}

function getLocalUrlTarget(): LocalUrlTarget {
  if (typeof window === "undefined") {
    return "astraflow"
  }

  return window.localStorage.getItem(LOCAL_URL_TARGET_STORAGE_KEY) === "system"
    ? "system"
    : "astraflow"
}

function setLocalUrlTarget(target: LocalUrlTarget) {
  window.localStorage.setItem(LOCAL_URL_TARGET_STORAGE_KEY, target)
  notifyBrowserSettingsChanged()
}

function useBrowserEnabled() {
  return React.useSyncExternalStore(
    subscribeBrowserSettings,
    getBrowserEnabled,
    () => true
  )
}

function useLocalUrlTarget() {
  return React.useSyncExternalStore(
    subscribeBrowserSettings,
    getLocalUrlTarget,
    () => "astraflow"
  )
}

function useClientReady() {
  return React.useSyncExternalStore(
    subscribeToClientReady,
    getClientReadySnapshot,
    getServerReadySnapshot
  )
}

function isElectronWebviewUrl(url: string) {
  try {
    const protocol = new URL(url).protocol
    return protocol === "http:" || protocol === "https:"
  } catch {
    return false
  }
}

function isLocalBrowserUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase()

    return (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.startsWith("127.")
    )
  } catch {
    return false
  }
}

function openInSystemBrowser(url: string) {
  if (window.astraflowDesktop?.openExternal) {
    return window.astraflowDesktop.openExternal(url)
  }

  return Promise.resolve(
    Boolean(window.open(url, "_blank", "noopener,noreferrer"))
  )
}

export function fetchStudioBrowserTitle(url: string) {
  const cachedTitle = studioBrowserTitleCache.get(url)
  if (cachedTitle !== undefined) {
    return Promise.resolve(cachedTitle)
  }

  const existingRequest = studioBrowserTitleRequests.get(url)
  if (existingRequest) {
    return existingRequest
  }

  const request = fetch(
    `/api/studio/browser-title?url=${encodeURIComponent(url)}`
  )
    .then((response) => (response.ok ? response.json() : null))
    .then((payload: { ok?: boolean; title?: string } | null) => {
      const title = payload?.ok ? payload.title?.trim() || "" : ""
      studioBrowserTitleCache.set(url, title)
      return title
    })
    .catch(() => {
      studioBrowserTitleCache.set(url, "")
      return ""
    })
    .finally(() => {
      studioBrowserTitleRequests.delete(url)
    })

  studioBrowserTitleRequests.set(url, request)
  return request
}

export function StudioRightPanelBrowser({
  labels,
  tab,
  onModeChange,
  onTabChange,
}: {
  labels: StudioRightPanelLabels
  onModeChange: (mode: StudioRightPanelMode) => void
  tab: StudioWorkspaceBrowserTab
  onTabChange: (
    updater: (tab: StudioWorkspaceBrowserTab) => StudioWorkspaceBrowserTab
  ) => void
}) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [zoom, setZoom] = React.useState(100)
  const [loading, setLoading] = React.useState(false)
  const [canGoBack, setCanGoBack] = React.useState(false)
  const [canGoForward, setCanGoForward] = React.useState(false)
  const [findOpen, setFindOpen] = React.useState(false)
  const [findQuery, setFindQuery] = React.useState("")
  const [findResult, setFindResult] = React.useState({
    activeMatchOrdinal: 0,
    matches: 0,
  })
  const [deviceToolbarOpen, setDeviceToolbarOpen] = React.useState(false)
  const [deviceViewport, setDeviceViewport] =
    React.useState<DeviceViewport>("responsive")
  const webviewRef = React.useRef<WebviewTag | null>(null)
  const findInputRef = React.useRef<HTMLInputElement | null>(null)
  const externalizedLocalUrlRef = React.useRef("")
  const browserEnabled = useBrowserEnabled()
  const localUrlTarget = useLocalUrlTarget()
  const clientReady = useClientReady()
  const useElectronWebview =
    browserEnabled &&
    clientReady &&
    Boolean(window.astraflowDesktop) &&
    isElectronWebviewUrl(tab.url)
  const activeTabUrl = tab.url
  const deviceViewportWidth =
    deviceViewport === "mobile"
      ? 390
      : deviceViewport === "tablet"
        ? 768
        : null

  const updateActiveTab = React.useCallback(
    (
      updater: (tab: StudioWorkspaceBrowserTab) => StudioWorkspaceBrowserTab
    ) => {
      onTabChange(updater)
    },
    [onTabChange]
  )
  const onTabChangeRef = React.useRef(onTabChange)

  React.useEffect(() => {
    onTabChangeRef.current = onTabChange
  }, [onTabChange])

  React.useEffect(() => {
    if (!useElectronWebview) {
      return
    }

    const webview = webviewRef.current

    if (!webview) {
      return
    }

    const attachedWebview: WebviewTag = webview

    function updateNavigationState() {
      try {
        setCanGoBack(attachedWebview.canGoBack())
        setCanGoForward(attachedWebview.canGoForward())
      } catch {
        setCanGoBack(false)
        setCanGoForward(false)
      }
    }

    function applyZoom() {
      try {
        attachedWebview.setZoomFactor(zoom / 100)
      } catch {
        // The guest may still be attaching. dom-ready retries the zoom.
      }
    }

    function commitNavigation(url: string) {
      if (!url || url === "about:blank") {
        return
      }

      onTabChangeRef.current((currentTab) =>
        currentTab.url === url && currentTab.address === url
          ? currentTab
          : { ...currentTab, address: url, url }
      )
      updateNavigationState()
    }

    const handleDidNavigate = (event: DidNavigateEvent) => {
      commitNavigation(event.url)
    }
    const handleDidNavigateInPage = (event: DidNavigateInPageEvent) => {
      if (event.isMainFrame) {
        commitNavigation(event.url)
      }
    }
    const handlePageTitleUpdated = (event: PageTitleUpdatedEvent) => {
      const title = event.title.trim()

      if (!title) {
        return
      }

      onTabChangeRef.current((currentTab) =>
        currentTab.title === title ? currentTab : { ...currentTab, title }
      )
    }
    const handleFoundInPage = (event: FoundInPageEvent) => {
      setFindResult({
        activeMatchOrdinal: event.result.activeMatchOrdinal,
        matches: event.result.matches,
      })
    }
    const handleDidFailLoad = (event: DidFailLoadEvent) => {
      if (event.isMainFrame && event.errorCode !== -3) {
        setLoading(false)
      }
    }
    const handleDidStartLoading = () => setLoading(true)
    const handleDidStopLoading = () => {
      setLoading(false)
      updateNavigationState()
    }
    const handleDomReady = () => {
      applyZoom()
      updateNavigationState()
    }

    attachedWebview.addEventListener("did-navigate", handleDidNavigate)
    attachedWebview.addEventListener(
      "did-navigate-in-page",
      handleDidNavigateInPage
    )
    attachedWebview.addEventListener(
      "page-title-updated",
      handlePageTitleUpdated
    )
    attachedWebview.addEventListener("found-in-page", handleFoundInPage)
    attachedWebview.addEventListener("did-fail-load", handleDidFailLoad)
    attachedWebview.addEventListener(
      "did-start-loading",
      handleDidStartLoading
    )
    attachedWebview.addEventListener("did-stop-loading", handleDidStopLoading)
    attachedWebview.addEventListener("dom-ready", handleDomReady)

    return () => {
      attachedWebview.removeEventListener("did-navigate", handleDidNavigate)
      attachedWebview.removeEventListener(
        "did-navigate-in-page",
        handleDidNavigateInPage
      )
      attachedWebview.removeEventListener(
        "page-title-updated",
        handlePageTitleUpdated
      )
      attachedWebview.removeEventListener("found-in-page", handleFoundInPage)
      attachedWebview.removeEventListener("did-fail-load", handleDidFailLoad)
      attachedWebview.removeEventListener(
        "did-start-loading",
        handleDidStartLoading
      )
      attachedWebview.removeEventListener(
        "did-stop-loading",
        handleDidStopLoading
      )
      attachedWebview.removeEventListener("dom-ready", handleDomReady)
    }
  }, [tab.id, useElectronWebview, zoom])

  function handleAddressSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!browserEnabled) {
      toast.error(labels.browserDisabledDescription)
      return
    }

    const url = normalizeBrowserUrl(tab.address)

    if (!url) {
      setLoading(false)
      return
    }

    if (localUrlTarget === "system" && isLocalBrowserUrl(url)) {
      setLoading(false)
      void openInSystemBrowser(url)
        .then((opened) => {
          if (!opened) {
            toast.error(labels.openExternalFailed)
            return
          }

          onTabChangeRef.current((currentTab) =>
            normalizeBrowserUrl(currentTab.address) === url
              ? { ...currentTab, title: getBrowserTabTitle(url), url: "" }
              : currentTab
          )
        })
        .catch(() => toast.error(labels.openExternalFailed))
      return
    }

    updateActiveTab((currentTab) => ({
      ...currentTab,
      title: getBrowserTabTitle(url),
      url,
    }))
    setLoading(true)
  }

  React.useEffect(() => {
    if (!activeTabUrl) {
      return
    }

    let disposed = false

    void fetchStudioBrowserTitle(activeTabUrl).then((title) => {
      if (!title || disposed) {
        return
      }

      onTabChangeRef.current((currentTab) =>
        currentTab.title !== title ? { ...currentTab, title } : currentTab
      )
    })

    return () => {
      disposed = true
    }
  }, [activeTabUrl])

  React.useEffect(() => {
    if (
      !browserEnabled ||
      localUrlTarget !== "system" ||
      !activeTabUrl ||
      !isLocalBrowserUrl(activeTabUrl)
    ) {
      return
    }

    if (externalizedLocalUrlRef.current === activeTabUrl) {
      return
    }

    externalizedLocalUrlRef.current = activeTabUrl
    let disposed = false

    void openInSystemBrowser(activeTabUrl)
      .then((opened) => {
        if (disposed) {
          return
        }

        if (!opened) {
          externalizedLocalUrlRef.current = ""
          toast.error(labels.openExternalFailed)
          return
        }

        onTabChangeRef.current((currentTab) =>
          currentTab.url === activeTabUrl
            ? { ...currentTab, url: "" }
            : currentTab
        )
      })
      .catch(() => {
        if (!disposed) {
          externalizedLocalUrlRef.current = ""
          toast.error(labels.openExternalFailed)
        }
      })

    return () => {
      disposed = true
    }
  }, [
    activeTabUrl,
    browserEnabled,
    labels.openExternalFailed,
    localUrlTarget,
  ])

  function handleBrowserFrameLoad(
    event: React.SyntheticEvent<HTMLIFrameElement>
  ) {
    setLoading(false)

    try {
      const title = event.currentTarget.contentDocument?.title?.trim()

      if (!title) {
        return
      }

      updateActiveTab((currentTab) =>
        currentTab.title !== title ? { ...currentTab, title } : currentTab
      )
    } catch {
      // Remote pages usually disallow frame document access; title lookup falls
      // back to the server route above.
    }
  }

  async function handleClearData() {
    try {
      const clearData = window.astraflowDesktop?.browserClearData

      if (!clearData) {
        throw new Error("Desktop browser data API is unavailable.")
      }

      await clearData()
      toast.success(labels.browserDataCleared)
      setMenuOpen(false)
    } catch {
      toast.error(labels.browserDataFailed)
    }
  }

  function handleForceReload() {
    if (!useElectronWebview) {
      return
    }

    setMenuOpen(false)

    try {
      setLoading(true)
      webviewRef.current?.reloadIgnoringCache()
    } catch {
      setLoading(false)
    }
  }

  function handleOpenFind() {
    if (!useElectronWebview) {
      return
    }

    setFindOpen(true)
    setMenuOpen(false)
    requestAnimationFrame(() => findInputRef.current?.focus())
  }

  function handleCloseFind() {
    try {
      webviewRef.current?.stopFindInPage("clearSelection")
    } catch {
      // The guest may have closed while the find toolbar was visible.
    }

    setFindOpen(false)
    setFindQuery("")
    setFindResult({ activeMatchOrdinal: 0, matches: 0 })
  }

  function updateFindQuery(query: string) {
    setFindQuery(query)

    const normalizedQuery = query.trim()

    if (!normalizedQuery || !useElectronWebview) {
      try {
        webviewRef.current?.stopFindInPage("clearSelection")
      } catch {
        // The guest may have detached while the query was changing.
      }
      setFindResult({ activeMatchOrdinal: 0, matches: 0 })
      return
    }

    try {
      webviewRef.current?.findInPage(normalizedQuery, { findNext: true })
    } catch {
      setFindResult({ activeMatchOrdinal: 0, matches: 0 })
    }
  }

  function findNextMatch(forward: boolean) {
    const normalizedQuery = findQuery.trim()

    if (!normalizedQuery || !useElectronWebview) {
      return
    }

    try {
      webviewRef.current?.findInPage(normalizedQuery, {
        findNext: false,
        forward,
      })
    } catch {
      setFindResult({ activeMatchOrdinal: 0, matches: 0 })
    }
  }

  function handleToggleDeviceToolbar() {
    if (!useElectronWebview) {
      return
    }

    setDeviceToolbarOpen((current) => !current)
    setMenuOpen(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex h-10 shrink-0 items-center gap-1 border-b border-token-border-light bg-token-main-surface-primary px-3"
        onSubmit={handleAddressSubmit}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled={!useElectronWebview || !canGoBack}
          onClick={() => webviewRef.current?.goBack()}
        >
          <RiArrowLeftSLine aria-hidden className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled={!useElectronWebview || !canGoForward}
          onClick={() => webviewRef.current?.goForward()}
        >
          <RiArrowRightSLine aria-hidden className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled={!browserEnabled || !tab.url}
          onClick={() => {
            if (useElectronWebview) {
              if (loading) {
                webviewRef.current?.stop()
                setLoading(false)
              } else if (tab.url) {
                setLoading(true)
                webviewRef.current?.reload()
              }
              return
            }

            if (loading) {
              setLoading(false)
              updateActiveTab((currentTab) => ({ ...currentTab, url: "" }))
            } else if (tab.url) {
              setLoading(true)
              updateActiveTab((currentTab) => ({ ...currentTab, url: "" }))
              requestAnimationFrame(() => {
                updateActiveTab((currentTab) => ({
                  ...currentTab,
                  url: normalizeBrowserUrl(currentTab.address),
                }))
              })
            }
          }}
        >
          {loading ? (
            <RiCloseLine aria-hidden className="size-3.5" />
          ) : (
            <RiRefreshLine aria-hidden className="size-3.5" />
          )}
        </Button>
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-token-border-light bg-token-input-background px-2">
          <Globe
            aria-hidden
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground",
              loading && "animate-pulse text-primary"
            )}
          />
          <input
            value={tab.address}
            disabled={!browserEnabled}
            placeholder="输入 URL"
            className="min-w-0 flex-1 bg-transparent text-center text-[11px] font-medium text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
            title={tab.title || tab.address || labels.browser}
            onChange={(event) =>
              updateActiveTab((currentTab) => ({
                ...currentTab,
                address: event.target.value,
              }))
            }
          />
        </div>
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={labels.browserMenu}
            className={cn("size-7 rounded-md", menuOpen && "bg-muted")}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <MoreVertical aria-hidden className="size-3.5" />
          </Button>

          {menuOpen ? (
            <div className="absolute top-9 right-0 z-40 w-[13rem] max-w-[calc(100vw-2rem)] rounded-lg border bg-background p-1.5 text-[11px] shadow-xl">
              <button
                type="button"
                className="flex h-7 w-full items-center justify-between rounded-md px-2 text-left hover:bg-muted"
                onClick={() => void handleClearData()}
              >
                <span>{labels.clearBrowsingData}</span>
                <RiArrowRightSLine
                  aria-hidden
                  className="size-3.5 text-muted-foreground"
                />
              </button>
              <div className="my-1 h-px bg-border" />
              <div className="flex h-7 items-center justify-between px-2">
                <span className="font-medium">{labels.zoom}</span>
                <div className="flex items-center overflow-hidden rounded-md border bg-muted/40">
                  <button
                    type="button"
                    className="grid size-6 place-items-center text-muted-foreground hover:text-foreground"
                    onClick={() => setZoom((value) => Math.max(50, value - 10))}
                  >
                    −
                  </button>
                  <span className="w-10 text-center font-medium">{zoom}%</span>
                  <button
                    type="button"
                    className="grid size-6 place-items-center text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setZoom((value) => Math.min(200, value + 10))
                    }
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                disabled={!useElectronWebview}
                className="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-50"
                onClick={handleForceReload}
              >
                {labels.forceReload}
              </button>
              <button
                type="button"
                disabled={!useElectronWebview}
                className="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-50"
                onClick={handleOpenFind}
              >
                {labels.findInPage}
              </button>
              <button
                type="button"
                disabled={!useElectronWebview}
                className={cn(
                  "flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-50",
                  deviceToolbarOpen && "bg-muted"
                )}
                onClick={handleToggleDeviceToolbar}
              >
                {labels.showDeviceToolbar}
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                className="flex h-7 w-full items-center rounded-md px-2 text-left hover:bg-muted"
                onClick={() => {
                  setMenuOpen(false)
                  onModeChange("browser-settings")
                }}
              >
                {labels.browserSettings}
              </button>
            </div>
          ) : null}
        </div>
      </form>

      {findOpen && useElectronWebview ? (
        <div className="flex h-9 shrink-0 items-center gap-1.5 border-b bg-background px-3">
          <Search aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={findInputRef}
            value={findQuery}
            placeholder={labels.findPlaceholder}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
            onChange={(event) => updateFindQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                handleCloseFind()
              } else if (event.key === "Enter") {
                event.preventDefault()
                findNextMatch(!event.shiftKey)
              }
            }}
          />
          <span className="min-w-10 text-center text-[10px] tabular-nums text-muted-foreground">
            {findResult.matches > 0
              ? `${findResult.activeMatchOrdinal}/${findResult.matches}`
              : "0/0"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={labels.previousMatch}
            className="size-7 rounded-md"
            disabled={!findQuery.trim()}
            onClick={() => findNextMatch(false)}
          >
            <RiArrowUpSLine aria-hidden className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={labels.nextMatch}
            className="size-7 rounded-md"
            disabled={!findQuery.trim()}
            onClick={() => findNextMatch(true)}
          >
            <RiArrowDownSLine aria-hidden className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={labels.closeFind}
            className="size-7 rounded-md"
            onClick={handleCloseFind}
          >
            <RiCloseLine aria-hidden className="size-3.5" />
          </Button>
        </div>
      ) : null}

      {deviceToolbarOpen && useElectronWebview ? (
        <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b bg-background px-3">
          <span className="text-[10px] font-medium text-muted-foreground">
            {labels.deviceViewport}
          </span>
          <div className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5">
            {(
              [
                ["responsive", labels.responsiveViewport],
                ["mobile", labels.mobileViewport],
                ["tablet", labels.tabletViewport],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={deviceViewport === value}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px] transition-colors",
                  deviceViewport === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setDeviceViewport(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={labels.hideDeviceToolbar}
            className="size-7 rounded-md"
            onClick={() => setDeviceToolbarOpen(false)}
          >
            <RiCloseLine aria-hidden className="size-3.5" />
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-0 flex-1 bg-background",
          deviceToolbarOpen && useElectronWebview &&
            "overflow-auto bg-muted/40 p-3"
        )}
      >
        {!browserEnabled ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <Globe aria-hidden className="size-10 text-muted-foreground/60" />
            <div>
              <h3 className="text-sm font-semibold">{labels.browserDisabled}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {labels.browserDisabledDescription}
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onModeChange("browser-settings")}
            >
              {labels.browserSettings}
            </Button>
          </div>
        ) : tab.url ? (
          <div
            className={cn(
              "relative h-full max-w-full bg-background",
              deviceViewportWidth &&
                "mx-auto overflow-hidden rounded-lg border shadow-sm"
            )}
            style={
              deviceViewportWidth
                ? { width: `${deviceViewportWidth}px` }
                : undefined
            }
          >
            {loading ? (
              <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-primary/15">
                <div className="h-full w-1/3 animate-pulse bg-primary" />
              </div>
            ) : null}
            {!clientReady ? null : useElectronWebview ? (
              <webview
                key={getWorkspaceBrowserRevisionKey(tab)}
                ref={webviewRef}
                title={tab.title}
                src={tab.url}
                partition={SIDE_PANEL_BROWSER_PARTITION}
                className="size-full bg-background"
                style={{ display: "flex" }}
              />
            ) : (
              <iframe
                key={getWorkspaceBrowserRevisionKey(tab)}
                title={tab.title}
                src={tab.url}
                className="size-full border-0 bg-background"
                style={{ zoom: `${zoom}%` }}
                onLoad={handleBrowserFrameLoad}
              />
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Globe aria-hidden className="size-10 text-muted-foreground/80" />
            <div>
              <h3 className="text-sm font-semibold">{labels.browserStart}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {labels.browserStartDescription}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function StudioRightPanelBrowserSettings({
  labels,
  onModeChange,
}: {
  labels: StudioRightPanelLabels
  onModeChange: (mode: StudioRightPanelMode) => void
}) {
  const browserEnabled = useBrowserEnabled()
  const localUrlTarget = useLocalUrlTarget()

  function toggleBrowserEnabled() {
    setBrowserEnabled(!browserEnabled)
  }

  async function handleClearBrowserData() {
    try {
      const clearData = window.astraflowDesktop?.browserClearData

      if (!clearData) {
        throw new Error("Desktop browser data API is unavailable.")
      }

      await clearData()
      toast.success(labels.browserDataCleared)
    } catch {
      toast.error(labels.browserDataFailed)
    }
  }

  return (
    <div className="h-full min-h-0 overflow-x-hidden overflow-y-auto px-3 pt-12 pb-5">
      <div className="w-full min-w-0">
        <button
          type="button"
          className="mb-3 inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
          onClick={() => onModeChange("browser")}
        >
          <RiArrowLeftSLine aria-hidden className="size-3" />
          {labels.browser}
        </button>

        <h2 className="text-base font-semibold tracking-normal">
          {labels.browserTitle}
        </h2>
        <p className="mt-1 text-[11px] leading-4 [overflow-wrap:anywhere] text-muted-foreground">
          {labels.settingsDescription}
        </p>

        <div className="mt-4 rounded-md border bg-background p-2.5">
          <div className="flex items-center gap-2">
            <div className="grid size-7 shrink-0 place-items-center rounded-md border">
              <Globe aria-hidden className="size-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[11px] font-semibold">{labels.browser}</h3>
              <p className="mt-0.5 text-[10px] leading-3.5 [overflow-wrap:anywhere] text-muted-foreground">
                {labels.allowBrowser}
              </p>
            </div>
            <button
              type="button"
              aria-pressed={browserEnabled}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                browserEnabled ? "bg-blue-500" : "bg-muted"
              )}
              onClick={toggleBrowserEnabled}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-background shadow transition-transform",
                  browserEnabled ? "left-[18px]" : "left-0.5"
                )}
              />
            </button>
          </div>
        </div>

        <StudioBrowserSettingsSection title={labels.general}>
          <StudioBrowserSettingsRow
            title={labels.localUrlTarget}
            description={labels.localUrlHelp}
          >
            <Select
              value={localUrlTarget}
              onValueChange={(value) =>
                setLocalUrlTarget(value as LocalUrlTarget)
              }
            >
              <SelectTrigger
                size="xs"
                className="w-full rounded-md bg-muted px-2 font-semibold"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value="astraflow">
                  {labels.localTargetApp}
                </SelectItem>
                <SelectItem value="system">
                  {labels.systemBrowser}
                </SelectItem>
              </SelectContent>
            </Select>
          </StudioBrowserSettingsRow>
          <StudioBrowserSettingsRow
            title={labels.browsingData}
            description={labels.browsingDataHelp}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-7 w-full justify-start rounded-md px-2 text-[11px] font-semibold"
              onClick={() => void handleClearBrowserData()}
            >
              {labels.clearAllBrowsingData}
            </Button>
          </StudioBrowserSettingsRow>
        </StudioBrowserSettingsSection>
      </div>
    </div>
  )
}

export function StudioBrowserSettingsSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-5">
      <h3 className="mb-1.5 text-xs font-semibold">{title}</h3>
      <div className="overflow-hidden rounded-md border bg-background">
        {children}
      </div>
    </section>
  )
}

export function StudioBrowserSettingsRow({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-b px-2.5 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <h4 className="text-[11px] font-semibold [overflow-wrap:anywhere]">
          {title}
        </h4>
        <p className="mt-0.5 text-[10px] leading-3.5 [overflow-wrap:anywhere] text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}
