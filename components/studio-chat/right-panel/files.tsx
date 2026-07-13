"use client"

import * as React from "react"
import { atom, useAtom } from "jotai"
import {
  RiArrowRightSLine,
  RiExternalLinkLine,
  RiInformationLine,
  RiRefreshLine,
} from "@remixicon/react"
import { Archive, Folder, PanelRight } from "lucide-react"

import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { useI18n } from "@/components/i18n-provider"
import { PanelSearchInput } from "@/components/search-input"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { STUDIO_FILE_PREVIEW_SUPPORT } from "@/lib/studio-file-support"
import { cn } from "@/lib/utils"

import {
  formatFileBreadcrumb,
  formatSidePanelFileSize,
  isBinaryPreviewEntry,
  isImageEntry,
  isLikelyTextEntry,
  isPreviewableSidePanelEntry,
} from "../side-panel-utils"
import type {
  StudioSidePanelFilePreview,
  StudioWorkspaceFileTab,
} from "../types"
import {
  listStudioWorkspaceDirectory,
  openStudioWorkspacePath,
  readStudioWorkspaceDataUrlFile,
  readStudioWorkspaceTextFile,
  revealStudioWorkspacePath,
  type StudioWorkspaceTransport,
} from "../workspace-transport"
import type { StudioRightPanelLabels } from "./labels"
import { StudioSidePanelPreview } from "./previews"

type StudioDirectoryChildren =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; entries: AstraFlowSidePanelDirectoryEntry[] }

// Shared across every file tab: each tab mounts its own files browser, and
// opening a file from the tree activates a new tab — without shared state
// the tree would collapse back to the default directory on every click.
const studioFilesPanelExpandedAtom = atom<
  Record<string, StudioDirectoryChildren | undefined>
>({})

// Also shared: opening a file activates another tab instance, and the file
// list should stay visible there instead of snapping back to hidden.
const studioFilesPanelListingOpenAtom = atom(false)

