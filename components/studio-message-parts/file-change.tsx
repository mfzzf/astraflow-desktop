import * as React from "react"
import { RiArrowDownSLine, RiFileEditLine } from "@remixicon/react"

import { countContentLines, synthesizeAdditionsDiff } from "@/components/studio-file-diff"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  openStudioReviewPanel,
  type StudioReviewFileChange,
} from "@/lib/studio-review-panel"
import { cn } from "@/lib/utils"

import {
  FileChangeStats,
  FileTypeBadge,
  getFilePathName,
} from "./file-output"
import { assistantTraceContainerClassName, isZhLocale } from "./shared"
import type { StudioFilePart } from "./types"

function getFilePartStats(part: StudioFilePart) {
  if (part.stats) {
    return part.stats
  }

  if (!part.diff) {
    // Files written outside a git repository carry no diff; count the
    // written content as additions so the UI never shows a bare +0 -0.
    if (part.kind !== "delete" && part.content) {
      return { additions: countContentLines(part.content), deletions: 0 }
    }

    return { additions: 0, deletions: 0 }
  }

  let additions = 0
  let deletions = 0

  for (const line of part.diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue
    }

    if (line.startsWith("+")) {
      additions += 1
      continue
    }

    if (line.startsWith("-")) {
      deletions += 1
    }
  }

  return { additions, deletions }
}

function getFilePartDiff(part: StudioFilePart) {
  if (part.diff?.trim()) {
    return part.diff
  }

  if (part.kind !== "delete" && part.content) {
    return synthesizeAdditionsDiff(part.path, part.content)
  }

  return null
}

function getFileChangeVerb({
  kind,
  isZh,
}: {
  kind: StudioFilePart["kind"]
  isZh: boolean
}) {
  if (kind === "create") {
    return isZh ? "\u5df2\u521b\u5efa" : "Created"
  }

  if (kind === "delete") {
    return isZh ? "\u5df2\u5220\u9664" : "Deleted"
  }

  return isZh ? "\u5df2\u66f4\u65b0" : "Updated"
}

function AssistantFileChangeRow({ part }: { part: StudioFilePart }) {
  const { t } = useI18n()
  const isZh = isZhLocale(t)
  const stats = getFilePartStats(part)
  const hasError = part.status === "error"

  function handleOpenDiff() {
    const changes = aggregateTurnFileChanges([part])

    if (changes.length > 0) {
      openStudioReviewPanel({ scopeLabel: null, files: changes })
    }
  }

  return (
    <button
      type="button"
      title={part.error ?? part.path}
      onClick={handleOpenDiff}
      className={cn(
        "flex min-h-6 w-full min-w-0 items-center gap-1.5 text-left text-sm leading-6 text-muted-foreground transition-colors hover:text-foreground",
        hasError && "text-destructive hover:text-destructive"
      )}
    >
      <span className="shrink-0">
        {getFileChangeVerb({ kind: part.kind, isZh })}
      </span>
      <FileTypeBadge path={part.path} />
      <span
        className={cn(
          "min-w-0 truncate font-medium text-foreground",
          part.kind === "delete" && "line-through opacity-70",
          hasError && "text-destructive"
        )}
      >
        {getFilePathName(part.path)}
      </span>
      <FileChangeStats
        additions={stats.additions}
        deletions={stats.deletions}
      />
    </button>
  )
}

