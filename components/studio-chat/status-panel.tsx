"use client"

import * as React from "react"
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiCloseLine,
  RiCloudLine,
  RiComputerLine,
  RiFileTextLine,
  RiGitBranchLine,
  RiGitCommitLine,
  RiGlobalLine,
  RiLoader4Line,
  RiRobot2Line,
  RiSearchLine,
} from "@remixicon/react"
import {
  Archive,
  Ellipsis,
  File,
  FileImage,
  FileSpreadsheet,
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
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { dispatchStudioLocalProjectsChanged } from "@/lib/studio-session-events"
import { cn } from "@/lib/utils"
import type {
  StudioLocalProjectWithGitInfo,
  StudioMessagePart,
  StudioMessageTodo,
  StudioTokenUsage,
} from "@/lib/studio-types"

import type { StudioRightPanelLabels } from "./right-panel/labels"
import type {
  ChatRunEnvironment,
  StudioFileChangeSummary,
  StudioOutputFile,
} from "./types"

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

export type StudioStatusPlanSummary = {
  messageId: string
  partId: string
  title: string
  todos: StudioMessageTodo[]
}

export type StudioStatusSubagentSummary = {
  messageId: string
  partId: string
  taskId: string
  name: string
  status: "running" | "complete" | "error" | "cancelled"
  part: Extract<StudioMessagePart, { type: "subagent" }>
}

export function StudioStatusPanel({
  open,
  presentation = "inline",
  project,
  environment,
  files,
  changes,
  labels,
  plan,
  subagents,
  usage,
  running,
  loadingChanges,
  onOpenChanges,
  onOpenPlan,
  onOpenSubagent,
  onOpenSources,
  onRefresh,
  onEnvironmentChange,
}: {
  open: boolean
  presentation?: "inline" | "popover"
  project: StudioLocalProjectWithGitInfo | null
  environment: ChatRunEnvironment
  files: StudioOutputFile[]
  changes: StudioFileChangeSummary[]
  labels: StudioRightPanelLabels
  plan: StudioStatusPlanSummary | null
  subagents: StudioStatusSubagentSummary[]
  usage: StudioTokenUsage | null
  running: boolean
  loadingChanges: boolean
  onOpenChanges: () => Promise<void> | void
  onOpenPlan: (plan: StudioStatusPlanSummary) => void
  onOpenSubagent: (subagent: StudioStatusSubagentSummary) => void
  onOpenSources: () => void
  onRefresh: () => Promise<void> | void
  onEnvironmentChange: (environment: ChatRunEnvironment) => void
}) {
  const { locale, t } = useI18n()
  const [commitDialogOpen, setCommitDialogOpen] = React.useState(false)
  const [commitMessage, setCommitMessage] = React.useState("")
  const [gitActionPending, setGitActionPending] = React.useState(false)
  const [branchActionPending, setBranchActionPending] = React.useState(false)
  const [branchMenuOpen, setBranchMenuOpen] = React.useState(false)
  const [branchQuery, setBranchQuery] = React.useState("")
  const [environmentSectionOpen, setEnvironmentSectionOpen] =
    React.useState(true)
  const [planSectionOpen, setPlanSectionOpen] = React.useState(true)
  const [subagentsSectionOpen, setSubagentsSectionOpen] = React.useState(true)
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
  const hasGitRepository = git?.gitAvailable === true
  const hasGitChanges =
    hasGitRepository &&
    (git?.isDirty === true ||
      (git?.changedFiles ?? 0) > 0 ||
      (git?.additions ?? 0) > 0 ||
      (git?.deletions ?? 0) > 0)
  const hasPushableCommits =
    hasGitRepository && Boolean(git?.remote) && (git?.ahead ?? 0) > 0
  const hasGitActions = hasGitChanges || hasPushableCommits
  const hasPanelChanges = hasGitChanges || changes.length > 0
  const hasEnvironmentSection = Boolean(project)
  const hasPlanSection = Boolean(plan)
  const hasSubagentsSection = subagents.length > 0
  const hasChangesSection = changes.length > 0
  const hasPanelContent =
    hasEnvironmentSection ||
    hasPanelChanges ||
    files.length > 0 ||
    hasPlanSection ||
    hasSubagentsSection ||
    Boolean(usage && usage.totalTokens > 0)
  const completedPlanTodoCount = (plan?.todos ?? []).filter(
    (todo) => todo.status === "completed"
  ).length
  const planProgressLabel =
    plan && plan.todos.length > 0
      ? `${completedPlanTodoCount}/${plan.todos.length}`
      : null
  const planMeta = [
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
  const environmentLabel =
    environment === "remote" ? labels.envRemote : t.studioLocalProjectLocal
  const branches = React.useMemo(
    () =>
      [...new Set([git?.branch, ...(git?.branches ?? [])])].filter(
        (branch): branch is string => Boolean(branch)
      ),
    [git?.branch, git?.branches]
  )
  const normalizedBranchQuery = branchQuery.trim().toLocaleLowerCase()
  const filteredBranches = normalizedBranchQuery
    ? branches.filter((branch) =>
        branch.toLocaleLowerCase().includes(normalizedBranchQuery)
      )
    : branches
  const requestedBranchName = branchQuery.trim()
  const canCreateBranch =
    requestedBranchName.length > 0 &&
    !branches.some((branch) => branch === requestedBranchName)

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
    if (
      !project ||
      !hasGitRepository ||
      gitActionPending ||
      branchActionPending
    ) {
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
      dispatchStudioLocalProjectsChanged()
      await onRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : labels.envGitActionFailed
      )
    } finally {
      setGitActionPending(false)
    }
  }

  async function handleBranchAction(
    action: "switch-branch" | "create-branch",
    branch: string
  ) {
    if (
      !project ||
      !hasGitRepository ||
      branchActionPending ||
      gitActionPending
    ) {
      return
    }

    setBranchActionPending(true)

    try {
      const response = await fetch("/api/studio/local-projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: project.id, action, branch }),
      })
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: string
      } | null

      if (!response.ok || !payload?.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : locale === "zh"
              ? "Git 未能切换分支，工作区未发生更改。"
              : "Git could not change branches. The working tree was left unchanged."
        )
      }

      toast.success(
        action === "create-branch"
          ? locale === "zh"
            ? `已创建并切换到 ${branch}`
            : `Created and switched to ${branch}`
          : locale === "zh"
            ? `已切换到 ${branch}`
            : `Switched to ${branch}`
      )
      setBranchMenuOpen(false)
      setBranchQuery("")
      dispatchStudioLocalProjectsChanged()
      await onRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : locale === "zh"
            ? "Git 未能切换分支，工作区未发生更改。"
            : "Git could not change branches. The working tree was left unchanged."
      )
    } finally {
      setBranchActionPending(false)
    }
  }

  const environmentRowClassName =
    "group flex h-7.5 w-full min-w-0 items-center gap-2.5 rounded-md px-1.5 text-left text-[13px] font-medium text-foreground/90 transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-default disabled:text-muted-foreground/65 disabled:hover:bg-transparent"
  const rowIconClassName = "size-4 shrink-0 text-current"
  const hasGitStats =
    git?.additions != null ||
    git?.deletions != null ||
    changeTotals.additions > 0 ||
    changeTotals.deletions > 0
  const visibleAdditions =
    git?.additions ?? (changeTotals.additions > 0 ? changeTotals.additions : 0)
  const visibleDeletions =
    git?.deletions ?? (changeTotals.deletions > 0 ? changeTotals.deletions : 0)

  if (!hasPanelContent) {
    return null
  }

  return (
    <div
      className={cn(
        "pointer-events-none flex items-start justify-end",
        presentation === "inline"
          ? "absolute top-[calc(var(--titlebar-height)+0.75rem)] right-0 bottom-3 z-30 pr-3 sm:pr-4"
          : "w-full"
      )}
    >
      <aside
        data-pip-obstacle="thread-summary-panel"
        aria-label={labels.envEnvironmentInfo}
        aria-hidden={!open}
        inert={!open}
        data-state={open ? "open" : "closed"}
        className={cn(
          "relative flex h-fit max-h-full w-[300px] max-w-[calc(100vw-1.5rem)] origin-top-right flex-col overflow-hidden rounded-3xl border border-border/65 bg-popover/98 pt-2.5 text-popover-foreground shadow-xl ring-1 shadow-foreground/10 ring-foreground/5 backdrop-blur transition-[opacity,transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transform-none motion-reduce:transition-none",
          open
            ? "pointer-events-auto translate-x-0 translate-y-0 scale-100 opacity-100"
            : "pointer-events-none translate-x-full scale-[0.8] opacity-0"
        )}
      >
        <div className="flex h-fit max-h-full min-h-0 flex-col gap-2 overflow-y-auto pb-2.5">
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
                  className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                  aria-label={labels.envAddSource}
                  title={labels.envAddSource}
                  onClick={onOpenSources}
                >
                  <RiAddLine aria-hidden className="size-4" />
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

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className={environmentRowClassName}>
                      <RiGlobalLine aria-hidden className={rowIconClassName} />
                      <span className="min-w-0 flex-1 truncate">
                        {environmentLabel}
                      </span>
                      <RiArrowDownSLine
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuLabel>
                      {labels.envEnvironmentInfo}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      onSelect={() => onEnvironmentChange("local")}
                    >
                      <RiComputerLine aria-hidden className="size-4" />
                      <span>{t.studioLocalProjectLocal}</span>
                      {environment === "local" ? (
                        <RiCheckLine aria-hidden className="ml-auto size-3.5" />
                      ) : null}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => onEnvironmentChange("remote")}
                    >
                      <RiCloudLine aria-hidden className="size-4" />
                      <span>{labels.envRemote}</span>
                      {environment === "remote" ? (
                        <RiCheckLine aria-hidden className="ml-auto size-3.5" />
                      ) : null}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {hasGitRepository ? (
                  <DropdownMenu
                    open={branchMenuOpen}
                    onOpenChange={(nextOpen) => {
                      setBranchMenuOpen(nextOpen)

                      if (!nextOpen) {
                        setBranchQuery("")
                      }
                    }}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className={environmentRowClassName}
                        disabled={branchActionPending}
                      >
                        <RiGitBranchLine
                          aria-hidden
                          className={rowIconClassName}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {git?.branch ?? labels.envBranches}
                        </span>
                        {branchActionPending ? (
                          <RiLoader4Line
                            aria-hidden
                            className="size-3.5 shrink-0 animate-spin text-muted-foreground"
                          />
                        ) : (
                          <RiArrowDownSLine
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground"
                          />
                        )}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-64">
                      <DropdownMenuLabel>
                        {labels.envBranches}
                      </DropdownMenuLabel>
                      <div
                        className="relative px-1 pb-1"
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") {
                            event.stopPropagation()
                          }

                          if (event.key === "Enter") {
                            const exactBranch = branches.find(
                              (branch) => branch === requestedBranchName
                            )

                            if (canCreateBranch) {
                              event.preventDefault()
                              void handleBranchAction(
                                "create-branch",
                                requestedBranchName
                              )
                            } else if (
                              exactBranch &&
                              exactBranch !== git?.branch
                            ) {
                              event.preventDefault()
                              void handleBranchAction(
                                "switch-branch",
                                exactBranch
                              )
                            }
                          }
                        }}
                      >
                        <RiSearchLine
                          aria-hidden
                          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-[calc(50%+0.125rem)] text-muted-foreground"
                        />
                        <Input
                          autoFocus
                          value={branchQuery}
                          onChange={(event) =>
                            setBranchQuery(event.target.value)
                          }
                          aria-label={
                            locale === "zh" ? "搜索分支" : "Search branches"
                          }
                          placeholder={
                            locale === "zh" ? "搜索分支…" : "Search branches…"
                          }
                          className="h-8 rounded-lg pl-8 text-xs"
                          disabled={branchActionPending}
                        />
                      </div>
                      {filteredBranches.map((branch) => (
                        <DropdownMenuItem
                          key={branch}
                          disabled={
                            branchActionPending || branch === git?.branch
                          }
                          onSelect={() =>
                            void handleBranchAction("switch-branch", branch)
                          }
                        >
                          <RiGitBranchLine aria-hidden className="size-3.5" />
                          <span
                            className={cn(
                              "min-w-0 flex-1 truncate font-mono text-xs",
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
                      {canCreateBranch ? (
                        <DropdownMenuItem
                          disabled={branchActionPending}
                          onSelect={() =>
                            void handleBranchAction(
                              "create-branch",
                              requestedBranchName
                            )
                          }
                        >
                          <RiAddLine aria-hidden className="size-3.5" />
                          <span className="min-w-0 flex-1 truncate text-xs">
                            {locale === "zh"
                              ? "创建并切换到"
                              : "Create and switch to"}{" "}
                            <span className="font-mono font-medium">
                              {requestedBranchName}
                            </span>
                          </span>
                        </DropdownMenuItem>
                      ) : null}
                      {filteredBranches.length === 0 && !canCreateBranch ? (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          {locale === "zh"
                            ? "没有匹配的分支"
                            : "No matching branches"}
                        </div>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}

                {hasGitRepository ? (
                  <button
                    type="button"
                    className={environmentRowClassName}
                    disabled={
                      !hasGitActions || gitActionPending || branchActionPending
                    }
                    onClick={() => setCommitDialogOpen(true)}
                  >
                    <RiGitCommitLine aria-hidden className={rowIconClassName} />
                    <span className="min-w-0 flex-1 truncate">
                      {labels.envCommitOrPush}
                    </span>
                    <Ellipsis
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </button>
                ) : null}
              </div>
            </StudioStatusPanelSection>
          ) : null}

          {plan ? (
            <StudioStatusPanelSection
              title={labels.envPlan}
              open={planSectionOpen}
              onOpenChange={setPlanSectionOpen}
              separated={hasEnvironmentSection}
              summaryAlwaysVisible
              summary={
                planProgressLabel ? (
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      running ? "text-muted-foreground" : "text-emerald-600"
                    )}
                  >
                    {planProgressLabel}
                  </span>
                ) : null
              }
            >
              <button
                type="button"
                className="mx-4 flex min-h-8 w-[calc(100%-2rem)] min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                onClick={() => onOpenPlan(plan)}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                    running
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-emerald-600 bg-emerald-600 text-white"
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
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "flex items-center gap-1 font-medium",
                        running ? "text-muted-foreground" : "text-emerald-600"
                      )}
                    >
                      {running
                        ? labels.envStatusRunning
                        : labels.envStatusComplete}
                    </span>
                    {planMeta.length > 0 ? (
                      <span className="text-muted-foreground tabular-nums">
                        {planMeta.join(" · ")}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>

              {plan.todos.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1.5 px-5 pb-1">
                  {plan.todos.slice(0, 5).map((todo, index) => (
                    <li
                      key={`${index}-${todo.text}`}
                      className="flex items-start gap-2 text-xs"
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
              ) : null}
            </StudioStatusPanelSection>
          ) : null}

          {subagents.length > 0 ? (
            <StudioStatusPanelSection
              title={labels.envSubagents}
              open={subagentsSectionOpen}
              onOpenChange={setSubagentsSectionOpen}
              separated={hasEnvironmentSection || hasPlanSection}
              summary={
                <span className="text-xs text-muted-foreground tabular-nums">
                  {subagents.length}
                </span>
              }
            >
              <div className="flex flex-col gap-0.5 px-4">
                {subagents.slice(0, 6).map((subagent) => (
                  <button
                    key={subagent.taskId}
                    type="button"
                    className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
                    onClick={() => onOpenSubagent(subagent)}
                  >
                    {subagent.status === "running" ? (
                      <RiLoader4Line
                        aria-hidden
                        className="size-3.5 shrink-0 animate-spin text-primary"
                      />
                    ) : subagent.status === "complete" ? (
                      <RiCheckLine
                        aria-hidden
                        className="size-3.5 shrink-0 text-emerald-600"
                      />
                    ) : subagent.status === "error" ? (
                      <RiCloseLine
                        aria-hidden
                        className="size-3.5 shrink-0 text-destructive"
                      />
                    ) : (
                      <RiRobot2Line aria-hidden className="size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">
                      {subagent.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {subagent.status === "running"
                        ? labels.envStatusRunning
                        : subagent.status === "complete"
                          ? labels.envStatusComplete
                          : subagent.status === "cancelled"
                            ? labels.envStatusCancelled
                            : labels.envStatusFailed}
                    </span>
                  </button>
                ))}
              </div>
            </StudioStatusPanelSection>
          ) : null}

          {changes.length > 0 ? (
            <StudioStatusPanelSection
              title={labels.envChanges}
              open={changesSectionOpen}
              onOpenChange={setChangesSectionOpen}
              separated={
                hasEnvironmentSection || hasPlanSection || hasSubagentsSection
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
                    className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
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
              hasPlanSection ||
              hasSubagentsSection ||
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
                    className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
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
              <div className="px-5 py-1 text-xs font-medium text-muted-foreground">
                {labels.envNoSources}
              </div>
            )}
          </StudioStatusPanelSection>
        </div>

        {project && hasGitRepository && hasGitActions ? (
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
                  disabled={
                    gitActionPending ||
                    branchActionPending ||
                    !hasPushableCommits
                  }
                  onClick={() => void handleGitAction("push")}
                >
                  {labels.envPushAction}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    gitActionPending ||
                    branchActionPending ||
                    !hasGitChanges ||
                    !commitMessage.trim()
                  }
                  onClick={() => void handleGitAction("commit")}
                >
                  {labels.envCommitAction}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    gitActionPending ||
                    branchActionPending ||
                    !hasGitChanges ||
                    !commitMessage.trim() ||
                    !git?.remote
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
  summaryAlwaysVisible = false,
  children,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  summary?: React.ReactNode
  action?: React.ReactNode
  separated?: boolean
  showToggle?: boolean
  summaryAlwaysVisible?: boolean
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
      <span className="min-w-0 truncate text-[13px] font-semibold text-muted-foreground">
        {title}
      </span>
    </>
  )

  return (
    <Collapsible
      open={showToggle ? open : true}
      onOpenChange={onOpenChange}
      className={cn(
        "relative z-0 flex min-w-0 flex-col pb-2.5 after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-border/70 after:content-[''] last:pb-0 last:after:hidden",
        separated && "pt-2.5"
      )}
    >
      <div className="sticky top-0 z-10 flex h-7 min-w-0 items-center gap-2 bg-popover/98 px-4 pr-3 pb-0.5">
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
        {showToggle && summary && (summaryAlwaysVisible || !open) ? (
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
      <span className="text-[var(--diffs-addition-base)]">+{additions}</span>
      <span className="text-[var(--diffs-deletion-base)]">-{deletions}</span>
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
