"use client"

import * as React from "react"
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  ExternalLink,
  Eye,
  Filter,
  FolderOpen,
  GitBranch,
  ListCollapse,
  Search,
} from "lucide-react"

import { UnifiedDiffView } from "@/components/studio-file-diff"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type {
  StudioOpenReviewPanelDetail,
  StudioReviewFileChange,
} from "@/lib/studio-review-panel"
import type { StudioLocalProjectWithGitInfo } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { createSidePanelEntryFromPath } from "../markdown-targets"
import type { StudioRightPanelLabels } from "./labels"
import { StudioSidePanelFileIcon } from "./files"

function ReviewToolbarButton({
  label,
  icon,
  active = false,
  disabled = false,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  active?: boolean
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={onClick ? active : undefined}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              "size-7 rounded-md text-token-description-foreground",
              active && "bg-muted text-foreground"
            )}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function ReviewPathLabel({
  path,
  deleted,
}: {
  path: string
  deleted: boolean
}) {
  const pathSegments = path.split(/[\\/]/)
  const basename = pathSegments.pop() ?? path
  const directory = pathSegments.length > 0 ? `${pathSegments.join("/")}/` : ""

  return (
    <span
      className={cn(
        "min-w-0 truncate [font-family:var(--diffs-font-family)] text-xs [direction:rtl]",
        deleted && "line-through opacity-70"
      )}
      title={path}
    >
      <span className="[direction:ltr] [unicode-bidi:plaintext]">
        <span className="text-token-text-tertiary">{directory}</span>
        <span className="text-token-text-primary">{basename}</span>
      </span>
    </span>
  )
}

