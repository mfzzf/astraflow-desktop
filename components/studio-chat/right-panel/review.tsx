"use client"

import * as React from "react"
import { RiExternalLinkLine } from "@remixicon/react"

import { UnifiedDiffView } from "@/components/studio-file-diff"
import { Button } from "@/components/ui/button"
import type {
  StudioOpenReviewPanelDetail,
  StudioReviewFileChange,
} from "@/lib/studio-review-panel"
import type { StudioLocalProjectWithGitInfo } from "@/lib/studio-types"
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
    <section className="border-b border-border/70 last:border-b-0">
      <div
        className={cn(
          "flex min-h-12 min-w-0 items-center gap-2 bg-background px-4 py-2",
          open && "border-b border-border/40"
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
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
        <div className="overflow-x-auto bg-background">
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
    </section>
  )
}

export function StudioReviewPanel({
  detail,
  labels,
  project,
  onOpenFile,
}: {
  detail: StudioOpenReviewPanelDetail
  labels: StudioRightPanelLabels
  project: StudioLocalProjectWithGitInfo | null
  onOpenFile: (path: string) => void
}) {
  const totals = detail.files.reduce(
    (sum, change) => ({
      additions: sum.additions + change.additions,
      deletions: sum.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 }
  )
  const branch = project?.git.branch ?? "HEAD"
  const targetBranch =
    project?.git.remote && project.git.branch
      ? `${project.git.remote}/${project.git.branch}`
      : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-4">
        <div className="flex min-w-0 items-center gap-2.5 text-base">
          <span className="min-w-0 truncate font-semibold">
            {detail.scopeLabel ?? labels.reviewScopeLastTurn}
          </span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-sm tabular-nums">
            <span className="text-emerald-600">+{totals.additions}</span>
            <span className="text-destructive">-{totals.deletions}</span>
          </span>
        </div>
        {project ? (
          <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
            <span className="min-w-0 truncate font-mono">{branch}</span>
            {targetBranch ? (
              <>
                <span aria-hidden>→</span>
                <span className="min-w-0 truncate font-mono">
                  {targetBranch}
                </span>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {detail.files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {labels.reviewNoChanges}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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
