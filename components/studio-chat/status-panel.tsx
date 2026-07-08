"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiFileTextLine,
  RiLoader4Line,
} from "@remixicon/react"
import {
  Archive,
  Ellipsis,
  File,
  FileImage,
  FileSpreadsheet,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  SquarePlus,
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
  onOpenChanges,
  onOpenSources,
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
  onOpenChanges: () => Promise<void> | void
  onOpenSources: () => void
  onRefresh: () => Promise<void> | void
}) {
  const { locale, t } = useI18n()
  const [commitDialogOpen, setCommitDialogOpen] = React.useState(false)
  const [commitMessage, setCommitMessage] = React.useState("")
  const [gitActionPending, setGitActionPending] = React.useState(false)
  const [environmentSectionOpen, setEnvironmentSectionOpen] =
    React.useState(true)
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
  const hasGitRepository = Boolean(git)
  const hasGitChanges =
    hasGitRepository &&
    (git?.isDirty === true ||
      (git?.changedFiles ?? 0) > 0 ||
      (git?.additions ?? 0) > 0 ||
      (git?.deletions ?? 0) > 0)
  const hasPanelChanges = hasGitChanges || changes.length > 0
  const hasEnvironmentSection = Boolean(project)
  const hasGoalSection = Boolean(goalTitle)
  const hasProgressSection = todos.length > 0
  const hasChangesSection = changes.length > 0
  const hasPanelContent =
    hasEnvironmentSection ||
    hasPanelChanges ||
    files.length > 0 ||
    hasGoalSection ||
    hasProgressSection ||
    Boolean(usage && usage.totalTokens > 0)
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
    "group flex h-9 w-full min-w-0 items-center gap-3 rounded-md px-1.5 text-left text-base font-medium text-foreground/90 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-default disabled:text-muted-foreground/65 disabled:hover:bg-transparent"
  const rowIconClassName = "size-[18px] shrink-0 text-current"
  const hasGitStats =
    git?.additions != null ||
    git?.deletions != null ||
    changeTotals.additions > 0 ||
    changeTotals.deletions > 0
  const visibleAdditions =
    git?.additions ?? (changeTotals.additions > 0 ? changeTotals.additions : 0)
  const visibleDeletions =
    git?.deletions ?? (changeTotals.deletions > 0 ? changeTotals.deletions : 0)

  if (!open || !hasPanelContent) {
    return null
  }

  return (
    <div className="pointer-events-none absolute top-[calc(var(--titlebar-height)+0.75rem)] right-0 bottom-3 z-30 flex items-start justify-end pr-3 sm:pr-4">
      <aside
        data-pip-obstacle="thread-summary-panel"
        aria-label={labels.envEnvironmentInfo}
        className="pointer-events-auto relative flex h-fit max-h-full w-[300px] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-3xl border border-border/65 bg-popover/98 pt-3 text-popover-foreground shadow-xl shadow-foreground/10 ring-1 ring-foreground/5 backdrop-blur transition-[opacity,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      >
        <div className="flex h-fit max-h-full min-h-0 flex-col gap-3 overflow-y-auto pb-3">
          {hasEnvironmentSection ? (
            <StudioStatusPanelSection
              title={labels.envEnvironmentInfo}
              open={environmentSectionOpen}
              onOpenChange={setEnvironmentSectionOpen}
              showToggle={false}
              summary={
                hasGitStats ? (
                  <StudioStatusDeltaSummary
                    additions={visibleAdditions}
                    deletions={visibleDeletions}
                  />
                ) : null
              }
              action={
                <button
                  type="button"
                  className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  aria-label={labels.envAddSource}
                  title={labels.envAddSource}
                  onClick={onOpenSources}
                >
                  <RiAddLine aria-hidden className="size-5" />
                </button>
              }
            >
              <div className="flex flex-col gap-0.5 px-4">
                <button
                  type="button"
                  className={environmentRowClassName}
                  onClick={() => void onOpenChanges()}
                  disabled={!hasPanelChanges && !hasGitRepository}
                >
                  <SquarePlus aria-hidden className={rowIconClassName} />
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
                  ) : changeTotals.additions > 0 ||
                    changeTotals.deletions > 0 ? (
                    <StudioStatusDeltaSummary
                      additions={changeTotals.additions}
                      deletions={changeTotals.deletions}
                    />
                  ) : null}
                </button>

                {hasGitRepository ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={environmentRowClassName}>
                        <Globe aria-hidden className={rowIconClassName} />
                        <span className="min-w-0 flex-1 truncate">
                          {labels.envRemote}
                        </span>
                        <RiArrowDownSLine
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-w-72">
                      <DropdownMenuLabel>{labels.envRemote}</DropdownMenuLabel>
                      {git?.remote || git?.remoteUrl ? (
                        <DropdownMenuItem
                          onSelect={() => {
                            if (git?.remoteUrl) {
                              void navigator.clipboard?.writeText(
                                git.remoteUrl
                              )
                            }
                          }}
                        >
                          <span className="truncate font-mono text-xs">
                            {git.remoteUrl ?? git.remote}
                          </span>
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem disabled>
                          {labels.envNoRemote}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}

                {hasGitRepository ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className={environmentRowClassName}>
                        <GitBranch aria-hidden className={rowIconClassName} />
                        <span className="min-w-0 flex-1 truncate">
                          {git?.branch ?? labels.envBranches}
                        </span>
                        <RiArrowDownSLine
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground"
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
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <button
                    type="button"
                    className={environmentRowClassName}
                    disabled
                  >
                    <GitBranch aria-hidden className={rowIconClassName} />
                    <span className="min-w-0 flex-1 truncate">
                      {project?.name ?? labels.envBranches}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  className={environmentRowClassName}
                  disabled={!hasGitChanges}
                  onClick={() => setCommitDialogOpen(true)}
                >
                  <GitCommitHorizontal
                    aria-hidden
                    className={rowIconClassName}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {labels.envCommitOrPush}
                  </span>
                  <Ellipsis
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
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
              separated={hasEnvironmentSection}
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
              <div className="px-5 pb-1">
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
              separated={hasEnvironmentSection || hasGoalSection}
              summary={
                <span className="text-xs text-muted-foreground tabular-nums">
                  {completedTodoCount}/{todos.length}
                </span>
              }
            >
              <ul className="flex flex-col gap-1.5 px-5 pb-1">
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
              separated={
                hasEnvironmentSection || hasGoalSection || hasProgressSection
              }
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
              <div className="flex flex-col gap-0.5 px-4">
                {visibleChanges.map((change) => (
                  <button
                    key={change.path}
                    type="button"
                    title={change.path}
                    className="flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
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
                  <div className="px-1.5 pt-1 text-xs text-muted-foreground">
                    +{overflowChangeCount}
                  </div>
                ) : null}
              </div>
            </StudioStatusPanelSection>
          ) : null}

          <StudioStatusPanelSection
            title={labels.envSources}
            open={sourcesSectionOpen}
            onOpenChange={setSourcesSectionOpen}
            showToggle={false}
            separated={
              hasEnvironmentSection ||
              hasGoalSection ||
              hasProgressSection ||
              hasChangesSection
            }
            summary={
              files.length > 0 ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {files.length}
                </span>
              ) : null
            }
          >
            {files.length > 0 ? (
              <div className="flex flex-col gap-0.5 px-4">
                {visibleFiles.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    title={file.path}
                    className="flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                    onClick={() => handleOpenPath(file.path)}
                  >
                    <RiFileTextLine aria-hidden className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  </button>
                ))}
                {overflowCount > 0 ? (
                  <div className="mt-1 px-1.5 text-xs text-muted-foreground">
                    {t.studioOutputsOverflow(overflowCount)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="px-5 py-1 text-sm font-medium text-muted-foreground">
                {labels.envNoSources}
              </div>
            )}
          </StudioStatusPanelSection>
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
  showToggle = true,
  children,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  summary?: React.ReactNode
  action?: React.ReactNode
  separated?: boolean
  showToggle?: boolean
  children: React.ReactNode
}) {
  const headerContent = (
    <>
      {showToggle ? (
        open ? (
          <RiArrowDownSLine
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
          />
        ) : (
          <RiArrowRightSLine
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
          />
        )
      ) : null}
      <span className="min-w-0 truncate text-[15px] font-semibold text-muted-foreground">
        {title}
      </span>
    </>
  )

  return (
    <Collapsible
      open={showToggle ? open : true}
      onOpenChange={onOpenChange}
      className={cn(
        "relative z-0 flex min-w-0 flex-col pb-3 after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/70 after:content-[''] last:pb-0 last:after:hidden",
        separated && "pt-3"
      )}
    >
      <div className="sticky top-0 z-10 flex h-8 min-w-0 items-center gap-2 bg-popover/98 px-4 pr-3 pb-0.5">
        {showToggle ? (
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-0.5 pr-1 text-left focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              {headerContent}
            </button>
          </CollapsibleTrigger>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 pr-1">
            {headerContent}
          </div>
        )}
        {showToggle && !open && summary ? (
          <div className="shrink-0">{summary}</div>
        ) : null}
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