export function AssistantFileChangeGroup({ files }: { files: StudioFilePart[] }) {
  const { t } = useI18n()
  const isZh = isZhLocale(t)
  const [open, setOpen] = React.useState(true)

  if (files.length === 0) {
    return null
  }

  if (files.length === 1) {
    return (
      <div
        className={cn(
          assistantTraceContainerClassName,
          "flex min-w-0 items-center gap-2 text-sm"
        )}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <RiFileEditLine aria-hidden className="size-4" />
        </span>
        <AssistantFileChangeRow part={files[0]} />
      </div>
    )
  }

  const verb = getFileChangeVerb({
    kind: files.every((file) => file.kind === "create") ? "create" : "edit",
    isZh,
  })

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(assistantTraceContainerClassName, "flex flex-col")}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-7 w-fit max-w-full items-center gap-2 text-sm leading-6 text-muted-foreground transition-colors hover:text-foreground"
        >
          <span className="flex size-5 shrink-0 items-center justify-center">
            <RiFileEditLine aria-hidden className="size-4" />
          </span>
          <span className="shrink-0 font-medium text-foreground">{verb}</span>
          <span className="min-w-0 truncate">
            {isZh
              ? `${files.length} \u4e2a\u6587\u4ef6`
              : `${files.length} file${files.length === 1 ? "" : "s"}`}
          </span>
          <RiArrowDownSLine
            aria-hidden
            className={cn(
              "size-4 shrink-0 transition-transform",
              !open && "-rotate-90"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 ml-2.5 flex flex-col gap-0.5 border-l border-border/70 pl-4">
          {files.map((file) => (
            <AssistantFileChangeRow key={file.id} part={file} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function aggregateTurnFileChanges(
  files: StudioFilePart[]
): StudioReviewFileChange[] {
  const changes = new Map<string, StudioReviewFileChange>()

  for (const file of files) {
    if (file.status === "error") {
      continue
    }

    const stats = getFilePartStats(file)
    const hasRealDiff = Boolean(file.diff?.trim())
    const diff = getFilePartDiff(file)
    const existing = changes.get(file.path)

    if (!existing) {
      changes.set(file.path, {
        path: file.path,
        kind: file.kind,
        additions: stats.additions,
        deletions: stats.deletions,
        diff,
      })
      continue
    }

    existing.kind = file.kind === "create" ? existing.kind : file.kind

    if (hasRealDiff) {
      existing.additions += stats.additions
      existing.deletions += stats.deletions
      existing.diff = [existing.diff, diff]
        .filter((entry): entry is string => Boolean(entry))
        .join("\n")
      continue
    }

    // A synthesized diff reflects the file's entire written content, so a
    // repeated write replaces the previous entry instead of stacking on it.
    existing.additions = stats.additions
    existing.deletions = stats.deletions
    existing.diff = diff ?? existing.diff
  }

  return [...changes.values()]
}

function splitFilePathLabel(path: string) {
  const segments = path.split(/[\\/]/)
  const basename = segments.pop() ?? path

  return {
    directory: segments.length > 0 ? `${segments.join("/")}/` : "",
    basename,
  }
}

const TURN_EDITED_FILES_VISIBLE_COUNT = 3

function TurnEditedFilesRow({
  change,
  onOpenReview,
}: {
  change: StudioReviewFileChange
  onOpenReview: () => void
}) {
  const { directory, basename } = splitFilePathLabel(change.path)

  return (
    <button
      type="button"
      onClick={onOpenReview}
      className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-1.5 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <span
        className={cn(
          "min-w-0 truncate",
          change.kind === "delete" && "line-through opacity-70"
        )}
        title={change.path}
      >
        <span className="text-muted-foreground">{directory}</span>
        <span className="text-foreground">{basename}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
        <span className="text-emerald-600">+{change.additions}</span>
        <span className="text-destructive">-{change.deletions}</span>
      </span>
    </button>
  )
}

export function TurnEditedFilesCard({ files }: { files: StudioFilePart[] }) {
  const { t } = useI18n()
  const isZh = isZhLocale(t)
  const [expanded, setExpanded] = React.useState(false)
  const changes = React.useMemo(() => aggregateTurnFileChanges(files), [files])
  const totals = React.useMemo(
    () =>
      changes.reduce(
        (sum, change) => ({
          additions: sum.additions + change.additions,
          deletions: sum.deletions + change.deletions,
        }),
        { additions: 0, deletions: 0 }
      ),
    [changes]
  )

  if (changes.length === 0) {
    return null
  }

  const visibleChanges = expanded
    ? changes
    : changes.slice(0, TURN_EDITED_FILES_VISIBLE_COUNT)
  const hiddenCount = changes.length - TURN_EDITED_FILES_VISIBLE_COUNT

  function handleReview() {
    openStudioReviewPanel({
      scopeLabel: isZh ? "本轮变更" : "Last turn",
      files: changes,
    })
  }

  return (
    <section className="not-prose mt-2 overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
            <RiFileEditLine aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {isZh
                ? `已编辑 ${changes.length} 个文件`
                : `Edited ${changes.length} file${changes.length === 1 ? "" : "s"}`}
            </p>
            <p className="flex items-center gap-1.5 font-mono text-xs tabular-nums">
              <span className="text-emerald-600">+{totals.additions}</span>
              <span className="text-destructive">-{totals.deletions}</span>
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 rounded-lg"
          onClick={handleReview}
        >
          {isZh ? "审查" : "Review"}
        </Button>
      </div>
      <div className="border-t py-1.5">
        {visibleChanges.map((change) => (
          <TurnEditedFilesRow
            key={change.path}
            change={change}
            onOpenReview={handleReview}
          />
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="flex w-full items-center gap-1 px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <span>
              {expanded
                ? isZh
                  ? "收起"
                  : "Show less"
                : isZh
                  ? `展开其余 ${hiddenCount} 个文件`
                  : `Show ${hiddenCount} more file${hiddenCount === 1 ? "" : "s"}`}
            </span>
            <RiArrowDownSLine
              aria-hidden
              className={cn(
                "size-4 transition-transform",
                expanded && "rotate-180"
              )}
            />
          </button>
        ) : null}
      </div>
    </section>
  )
}