export function StudioReviewFileSection({
  change,
  labels,
  onOpenFile,
  open: openProp,
  onOpenChange,
}: {
  change: StudioReviewFileChange
  labels: StudioRightPanelLabels
  onOpenFile: (path: string) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [openState, setOpenState] = React.useState(true)
  const open = openProp ?? openState
  const toggleOpen = () => {
    if (onOpenChange) {
      onOpenChange(!open)
    } else {
      setOpenState(!open)
    }
  }
  const [included, setIncluded] = React.useState(true)
  const entry = React.useMemo(
    () => createSidePanelEntryFromPath(change.path),
    [change.path]
  )

  return (
    <section
      className="group/file-diff border-b border-token-border-light last:border-b-0"
      style={{
        contentVisibility: "auto",
        containIntrinsicSize: "720px",
      }}
    >
      <div
        className={cn(
          "group/diff-header sticky top-0 z-10 flex min-h-10 min-w-0 items-center gap-2 border-b border-transparent py-0.5 ps-3 pe-2 text-size-chat backdrop-blur-sm transition-colors",
          "bg-[color-mix(in_srgb,var(--codex-diffs-surface)_88%,transparent)] hover:bg-token-list-hover-background"
        )}
      >
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded-md text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground"
          aria-expanded={open}
          onClick={toggleOpen}
        >
          {open ? (
            <ChevronDown aria-hidden className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden className="size-3.5" />
          )}
        </button>
        <StudioSidePanelFileIcon entry={entry} />
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          onClick={toggleOpen}
        >
          <ReviewPathLabel
            path={change.path}
            deleted={change.kind === "delete"}
          />
        </button>
        <span className="flex shrink-0 items-center gap-1 [font-family:var(--diffs-font-family)] text-xs tabular-nums">
          <span className="text-[var(--diffs-addition-base)]">
            +{change.additions}
          </span>
          <span className="text-[var(--diffs-deletion-base)]">
            -{change.deletions}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within/diff-header:opacity-100 group-hover/diff-header:opacity-100">
          <label
            className="grid size-7 place-items-center rounded-md text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground"
            title={labels.reviewIncludeFile}
          >
            <span className="sr-only">{labels.reviewIncludeFile}</span>
            <Checkbox
              checked={included}
              onCheckedChange={(value) => setIncluded(value === true)}
            />
          </label>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 rounded-md"
            aria-label={labels.reviewOpenFile}
            title={labels.reviewOpenFile}
            onClick={() => onOpenFile(change.path)}
          >
            <ExternalLink aria-hidden className="size-3.5" />
          </Button>
        </div>
      </div>
      {open ? (
        <div className="overflow-x-auto bg-[var(--diffs-bg)]">
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

function getReviewTotals(files: StudioReviewFileChange[]) {
  return files.reduce(
    (sum, change) => ({
      additions: sum.additions + change.additions,
      deletions: sum.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 }
  )
}

function getReviewBaseline(project: StudioLocalProjectWithGitInfo | null) {
  if (!project) {
    return null
  }

  const branch = project.git.branch ?? "HEAD"
  const targetBranch =
    project.git.remote && project.git.branch
      ? `${project.git.remote}/${project.git.branch}`
      : project.git.remote

  return {
    branch,
    targetBranch,
    ahead: project.git.ahead,
    behind: project.git.behind,
  }
}

const REVIEW_FILE_KINDS = ["create", "edit", "delete"] as const

type ReviewFileKind = (typeof REVIEW_FILE_KINDS)[number]

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
  const totals = React.useMemo(
    () => getReviewTotals(detail.files),
    [detail.files]
  )
  const baseline = getReviewBaseline(project)
  const [openState, setOpenState] = React.useState<Record<string, boolean>>({})
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [hiddenKinds, setHiddenKinds] = React.useState<
    ReadonlySet<ReviewFileKind>
  >(() => new Set())

  const visibleFiles = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return detail.files.filter((change) => {
      if (hiddenKinds.has(change.kind)) {
        return false
      }

      return !query || change.path.toLowerCase().includes(query)
    })
  }, [detail.files, hiddenKinds, searchQuery])

  const anyOpen = visibleFiles.some((change) => openState[change.path] ?? true)

  const handleToggleCollapseAll = () => {
    const next: Record<string, boolean> = {}

    for (const change of detail.files) {
      next[change.path] = !anyOpen
    }

    setOpenState(next)
  }

  const handleToggleSearch = () => {
    setSearchOpen((current) => {
      if (current) {
        setSearchQuery("")
      }

      return !current
    })
  }

  const handleToggleKind = (kind: ReviewFileKind) => {
    setHiddenKinds((current) => {
      const next = new Set(current)

      if (next.has(kind)) {
        next.delete(kind)
      } else {
        next.add(kind)
      }

      return next
    })
  }

  const kindFilterLabels: Record<ReviewFileKind, string> = {
    create: labels.reviewFilterCreated,
    edit: labels.reviewFilterEdited,
    delete: labels.reviewFilterDeleted,
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-col gap-2 border-b border-token-border-light bg-token-main-surface-primary px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 max-w-52 gap-1.5 rounded-md px-2 text-xs"
              >
                <GitBranch aria-hidden className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate [font-family:var(--diffs-font-family)]">
                  {baseline?.branch ?? detail.scopeLabel ?? labels.review}
                </span>
                <ChevronDown aria-hidden className="size-3 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-72">
              <DropdownMenuLabel>{labels.envBranches}</DropdownMenuLabel>
              {(project?.git.branches ?? []).map((branch) => (
                <DropdownMenuItem key={branch} disabled>
                  <span className="truncate [font-family:var(--diffs-font-family)] text-xs">{branch}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <span className="flex shrink-0 items-center gap-1 [font-family:var(--diffs-font-family)] text-sm tabular-nums">
            <span className="text-[var(--diffs-addition-base)]">
              +{totals.additions}
            </span>
            <span className="text-[var(--diffs-deletion-base)]">
              -{totals.deletions}
            </span>
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-0.5">
            <ReviewToolbarButton
              label={labels.reviewViewOptions}
              icon={<Eye aria-hidden className="size-3.5" />}
              disabled
            />
            <ReviewToolbarButton
              label={anyOpen ? labels.reviewCollapseAll : labels.reviewExpandAll}
              icon={<ListCollapse aria-hidden className="size-3.5" />}
              disabled={detail.files.length === 0}
              onClick={handleToggleCollapseAll}
            />
            <ReviewToolbarButton
              label={labels.reviewSearch}
              icon={<Search aria-hidden className="size-3.5" />}
              active={searchOpen}
              disabled={detail.files.length === 0}
              onClick={handleToggleSearch}
            />
            <ReviewToolbarButton
              label={labels.reviewViewToggle}
              icon={<Columns2 aria-hidden className="size-3.5" />}
              disabled
            />
            <ReviewToolbarButton
              label={labels.reviewFiles}
              icon={<FolderOpen aria-hidden className="size-3.5" />}
              disabled
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={labels.reviewFilter}
                  title={labels.reviewFilter}
                  disabled={detail.files.length === 0}
                  className={cn(
                    "size-7 rounded-md text-token-description-foreground",
                    hiddenKinds.size > 0 && "bg-muted text-foreground"
                  )}
                >
                  <Filter aria-hidden className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{labels.reviewFilter}</DropdownMenuLabel>
                {REVIEW_FILE_KINDS.map((kind) => (
                  <DropdownMenuCheckboxItem
                    key={kind}
                    checked={!hiddenKinds.has(kind)}
                    onCheckedChange={() => handleToggleKind(kind)}
                    onSelect={(event) => event.preventDefault()}
                  >
                    {kindFilterLabels[kind]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {searchOpen ? (
          <Input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation()
                handleToggleSearch()
              }
            }}
            placeholder={labels.reviewSearchPlaceholder}
            className="h-7 rounded-md text-xs"
          />
        ) : null}

        {baseline ? (
          <div className="flex min-w-0 items-center gap-2 text-xs text-token-text-secondary">
            <span className="min-w-0 truncate [font-family:var(--diffs-font-family)]">{baseline.branch}</span>
            {baseline.targetBranch ? (
              <>
                <span aria-hidden>→</span>
                <span className="min-w-0 truncate [font-family:var(--diffs-font-family)]">
                  {baseline.targetBranch}
                </span>
              </>
            ) : null}
            {baseline.ahead != null || baseline.behind != null ? (
              <span className="shrink-0 text-token-text-tertiary">
                {baseline.ahead ?? 0} ahead · {baseline.behind ?? 0} behind
              </span>
            ) : null}
          </div>
        ) : null}
        {detail.truncated ? (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
            {labels.reviewTruncated}
          </div>
        ) : null}
      </div>
      {detail.files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {labels.reviewNoChanges}
        </div>
      ) : visibleFiles.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          {labels.reviewNoMatches}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {visibleFiles.map((change) => (
            <StudioReviewFileSection
              key={change.path}
              change={change}
              labels={labels}
              onOpenFile={onOpenFile}
              open={openState[change.path] ?? true}
              onOpenChange={(open) =>
                setOpenState((current) => ({ ...current, [change.path]: open }))
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