export function StudioRightPanelFiles({
  activeFileTabId,
  workspace,
  labels,
  defaultDirectory,
  fileTabs,
  open,
  onOpenFile,
}: {
  activeFileTabId: string
  workspace: StudioWorkspaceTransport
  labels: StudioRightPanelLabels
  defaultDirectory: string | null
  fileTabs: StudioWorkspaceFileTab[]
  open: boolean
  onOpenFile: (entry: AstraFlowSidePanelDirectoryEntry) => void
}) {
  const { locale } = useI18n()
  const [directory, setDirectory] = React.useState<string | null>(
    defaultDirectory
  )
  const [listing, setListing] =
    React.useState<AstraFlowSidePanelDirectory | null>(null)
  const [listingOpen, setListingOpen] = useAtom(
    studioFilesPanelListingOpenAtom
  )
  const [preview, setPreview] =
    React.useState<StudioSidePanelFilePreview | null>(null)
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const [expandedDirectories, setExpandedDirectories] = useAtom(
    studioFilesPanelExpandedAtom
  )
  const previewRequestRef = React.useRef(0)
  const defaultDirectoryRef = React.useRef<string | null>(null)
  const workspaceIdRef = React.useRef("")
  const wasOpenRef = React.useRef(false)
  const fileTabsLengthRef = React.useRef(fileTabs.length)
  const onOpenFileRef = React.useRef(onOpenFile)

  React.useEffect(() => {
    fileTabsLengthRef.current = fileTabs.length
    onOpenFileRef.current = onOpenFile
  }, [fileTabs.length, onOpenFile])

  const activeFileTab =
    fileTabs.find((tab) => tab.id === activeFileTabId) ??
    fileTabs.find((tab) => tab.entry) ??
    null
  const selectedEntry =
    activeFileTab?.entry ??
    (activeFileTab?.entry?.path
      ? listing?.entries.find(
          (entry) => entry.path === activeFileTab.entry?.path
        )
      : null) ??
    null

  React.useEffect(() => {
    let cancelled = false
    const becameOpen = open && !wasOpenRef.current
    const workspaceChanged =
      workspaceIdRef.current !== workspace.id ||
      defaultDirectoryRef.current !== defaultDirectory

    wasOpenRef.current = open
    workspaceIdRef.current = workspace.id
    defaultDirectoryRef.current = defaultDirectory

    if (!open || (!becameOpen && !workspaceChanged)) {
      return
    }

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      if (workspaceChanged) {
        setExpandedDirectories({})
      }
      setDirectory(defaultDirectory)
    })

    return () => {
      cancelled = true
    }
  }, [defaultDirectory, open, setExpandedDirectories, workspace.id])

  const loadPreviewForEntry = React.useCallback(
    async (entry: AstraFlowSidePanelDirectoryEntry) => {
      const requestId = previewRequestRef.current + 1
      previewRequestRef.current = requestId
      setPreviewLoading(true)
      setPreview(null)

      try {
        if (isImageEntry(entry) || isBinaryPreviewEntry(entry)) {
          const file = await readStudioWorkspaceDataUrlFile(
            workspace,
            entry.path
          )

          if (previewRequestRef.current === requestId) {
            setPreview({
              kind: isImageEntry(entry) ? "image" : "binary",
              entry,
              file,
            })
          }
          return
        }

        if (isLikelyTextEntry(entry)) {
          const file = await readStudioWorkspaceTextFile(workspace, entry.path)

          if (previewRequestRef.current === requestId) {
            setPreview({ kind: "text", entry, file })
          }
          return
        }

        if (previewRequestRef.current === requestId) {
          setPreview({ kind: "unsupported", entry })
        }
      } catch (previewError) {
        if (previewRequestRef.current === requestId) {
          setPreview({
            kind: "unsupported",
            entry,
            error:
              previewError instanceof Error
                ? previewError.message
                : labels.noPreview,
          })
        }
      } finally {
        if (previewRequestRef.current === requestId) {
          setPreviewLoading(false)
        }
      }
    },
    [labels.noPreview, workspace]
  )

  React.useEffect(() => {
    if (!open || !selectedEntry) {
      previewRequestRef.current += 1

      if (!open) {
        queueMicrotask(() => {
          setPreview(null)
          setPreviewLoading(false)
        })
      }
      return
    }

    queueMicrotask(() => {
      void loadPreviewForEntry(selectedEntry)
    })
  }, [loadPreviewForEntry, open, selectedEntry])

  React.useEffect(() => {
    let disposed = false

    if (!open) {
      return
    }

    async function loadDirectory() {
      setLoading(true)
      setError("")

      try {
        const nextListing = await listStudioWorkspaceDirectory(
          workspace,
          directory ?? workspace.rootPath
        )

        if (disposed) {
          return
        }

        setListing(nextListing)

        const firstPreviewable =
          nextListing.entries.find(isPreviewableSidePanelEntry) ??
          nextListing.entries.find((entry) => entry.kind === "file") ??
          null

        if (firstPreviewable && fileTabsLengthRef.current === 0) {
          onOpenFileRef.current(firstPreviewable)
        } else if (!firstPreviewable) {
          setPreview(null)
        }
      } catch (loadError) {
        if (!disposed) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : labels.desktopUnavailable
          )
          setListing(null)
          setPreview(null)
        }
      } finally {
        if (!disposed) {
          setLoading(false)
        }
      }
    }

    void loadDirectory()

    return () => {
      disposed = true
    }
  }, [labels.desktopUnavailable, directory, open, refreshNonce, workspace])

  async function handleToggleDirectory(
    entry: AstraFlowSidePanelDirectoryEntry
  ) {
    const path = entry.path

    if (expandedDirectories[path]) {
      setExpandedDirectories((current) => {
        const next = { ...current }

        delete next[path]
        return next
      })
      return
    }

    setExpandedDirectories((current) => ({
      ...current,
      [path]: { status: "loading" },
    }))

    try {
      const childListing = await listStudioWorkspaceDirectory(workspace, path)

      setExpandedDirectories((current) =>
        current[path]
          ? {
              ...current,
              [path]: { status: "loaded", entries: childListing.entries },
            }
          : current
      )
    } catch (toggleError) {
      setExpandedDirectories((current) =>
        current[path]
          ? {
              ...current,
              [path]: {
                status: "error",
                message:
                  toggleError instanceof Error
                    ? toggleError.message
                    : labels.desktopUnavailable,
              },
            }
          : current
      )
    }
  }

  function handleSelectEntry(entry: AstraFlowSidePanelDirectoryEntry) {
    if (entry.kind === "directory") {
      void handleToggleDirectory(entry)
      return
    }

    onOpenFile(entry)
  }

  function handleOpenWithSystemApp() {
    const target = selectedEntry?.path ?? listing?.cwd

    if (target) {
      void openStudioWorkspacePath(workspace, target)
    }
  }

  function handleRevealSelected() {
    const target = selectedEntry?.path ?? listing?.cwd

    if (target) {
      void revealStudioWorkspacePath(workspace, target)
    }
  }

  const normalizedQuery = query.trim().toLowerCase()
  const filteredEntries = (listing?.entries ?? []).filter((entry) =>
    entry.name.toLowerCase().includes(normalizedQuery)
  )

  function renderEntryRows(
    entries: AstraFlowSidePanelDirectoryEntry[],
    depth: number
  ): React.ReactNode {
    return entries
      .filter(
        (entry) =>
          depth === 0 || // The root list is already filtered.
          !normalizedQuery ||
          entry.name.toLowerCase().includes(normalizedQuery)
      )
      .map((entry) => {
        const isSelected = selectedEntry?.path === entry.path
        const children =
          entry.kind === "directory"
            ? expandedDirectories[entry.path]
            : undefined
        const indent = { paddingLeft: `${8 + depth * 14}px` }

        return (
          <React.Fragment key={entry.path}>
            <button
              type="button"
              className={cn(
                "flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-xs transition-colors",
                isSelected
                  ? "bg-muted text-foreground"
                  : "text-foreground hover:bg-muted/60"
              )}
              style={indent}
              onClick={() => void handleSelectEntry(entry)}
            >
              {entry.kind === "directory" ? (
                <RiArrowRightSLine
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    children && "rotate-90"
                  )}
                />
              ) : (
                <span aria-hidden className="size-3.5 shrink-0" />
              )}
              <StudioSidePanelFileIcon entry={entry} />
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.kind === "file" && entry.size ? (
                <span className="hidden text-[10px] text-muted-foreground xl:inline">
                  {formatSidePanelFileSize(entry.size)}
                </span>
              ) : null}
            </button>
            {children?.status === "loading" ? (
              <p
                className="px-2 py-1.5 text-xs text-muted-foreground"
                style={{ paddingLeft: `${8 + (depth + 1) * 14 + 20}px` }}
              >
                Loading...
              </p>
            ) : null}
            {children?.status === "error" ? (
              <p
                className="px-2 py-1.5 text-xs text-muted-foreground"
                style={{ paddingLeft: `${8 + (depth + 1) * 14 + 20}px` }}
              >
                {children.message}
              </p>
            ) : null}
            {children?.status === "loaded" ? (
              children.entries.length > 0 ? (
                renderEntryRows(children.entries, depth + 1)
              ) : (
                <p
                  className="px-2 py-1.5 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${8 + (depth + 1) * 14 + 20}px` }}
                >
                  {labels.emptyFolder}
                </p>
              )
            ) : null}
          </React.Fragment>
        )
      })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <div className="studio-files-panel-chrome flex min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground">
          <button
            type="button"
            className="shrink-0 hover:text-foreground"
            onClick={() => setDirectory(defaultDirectory)}
          >
            {formatFileBreadcrumb(listing?.cwd)}
          </button>
          {selectedEntry ? (
            <>
              <span className="shrink-0 text-muted-foreground/60">›</span>
              <StudioFileTypeIcon
                path={selectedEntry.path}
                size="small"
                className="size-4 shrink-0 rounded-[4px] text-[8px]"
              />
              <span className="min-w-0 truncate font-medium text-foreground">
                {selectedEntry.name}
              </span>
            </>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8 rounded-lg"
          aria-label={labels.refresh}
          title={labels.refresh}
          disabled={loading}
          onClick={() => {
            setExpandedDirectories({})
            setRefreshNonce((current) => current + 1)
          }}
        >
          <RiRefreshLine
            aria-hidden
            className={cn("size-3.5", loading && "animate-spin")}
          />
        </Button>
        {workspace.type === "local" ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 rounded-lg"
              aria-label={labels.openWithSystemApp}
              title={labels.openWithSystemApp}
              onClick={handleOpenWithSystemApp}
            >
              <RiExternalLinkLine aria-hidden className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-lg px-2 text-xs"
              onClick={handleRevealSelected}
            >
              <Folder aria-hidden className="size-3.5" />
              {labels.revealInFolder}
            </Button>
          </>
        ) : null}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-8 rounded-lg text-muted-foreground"
              aria-label={
                locale === "zh" ? "支持的文件预览" : "Supported file previews"
              }
            >
              <RiInformationLine aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 gap-3 rounded-2xl p-3">
            <PopoverHeader>
              <PopoverTitle className="text-sm">
                {locale === "zh" ? "支持的文件预览" : "Supported file previews"}
              </PopoverTitle>
              <PopoverDescription className="text-xs">
                {workspace.type === "local"
                  ? locale === "zh"
                    ? "文件内容从当前本地工作区读取。"
                    : "File content is read from the current local workspace."
                  : locale === "zh"
                    ? "文件内容直接从远程沙箱工作区读取。"
                    : "File content is read directly from the remote sandbox workspace."}
              </PopoverDescription>
            </PopoverHeader>
            <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {STUDIO_FILE_PREVIEW_SUPPORT.map((item) => (
                <div
                  key={item.kind}
                  className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 border-t border-border/65 pt-2 first:border-t-0 first:pt-0"
                >
                  <span className="text-xs font-medium text-foreground">
                    {item.label[locale]}
                  </span>
                  <code className="text-[10px] leading-4 break-words text-muted-foreground">
                    {item.extensions}
                  </code>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            "size-8 rounded-lg text-muted-foreground",
            listingOpen && "bg-muted text-foreground"
          )}
          aria-label={labels.toggleFileList}
          title={labels.toggleFileList}
          onClick={() => setListingOpen((current) => !current)}
        >
          <PanelRight aria-hidden className="size-3.5" />
        </Button>
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1",
          listingOpen
            ? "grid-cols-[minmax(0,1fr)_minmax(190px,42%)]"
            : "grid-cols-[minmax(0,1fr)]"
        )}
      >
        <div
          className={cn(
            "min-h-0 overflow-auto bg-background",
            listingOpen && "border-r"
          )}
        >
          {loading && !listing ? (
            <div className="p-8 text-sm text-muted-foreground">Loading...</div>
          ) : error ? (
            <div className="p-8 text-sm text-muted-foreground">{error}</div>
          ) : !selectedEntry ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {listing?.entries.length ? labels.noPreview : labels.emptyFolder}
            </div>
          ) : previewLoading ? (
            <div className="p-8 text-sm text-muted-foreground">Loading...</div>
          ) : preview ? (
            <StudioSidePanelPreview
              preview={preview}
              workspace={workspace}
              labels={labels}
              focusLine={activeFileTab?.focusLine ?? null}
              focusColumn={activeFileTab?.focusColumn ?? null}
              focusEndLine={activeFileTab?.focusEndLine ?? null}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {listing?.entries.length ? labels.noPreview : labels.emptyFolder}
            </div>
          )}
        </div>

        {listingOpen ? (
          <div className="studio-files-panel-chrome flex min-h-0 flex-col bg-background p-3">
            <PanelSearchInput
              containerClassName="shrink-0"
              onValueChange={setQuery}
              placeholder={labels.filterFiles}
              value={query}
            />

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {renderEntryRows(filteredEntries, 0)}
              {!loading && filteredEntries.length === 0 ? (
                <p className="px-2 py-4 text-xs text-muted-foreground">
                  {labels.emptyFolder}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function StudioSidePanelFileIcon({
  entry,
}: {
  entry: AstraFlowSidePanelDirectoryEntry
}) {
  if (entry.kind === "directory") {
    return (
      <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    )
  }

  if (["zip", "tar", "gz", "dmg"].includes(entry.extension)) {
    return <Archive aria-hidden className="size-4 shrink-0 text-amber-600" />
  }

  return <StudioFileTypeIcon path={entry.path} size="small" />
}
