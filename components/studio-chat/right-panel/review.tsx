"use client"

import * as React from "react"
import { RiExternalLinkLine } from "@remixicon/react"

import { UnifiedDiffView } from "@/components/studio-file-diff"
import { Button } from "@/components/ui/button"
import type {
  StudioOpenReviewPanelDetail,
  StudioReviewFileChange,
} from "@/lib/studio-review-panel"
import { cn } from "@/lib/utils"

import { createSidePanelEntryFromPath } from "../markdown-targets"
import type { StudioRightPanelLabels } from "./labels"
import { StudioSidePanelFileIcon } from "./files"

export function StudioReviewFileSection({
  change,
  labels,
  onOpenFile,
}: {
  change: StudioReviewFileChange
  labels: StudioRightPanelLabels
  onOpenFile: (path: string) => void
}) {
  const [open, setOpen] = React.useState(true)
  const entry = React.useMemo(
    () => createSidePanelEntryFromPath(change.path),
    [change.path]
  )
  const pathSegments = change.path.split(/[\\/]/)
  const basename = pathSegments.pop() ?? change.path
  const directory = pathSegments.length > 0 ? `${pathSegments.join("/")}/` : ""

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 bg-muted/40 px-3 py-2",
          open && "border-b border-border/70"
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((current) => !current)}
        >
          <StudioSidePanelFileIcon entry={entry} />
          <span
            className={cn(
              "min-w-0 truncate font-mono text-xs",
              change.kind === "delete" && "line-through opacity-70"
            )}
            title={change.path}
          >
            <span className="text-muted-foreground">{directory}</span>
            <span className="text-foreground">{basename}</span>
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
          <span className="text-emerald-600">+{change.additions}</span>
          <span className="text-destructive">-{change.deletions}</span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-6 shrink-0"
          aria-label={labels.reviewOpenFile}
          title={labels.reviewOpenFile}
          onClick={() => onOpenFile(change.path)}
        >
          <RiExternalLinkLine aria-hidden className="size-3.5" />
        </Button>
      </div>
      {open ? (
        <div className="overflow-x-auto">
          {change.diff?.trim() ? (
            <UnifiedDiffView
              diff={change.diff}
              unmodifiedLabel={labels.reviewUnmodifiedLines}
            />
          ) : (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {labels.noPreview}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function StudioReviewPanel({
  detail,
  labels,
  onOpenFile,
}: {
  detail: StudioOpenReviewPanelDetail
  labels: StudioRightPanelLabels
  onOpenFile: (path: string) => void
}) {
  const totals = detail.files.reduce(
    (sum, change) => ({
      additions: sum.additions + change.additions,
      deletions: sum.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 }
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b px-3 text-sm">
        <span className="font-medium">
          {detail.scopeLabel ?? labels.reviewScopeLastTurn}
        </span>
        <span className="flex items-center gap-1 font-mono text-xs tabular-nums">
          <span className="text-emerald-600">+{totals.additions}</span>
          <span className="text-destructive">-{totals.deletions}</span>
        </span>
      </div>
      {detail.files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {labels.reviewNoChanges}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          {detail.files.map((change) => (
            <StudioReviewFileSection
              key={change.path}
              change={change}
              labels={labels}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      )}
    </div>
  )
}
