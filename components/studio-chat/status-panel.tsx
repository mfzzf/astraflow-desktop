"use client"

import * as React from "react"
import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiFileTextLine,
  RiLoader4Line,
  RiRefreshLine,
} from "@remixicon/react"
import {
  Archive,
  Diff,
  Ellipsis,
  File,
  FileImage,
  FileSpreadsheet,
  GitBranch,
  GitCommitHorizontal,
} from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type {
  StudioLocalProjectWithGitInfo,
  StudioMessageTodo,
  StudioTokenUsage,
} from "@/lib/studio-types"

import type { StudioRightPanelLabels } from "./right-panel/labels"
import type { StudioFileChangeSummary, StudioOutputFile } from "./types"

export function formatStudioTokenCount(count: number) {
  if (count >= 1_000_000) {
    const value = count / 1_000_000
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)}M`
  }

  if (count >= 1_000) {
    return `${Math.round(count / 1_000)}K`
  }

  return `${count}`
}

export function StudioStatusPanel({
  open,
  project,
  files,
  changes,
  labels,
  goalTitle,
  todos,
  usage,
  running,
  loadingChanges,
  onClose,
  onOpenChanges,
  onRefresh,
}: {
  open: boolean
  project: StudioLocalProjectWithGitInfo | null
  files: StudioOutputFile[]
  changes: StudioFileChangeSummary[]
  labels: StudioRightPanelLabels
  goalTitle: string | null
  todos: StudioMessageTodo[]
  usage: StudioTokenUsage | null
  running: boolean
  loadingChanges: boolean
  onClose: () => void
  onOpenChanges: () => Promise<void> | void
  onRefresh: () => Promise<void> | void
}) {
  const { locale, t } = useI18n()
  const [commitDialogOpen, setCommitDialogOpen] = React.useState(false)
  const [commitMessage, setCommitMessage] = React.useState("")
  const [gitActionPending, setGitActionPending] = React.useState(false)
  const [gitSectionOpen, setGitSectionOpen] = React.useState(true)
  const [goalSectionOpen, setGoalSectionOpen] = React.useState(true)
  const [progressSectionOpen, setProgressSectionOpen] = React.useState(true)
  const [changesSectionOpen, setChangesSectionOpen] = React.useState(true)
  const [sourcesSectionOpen, setSourcesSectionOpen] = React.useState(true)
  const visibleFiles = files.slice(0, 8)
  const overflowCount = Math.max(0, files.length - visibleFiles.length)
  const visibleChanges = changes.slice(0, 5)
  const overflowChangeCount = Math.max(
    0,
    changes.length - visibleChanges.length
  )
  const changeTotals = changes.reduce(
    (sum, change) => ({
      additions: sum.additions + change.additions,
      deletions: sum.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 }
  )
  const git = project?.git ?? null
  const hasGitRepository = Boolean(
    git?.branch || git?.remote || git?.branches?.length
  )
  const hasGitChanges =
    hasGitRepository &&
    (git?.isDirty === true ||
      (git?.changedFiles ?? 0) > 0 ||
      (git?.additions ?? 0) > 0 ||
      (git?.deletions ?? 0) > 0)
  const hasPanelChanges = hasGitChanges || changes.length > 0
  const hasGoalSection = Boolean(goalTitle)
  const hasProgressSection = todos.length > 0
  const hasChangesSection = changes.length > 0
  const completedTodoCount = todos.filter(
    (todo) => todo.status === "completed"
  ).length
  const goalMeta = [
    todos.length > 0 ? `${completedTodoCount}/${todos.length}` : null,
    usage && usage.totalTokens > 0
      ? `${formatStudioTokenCount(usage.totalTokens)} tokens`
      : null,
  ].filter(Boolean)
  const fileChangeSummary =
    changes.length > 0
      ? locale === "zh"
        ? `${changes.length} 个文件`
        : `${changes.length} ${changes.length === 1 ? "file" : "files"}`
      : null

  function handleOpenPath(path: string) {
    if (window.astraflowDesktop?.sidePanelShowItem) {
      void window.astraflowDesktop.sidePanelShowItem(path)
      return
    }

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(path)
      toast.success(t.studioOutputPathCopied)
      return
    }

    toast.error(path)
  }

  async function handleGitAction(
    action: "commit" | "push" | "commit-and-push"
  ) {
    if (!project || gitActionPending) {
      return
    }

    setGitActionPending(true)

    try {
      const response = await fetch("/api/studio/local-projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: project.id,
          action,
          message: commitMessage.trim() || undefined,
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: string
      } | null

      if (!response.ok || !payload?.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : labels.envGitActionFailed
        )
      }

      toast.success(labels.envGitActionSucceeded)
      setCommitDialogOpen(false)
      setCommitMessage("")
      await onRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : labels.envGitActionFailed
      )
    } finally {
      setGitActionPending(false)
    }
  }

  const environmentRowClassName =
    "flex h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-[13px] text-foreground/90 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"

  if (!open || !hasPanelChanges) {
    return null
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-[calc(var(--titlebar-height)+0.75rem)] bottom-3 z-30 flex justify-end px-3 sm:px-4">
      <aside
        aria-label={labels.envGitTools}
        className="pointer-events-auto relative flex max-h-full w-80 max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-2xl border bg-popover/98 text-popover-foreground shadow-md ring-1 ring-foreground/5 transition-[border-radius,background-color,box-shadow] duration-300 sm:max-h-[36rem]"
      >
        <button
          type="button"
          className="absolute top-2 right-2 z-10 grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-label={labels.closePanel}
          title={labels.closePanel}
          onClick={onClose}
        >
          <RiCloseLine aria-hidden className="size-3.5" />
        </button>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {project && hasGitChanges ? (
            <StudioStatusPanelSection
              title={labels.envGitTools}
              open={gitSectionOpen}
              onOpenChange={setGitSectionOpen}
              summary={
                <StudioStatusDeltaSummary
                  additions={git?.additions ?? 0}
                  deletions={git?.deletions ?? 0}
                />
              }
              action={
                <button
                  type="button"
                  className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  aria-label={labels.forceReload}
                  title={labels.forceReload}
                  onClick={() => void onRefresh()}
                >
                  <RiRefreshLine aria-hidden className="size-3.5" />
                </button>
              }
            >
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  className={environmentRowClassName}
                  onClick={() => void onOpenChanges()}
                >
                  <Diff aria-hidden className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {labels.envChanges}
                  </span>
                  {loadingChanges ? (
                    <RiLoader4Line
                      aria-hidden
                      className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                    />
                  ) : git?.additions != null || git?.deletions != null ? (
                    <StudioStatusDeltaSummary
                      additions={git?.additions ?? 0}
                      deletions={git?.deletions ?? 0}
                    />
                  ) : null}
                </button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={environmentRowClassName}>
                      <GitBranch aria-hidden className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">
                        {git?.branch ?? labels.envBranches}
                      </span>
                      <RiArrowDownSLine
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-w-72">
                    <DropdownMenuLabel>{labels.envBranches}</DropdownMenuLabel>
                    {(git?.branches ?? []).map((branch) => (
                      <DropdownMenuItem key={branch} disabled>
                        <span
                          className={cn(
                            "truncate font-mono text-xs",
                            branch === git?.branch && "font-semibold"
                          )}
                        >
                          {branch}
                        </span>
                        {branch === git?.branch ? (
                          <RiCheckLine
                            aria-hidden
                            className="ml-auto size-3.5"
                          />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                    {git?.remoteUrl ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>
                          {labels.envRemote}
                        </DropdownMenuLabel>
                        <DropdownMenuItem
                          onSelect={() => {
                            if (git?.remoteUrl) {
                              void navigator.clipboard?.writeText(git.remoteUrl)
                            }
                          }}
                        >
                          <span className="truncate font-mono text-xs">
                            {git.remoteUrl}
                          </span>
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>

                <button
                  type="button"
                  className={environmentRowClassName}
                  onClick={() => setCommitDialogOpen(true)}
                >
                  <GitCommitHorizontal
                    aria-hidden
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {labels.envCommitOrPush}
                  </span>
                  <Ellipsis
                    aria-hidden
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                </button>
              </div>
            </StudioStatusPanelSection>
          ) : null}

          {goalTitle ? (
            <StudioStatusPanelSection
              title={labels.envGoal}
              open={goalSectionOpen}
              onOpenChange={setGoalSectionOpen}
              separated={hasGitChanges}
              summary={
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    running ? "text-muted-foreground" : "text-emerald-600"
                  )}
                >
                  {running ? labels.envStatusRunning : labels.envStatusComplete}
                </span>
              }
            >
              <div className="px-2 pb-1">
                <p
                  className="truncate text-[13px] font-medium text-foreground"
                  title={goalTitle}
                >
                  {goalTitle}
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "flex items-center gap-1",
                      running ? "text-muted-foreground" : "text-emerald-600"
                    )}
                  >
                    {running ? (
                      <RiLoader4Line
                        aria-hidden
                        className="size-3 animate-spin"
                      />
                    ) : (
                      <RiCheckLine aria-hidden className="size-3" />
                    )}
                    {running
                      ? labels.envStatusRunning
                      : labels.envStatusComplete}
                  </span>
                  {goalMeta.length > 0 ? (
                    <span className="text-muted-foreground tabular-nums">
                      {goalMeta.join(" · ")}
                    </span>
                  ) : null}
                </div>
              </div>
            </StudioStatusPanelSection>
          ) : null}

          {todos.length > 0 ? (
            <StudioStatusPanelSection
              title={labels.envProgress}
              open={progressSectionOpen}
              onOpenChange={setProgressSectionOpen}
              separated={hasGitChanges || hasGoalSection}
              summary={
                <span className="text-xs text-muted-foreground tabular-nums">
                  {completedTodoCount}/{todos.length}
                </span>
              }
            >
              <ul className="flex flex-col gap-1.5 px-2 pb-1">
                {todos.map((todo, index) => (
                  <li
                    key={`${index}-${todo.text}`}
                    className="flex items-start gap-2 text-[13px]"
                  >
                    {todo.status === "completed" ? (
                      <RiCheckLine
                        aria-hidden
                        className="mt-0.5 size-3.5 shrink-0 text-emerald-600"
                      />
                    ) : todo.status === "in_progress" ? (
                      <RiLoader4Line
                        aria-hidden
                        className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="mt-1 ml-0.5 size-2.5 shrink-0 rounded-full border border-muted-foreground/50"
                      />
                    )}
                    <span
                      className={cn(
                        "min-w-0 flex-1 break-words",
                        todo.status === "completed" && "text-muted-foreground"
                      )}
                    >
                      {todo.text}
                    </span>
                  </li>
                ))}
              </ul>
            </StudioStatusPanelSection>
          ) : null}

          {changes.length > 0 ? (
            <StudioStatusPanelSection
              title={labels.envChanges}
              open={changesSectionOpen}
              onOpenChange={setChangesSectionOpen}
              separated={hasGitChanges || hasGoalSection || hasProgressSection}
              summary={
                <span className="flex items-center gap-2">
                  {fileChangeSummary ? (
                    <span className="text-xs text-muted-foreground">
                      {fileChangeSummary}
                    </span>
                  ) : null}
                  <StudioStatusDeltaSummary
                    additions={changeTotals.additions}
                    deletions={changeTotals.deletions}
                  />
                </span>
              }
            >
              <div className="flex flex-col gap-0.5">
                {visibleChanges.map((change) => (
                  <button
                    key={change.path}
                    type="button"
                    title={change.path}
                    className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                    onClick={() => void onOpenChanges()}
                  >
                    <StudioFileChangeIcon
                      change={change}
                      className="size-3.5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {change.name}
                    </span>
                    <StudioStatusDeltaSummary
                      additions={change.additions}
                      deletions={change.deletions}
                    />
                  </button>
                ))}
                {overflowChangeCount > 0 ? (
                  <div className="px-2 pt-1 text-xs text-muted-foreground">
                    +{overflowChangeCount}
                  </div>
                ) : null}
              </div>
            </StudioStatusPanelSection>
          ) : null}

          {files.length > 0 ? (
            <StudioStatusPanelSection
              title={labels.envSources}
              open={sourcesSectionOpen}
              onOpenChange={setSourcesSectionOpen}
              separated={
                hasGitChanges ||
                hasGoalSection ||
                hasProgressSection ||
                hasChangesSection
              }
              summary={
                <span className="text-xs text-muted-foreground tabular-nums">
                  {files.length}
                </span>
              }
            >
              <div className="flex flex-col gap-0.5">
                {visibleFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    title={file.path}
                    className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                    onClick={() => handleOpenPath(file.path)}
                  >
                    <RiFileTextLine aria-hidden className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  </button>
                ))}
                {overflowCount > 0 ? (
                  <div className="mt-1 px-2 text-xs text-muted-foreground">
                    {t.studioOutputsOverflow(overflowCount)}
                  </div>
                ) : null}
              </div>
            </StudioStatusPanelSection>
          ) : null}
        </div>

        {project && hasGitChanges ? (
          <Dialog open={commitDialogOpen} onOpenChange={setCommitDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{labels.envCommitOrPush}</DialogTitle>
                <DialogDescription className="truncate">
                  {project.path}
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={commitMessage}
                onChange={(event) => setCommitMessage(event.target.value)}
                placeholder={labels.envCommitMessagePlaceholder}
                rows={3}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={gitActionPending}
                  onClick={() => void handleGitAction("push")}
                >
                  {labels.envPushAction}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={gitActionPending || !commitMessage.trim()}
                  onClick={() => void handleGitAction("commit")}
                >
                  {labels.envCommitAction}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    gitActionPending || !commitMessage.trim() || !git?.remote
                  }
                  onClick={() => void handleGitAction("commit-and-push")}
                >
                  {labels.envCommitAndPushAction}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </aside>
    </div>
  )
}

export function StudioStatusPanelSection({
  title,
  open,
  onOpenChange,
  summary,
  action,
  separated = false,
  children,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  summary?: React.ReactNode
  action?: React.ReactNode
  separated?: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className={cn("min-w-0", separated && "mt-2 border-t pt-2")}
    >
      <div className="flex h-8 min-w-0 items-center gap-2 px-2 pr-8">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="group flex min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            {open ? (
              <RiArrowDownSLine
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-muted-foreground"
              />
            ) : (
              <RiArrowRightSLine
                aria-hidden
                className="size-3.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-muted-foreground"
              />
            )}
            <span className="min-w-0 truncate text-[13px] font-medium text-muted-foreground">
              {title}
            </span>
          </button>
        </CollapsibleTrigger>
        {!open && summary ? <div className="shrink-0">{summary}</div> : null}
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="pb-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function StudioStatusDeltaSummary({
  additions,
  deletions,
  className,
}: {
  additions: number
  deletions: number
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums",
        className
      )}
    >
      <span className="text-emerald-600">+{additions}</span>
      <span className="text-destructive">-{deletions}</span>
    </span>
  )
}

export function StudioFileChangeIcon({
  change,
  className,
}: {
  change: StudioFileChangeSummary
  className?: string
}) {
  if (change.kind === "delete") {
    return <Archive aria-hidden className={className} />
  }

  const extension = change.name.split(".").pop()?.toLowerCase() ?? ""

  if (
    ["avif", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"].includes(
      extension
    )
  ) {
    return <FileImage aria-hidden className={className} />
  }

  if (["csv", "tsv", "xls", "xlsx"].includes(extension)) {
    return <FileSpreadsheet aria-hidden className={className} />
  }

  return <File aria-hidden className={className} />
}

export function StudioFileChangeCard({
  changes,
  labels,
  onOpenChanges,
}: {
  changes: StudioFileChangeSummary[]
  labels: StudioRightPanelLabels
  onOpenChanges: () => Promise<void> | void
}) {
  const { locale } = useI18n()
  const totals = changes.reduce(
    (sum, change) => ({
      additions: sum.additions + change.additions,
      deletions: sum.deletions + change.deletions,
    }),
    { additions: 0, deletions: 0 }
  )
  const visibleChanges = changes.slice(0, 6)
  const overflowCount = Math.max(0, changes.length - visibleChanges.length)
  const summary =
    locale === "zh"
      ? `${changes.length} 个文件已更改`
      : `${changes.length} ${changes.length === 1 ? "file" : "files"} changed`
  const revertLabel = locale === "zh" ? "撤销" : "Undo"

  return (
    <div className="w-full overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-sm">
      <div className="flex h-11 items-center justify-between gap-3 border-b px-4">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left text-sm font-semibold"
          onClick={() => void onOpenChanges()}
        >
          <span className="min-w-0 truncate">{summary}</span>
          <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
            <span className="text-emerald-600">+{totals.additions}</span>
            <span className="text-destructive">-{totals.deletions}</span>
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled
          className="h-7 rounded-lg px-2 text-xs"
        >
          {revertLabel}
        </Button>
      </div>
      <div className="divide-y">
        {visibleChanges.map((change) => (
          <button
            key={change.path}
            type="button"
            title={change.path}
            className="flex h-10 w-full min-w-0 items-center gap-3 px-4 text-left text-sm transition-colors hover:bg-muted/60"
            onClick={() => void onOpenChanges()}
          >
            <StudioFileChangeIcon
              change={change}
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {change.name}
            </span>
            <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
              <span className="text-emerald-600">+{change.additions}</span>
              <span className="text-destructive">-{change.deletions}</span>
            </span>
          </button>
        ))}
        {overflowCount > 0 ? (
          <button
            type="button"
            className="flex h-9 w-full items-center justify-center text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            onClick={() => void onOpenChanges()}
          >
            {labels.envChanges} +{overflowCount}
          </button>
        ) : null}
      </div>
    </div>
  )
}
