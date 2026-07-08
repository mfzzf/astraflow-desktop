"use client"

import * as React from "react"
import { RiExternalLinkLine } from "@remixicon/react"
import {
  Archive,
  File,
  FileImage,
  FileSpreadsheet,
  Folder,
  PanelRight,
} from "lucide-react"

import { PanelSearchInput } from "@/components/search-input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { IMAGE_FILE_EXTENSIONS } from "../constants"
import {
  formatFileBreadcrumb,
  formatSidePanelFileSize,
  isImageEntry,
  isLikelyTextEntry,
  isPreviewableSidePanelEntry,
} from "../side-panel-utils"
import type {
  StudioSidePanelFilePreview,
  StudioWorkspaceFileTab,
} from "../types"
import type { StudioRightPanelLabels } from "./labels"
import { StudioSidePanelPreview } from "./previews"

export function StudioRightPanelFiles({
  activeFileTabId,
  labels,
  defaultDirectory,
  fileTabs,
  open,
  onOpenFile,
}: {
  activeFileTabId: string
  labels: StudioRightPanelLabels
  defaultDirectory: string | null
  fileTabs: StudioWorkspaceFileTab[]
  open: boolean
  onOpenFile: (entry: AstraFlowSidePanelDirectoryEntry) => void
}) {
  const [directory, setDirectory] = React.useState<string | null>(null)
  const [listing, setListing] =
    React.useState<AstraFlowSidePanelDirectory | null>(null)
  const [listingOpen, setListingOpen] = React.useState(false)
  const [preview, setPreview] =
    React.useState<StudioSidePanelFilePreview | null>(null)
  const [query, setQuery] = React.useState("")
  const [loading, setLoading] = React.useState(true)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [error, setError] = React.useState("")
  const previewRequestRef = React.useRef(0)
  const defaultDirectoryRef = React.useRef<string | null>(null)
  const wasOpenRef = React.useRef(false)

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
    const projectChanged = defaultDirectoryRef.current !== defaultDirectory

    wasOpenRef.current = open
    defaultDirectoryRef.current = defaultDirectory

    if (!open || (!becameOpen && !projectChanged)) {
      return
    }

    queueMicrotask(() => {
      if (cancelled) {
        return
      }

      setDirectory(defaultDirectory)
    })

    return () => {
      cancelled = true
    }
  }, [defaultDirectory, open])

  const loadPreviewForEntry = React.useCallback(
    async (entry: AstraFlowSidePanelDirectoryEntry) => {
      const requestId = previewRequestRef.current + 1
      previewRequestRef.current = requestId
      setPreviewLoading(true)
      setPreview(null)

      try {
        const bridge = window.astraflowDesktop

        if (isImageEntry(entry)) {
          if (!bridge?.sidePanelReadFileDataUrl) {
            throw new Error(labels.desktopUnavailable)
          }

          const file = await bridge.sidePanelReadFileDataUrl(entry.path)

          if (previewRequestRef.current === requestId) {
            setPreview({ kind: "image", entry, file })
          }
          return
        }

        if (isLikelyTextEntry(entry)) {
          if (!bridge?.sidePanelReadTextFile) {
            throw new Error(labels.desktopUnavailable)
          }

          const file = await bridge.sidePanelReadTextFile(entry.path)

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
    [labels.desktopUnavailable, labels.noPreview]
  )

  React.useEffect(() => {
    if (!selectedEntry) {
      return
    }

    queueMicrotask(() => {
      void loadPreviewForEntry(selectedEntry)
    })
  }, [loadPreviewForEntry, selectedEntry])

  React.useEffect(() => {
    let disposed = false

    async function loadDirectory() {
      const bridge = window.astraflowDesktop

      if (!bridge?.sidePanelListDirectory) {
        setError(labels.desktopUnavailable)
        setLoading(false)
        return
      }

      setLoading(true)
      setError("")

      try {
        const nextListing = await bridge.sidePanelListDirectory(directory)

        if (disposed) {
          return
        }

        setListing(nextListing)

        const firstPreviewable =
          nextListing.entries.find(isPreviewableSidePanelEntry) ??
          nextListing.entries.find((entry) => entry.kind === "file") ??
          null

        if (firstPreviewable && fileTabs.length === 0) {
          onOpenFile(firstPreviewable)
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
  }, [
    labels.desktopUnavailable,
    directory,
    fileTabs.length,
    loadPreviewForEntry,
    onOpenFile,
  ])

  function handleSelectEntry(entry: AstraFlowSidePanelDirectoryEntry) {
    if (entry.kind === "directory") {
      setDirectory(entry.path)
      return
    }

    onOpenFile(entry)
  }

  function handleOpenSelected() {
    const target = selectedEntry?.path ?? listing?.cwd

    if (target) {
      void window.astraflowDesktop?.sidePanelShowItem(target)
    }
  }

  const filteredEntries = (listing?.entries ?? []).filter((entry) =>
    entry.name.toLowerCase().includes(query.trim().toLowerCase())
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => setDirectory(null)}
          >
            {formatFileBreadcrumb(listing?.cwd)}
          </button>
          {selectedEntry ? (
            <>
              <span className="px-2 text-muted-foreground/60">›</span>
              <span className="font-medium text-foreground">
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
          aria-label={labels.open}
          title={labels.open}
          onClick={handleOpenSelected}
        >
          <RiExternalLinkLine aria-hidden className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 rounded-lg px-2 text-xs"
          onClick={handleOpenSelected}
        >
          <Folder aria-hidden className="size-3.5" />
          {labels.open}
        </Button>
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
              labels={labels}
              focusLine={activeFileTab?.focusLine ?? null}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {listing?.entries.length ? labels.noPreview : labels.emptyFolder}
            </div>
          )}
        </div>

        {listingOpen ? (
          <div className="flex min-h-0 flex-col bg-background p-3">
            <PanelSearchInput
              containerClassName="shrink-0"
              onValueChange={setQuery}
              placeholder={labels.filterFiles}
              value={query}
            />

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {filteredEntries.map((entry) => {
                const isSelected = selectedEntry?.path === entry.path

                return (
                  <button
                    key={entry.path}
                    type="button"
                    className={cn(
                      "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
                      isSelected
                        ? "bg-muted text-foreground"
                        : "text-foreground hover:bg-muted/60"
                    )}
                    onClick={() => void handleSelectEntry(entry)}
                  >
                    <StudioSidePanelFileIcon entry={entry} />
                    <span className="min-w-0 flex-1 truncate">
                      {entry.name}
                    </span>
                    {entry.kind === "file" && entry.size ? (
                      <span className="hidden text-[10px] text-muted-foreground xl:inline">
                        {formatSidePanelFileSize(entry.size)}
                      </span>
                    ) : null}
                  </button>
                )
              })}
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

  if (IMAGE_FILE_EXTENSIONS.has(entry.extension)) {
    return <FileImage aria-hidden className="size-4 shrink-0 text-rose-500" />
  }

  if (["csv", "tsv", "xlsx", "xls"].includes(entry.extension)) {
    return (
      <FileSpreadsheet aria-hidden className="size-4 shrink-0 text-cyan-600" />
    )
  }

  if (["zip", "tar", "gz", "dmg"].includes(entry.extension)) {
    return <Archive aria-hidden className="size-4 shrink-0 text-amber-600" />
  }

  return <File aria-hidden className="size-4 shrink-0 text-muted-foreground" />
}
