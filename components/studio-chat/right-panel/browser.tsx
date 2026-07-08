"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiRefreshLine,
} from "@remixicon/react"
import { Globe, MoreVertical } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { getBrowserTabTitle, normalizeBrowserUrl } from "../browser-utils"
import { readStoredBoolean } from "../panel-storage"
import type { StudioRightPanelMode, StudioWorkspaceBrowserTab } from "../types"
import type { StudioRightPanelLabels } from "./labels"

const studioBrowserTitleCache = new Map<string, string>()
const studioBrowserTitleRequests = new Map<string, Promise<string>>()

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
  const activeTabUrl = tab.url

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

  function handleAddressSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const url = normalizeBrowserUrl(tab.address)

    updateActiveTab((currentTab) => ({
      ...currentTab,
      title: getBrowserTabTitle(url),
      url,
    }))
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

  function handleBrowserFrameLoad(
    event: React.SyntheticEvent<HTMLIFrameElement>
  ) {
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
      await window.astraflowDesktop?.browserClearData?.()
      toast.success(labels.browserDataCleared)
      setMenuOpen(false)
    } catch {
      toast.error(labels.browserDataFailed)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <form
        className="flex h-10 shrink-0 items-center gap-1 border-b px-3"
        onSubmit={handleAddressSubmit}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled
        >
          <RiArrowLeftSLine aria-hidden className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled
        >
          <RiArrowRightSLine aria-hidden className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-md"
          onClick={() => {
            if (tab.url) {
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
          <RiRefreshLine aria-hidden className="size-3.5" />
        </Button>
        <input
          value={tab.address}
          placeholder="输入 URL"
          className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-2 text-center text-[11px] font-medium text-foreground outline-none placeholder:text-muted-foreground"
          title={tab.title || tab.address || labels.browser}
          onChange={(event) =>
            updateActiveTab((currentTab) => ({
              ...currentTab,
              address: event.target.value,
            }))
          }
        />
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
              {[
                labels.forceReload,
                labels.findInPage,
                labels.showDeviceToolbar,
              ].map((label) => (
                <button
                  key={label}
                  type="button"
                  className="flex h-7 w-full items-center rounded-md px-2 text-left text-muted-foreground"
                  disabled
                >
                  {label}
                </button>
              ))}
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

      <div className="min-h-0 flex-1 bg-background">
        {tab.url ? (
          <iframe
            key={tab.url}
            title={tab.title}
            src={tab.url}
            className="size-full border-0 bg-background"
            style={{ zoom: `${zoom}%` }}
            onLoad={handleBrowserFrameLoad}
          />
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
  const [browserEnabled, setBrowserEnabled] = React.useState(() =>
    readStoredBoolean("astraflow.studio.browser-enabled", true)
  )

  function toggleBrowserEnabled() {
    const nextValue = !browserEnabled

    window.localStorage.setItem(
      "astraflow.studio.browser-enabled",
      String(nextValue)
    )
    setBrowserEnabled(nextValue)
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

        <StudioBrowserSettingsSection title="常规">
          <StudioBrowserSettingsRow
            title={labels.localUrlTarget}
            description={labels.localUrlHelp}
            value={labels.localTargetApp}
          />
          <StudioBrowserSettingsRow
            title={labels.browsingData}
            description={labels.browsingDataHelp}
            value={labels.clearAllBrowsingData}
          />
          <StudioBrowserSettingsRow
            title={labels.screenshotMode}
            description={labels.screenshotHelp}
            value={labels.alwaysInclude}
          />
        </StudioBrowserSettingsSection>

        <StudioBrowserSettingsSection title={labels.permissions}>
          <StudioBrowserSettingsRow
            title="审批"
            description={labels.permissionsHelp}
            value={labels.alwaysAsk}
          />
        </StudioBrowserSettingsSection>

        <div className="mt-5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold">
              {labels.websitePermissions}
            </h3>
            <p className="mt-0.5 text-[10px] leading-3.5 [overflow-wrap:anywhere] text-muted-foreground">
              {labels.websitePermissionsHelp}
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-6 shrink-0 gap-1 rounded-md px-2 text-[10px]"
          >
            <RiAddLine aria-hidden className="size-3" />
            {labels.add}
          </Button>
        </div>
        <div className="mt-2.5 rounded-md border p-3 text-center text-[10px] font-medium text-muted-foreground">
          {labels.noWebsitePermissions}
        </div>
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
  value,
}: {
  title: string
  description: string
  value: string
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
      <button
        type="button"
        className="flex h-7 w-full min-w-0 items-center justify-between gap-2 rounded-md bg-muted px-2 text-left text-[11px] font-semibold"
      >
        <span className="min-w-0 truncate">{value}</span>
        <RiArrowDownSLine
          aria-hidden
          className="size-3 shrink-0 text-muted-foreground"
        />
      </button>
    </div>
  )
}
