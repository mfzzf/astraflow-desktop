"use client"

import Link from "next/link"
import * as React from "react"
import {
  Bot,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Download,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Terminal,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { getSidebarAwarePageInsetClassName } from "@/components/app-page-inset"
import { useI18n } from "@/components/i18n-provider"
import { PageSearchInput } from "@/components/page-controls"
import { SynaraCodeBlock } from "@/components/synara-code-block"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSidebar } from "@/components/ui/sidebar"
import type { AgentModelSettingsPayload } from "@/lib/agent-model-settings-shared"
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"
import type {
  AutomationKind,
  AutomationOverview,
  AutomationRun,
  AutomationRunStatus,
  AutomationTask,
  AutomationTaskInput,
} from "@/lib/automations/types"
import type { StudioWorkspace } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import {
  getAutomationCopy,
  type AutomationCopy,
} from "./automations/automation-copy"
import { AutomationTaskSheet } from "./automations/automation-task-sheet"

type TypeFilter = "all" | AutomationKind
type StateFilter = "all" | "enabled" | "paused"

type ApiEnvelope<Data> =
  { ok: true; data: Data } | { ok: false; message?: string; error?: string }

async function requestData<Data>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  })
  const payload = (await response.json()) as ApiEnvelope<Data>

  if (!response.ok || !payload.ok) {
    const message = payload.ok
      ? `Request failed with status ${response.status}.`
      : payload.message ||
        payload.error ||
        `Request failed with status ${response.status}.`
    throw new Error(message)
  }

  return payload.data
}

function localeTag(locale: string) {
  return locale === "zh" ? "zh-CN" : "en-US"
}

function formatDateTime(value: string | null, locale: string) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date)
}

function formatDuration(run: AutomationRun, locale: string) {
  if (!run.startedAt) return "—"

  const startedAt = new Date(run.startedAt).getTime()
  const endedAt = run.finishedAt
    ? new Date(run.finishedAt).getTime()
    : Date.now()
  const totalSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000))

  if (totalSeconds < 60) {
    return locale === "zh" ? `${totalSeconds} 秒` : `${totalSeconds}s`
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return locale === "zh"
    ? `${minutes} 分 ${seconds} 秒`
    : `${minutes}m ${seconds}s`
}

function weekdayLabels(copy: AutomationCopy) {
  return [
    copy.sunday,
    copy.monday,
    copy.tuesday,
    copy.wednesday,
    copy.thursday,
    copy.friday,
    copy.saturday,
  ]
}

function formatSchedule(task: AutomationTask, copy: AutomationCopy) {
  switch (task.schedule.kind) {
    case "once":
      return `${copy.once} · ${task.schedule.localDateTime.replace("T", " ")}`
    case "interval": {
      const unit =
        task.schedule.unit === "minutes"
          ? copy.minutes
          : task.schedule.unit === "hours"
            ? copy.hours
            : copy.days
      return `${copy.every} ${task.schedule.every} ${unit}`
    }
    case "daily":
      return `${copy.daily} · ${task.schedule.time}`
    case "weekly": {
      const labels = weekdayLabels(copy)
      return `${task.schedule.weekdays.map((day) => labels[day]).join(" ")} · ${task.schedule.time}`
    }
    case "cron":
      return `Cron · ${task.schedule.expression}`
  }
}

function statusLabel(status: AutomationRunStatus, copy: AutomationCopy) {
  return copy[status]
}

function statusColor(status: AutomationRunStatus | null, enabled = true) {
  if (!enabled) return "text-muted-foreground/45"

  switch (status) {
    case "running":
    case "queued":
      return "text-sky-500"
    case "failed":
    case "cancelled":
      return "text-destructive"
    case "skipped":
      return "text-amber-500"
    case "succeeded":
    case null:
      return "text-emerald-500"
  }
}

function StatusIndicator({
  enabled = true,
  status,
}: {
  enabled?: boolean
  status: AutomationRunStatus | null
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center",
        statusColor(status, enabled)
      )}
    >
      <span className="block size-1.5 rounded-full bg-current" />
    </span>
  )
}

function isInteractiveTarget(target: EventTarget | null, current: HTMLElement) {
  return (
    target instanceof HTMLElement &&
    target !== current &&
    Boolean(target.closest("button,a,input,textarea,select"))
  )
}

function taskRowMeta(task: AutomationTask, copy: AutomationCopy) {
  if (!task.enabled) return copy.paused

  if (
    task.lastRunStatus === "queued" ||
    task.lastRunStatus === "running" ||
    task.lastRunStatus === "failed" ||
    task.lastRunStatus === "cancelled"
  ) {
    return statusLabel(task.lastRunStatus, copy)
  }

  return formatSchedule(task, copy)
}

function taskRowDetail(
  task: AutomationTask,
  copy: AutomationCopy,
  workspaces: StudioWorkspace[]
) {
  const workspace = workspaces.find(
    (candidate) => candidate.id === task.workspaceId
  )
  const kind = task.kind === "ai" ? copy.ai : copy.command

  return workspace
    ? `${kind} · ${workspace.name}`
    : `${kind} · ${copy.noWorkspace}`
}

function AutomationListRow({
  copy,
  onDelete,
  onOpen,
  task,
  workspaces,
}: {
  copy: AutomationCopy
  onDelete: () => void
  onOpen: () => void
  task: AutomationTask
  workspaces: StudioWorkspace[]
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (isInteractiveTarget(event.target, event.currentTarget)) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
      className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors outline-none hover:bg-muted/55 focus-visible:ring-1 focus-visible:ring-ring"
    >
      <StatusIndicator enabled={task.enabled} status={task.lastRunStatus} />
      <span className="max-w-[45%] min-w-0 truncate text-[0.8125rem] text-foreground">
        {task.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {taskRowDetail(task, copy, workspaces)}
      </span>
      <span className="hidden max-w-52 shrink-0 truncate text-xs text-muted-foreground tabular-nums sm:block">
        {taskRowMeta(task, copy)}
      </span>
      <button
        type="button"
        aria-label={copy.delete}
        title={copy.delete}
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
      >
        <Trash2 aria-hidden className="size-3.5" />
      </button>
      <ChevronRight
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground/65"
      />
    </div>
  )
}

function DetailGroup({
  children,
  title,
}: {
  children: React.ReactNode
  title: string
}) {
  return (
    <section className="space-y-0.5">
      <h2 className="px-1.5 pb-1 text-xs font-medium text-muted-foreground/75">
        {title}
      </h2>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

function DetailRow({
  children,
  label,
}: {
  children: React.ReactNode
  label: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1.5 text-xs">
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-foreground">
        {children}
      </span>
    </div>
  )
}

function RunRow({
  cancelling,
  copy,
  locale,
  onCancel,
  run,
}: {
  cancelling: boolean
  copy: AutomationCopy
  locale: string
  onCancel: () => void
  run: AutomationRun
}) {
  const canCancel = run.status === "queued" || run.status === "running"
  const result = run.error || run.outputPreview

  return (
    <article className="group rounded-md px-1.5 py-2 transition-colors hover:bg-muted/45">
      <div className="flex min-w-0 items-center gap-2">
        <StatusIndicator status={run.status} />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">
          {statusLabel(run.status, copy)} · {formatDuration(run, locale)}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {formatDateTime(run.startedAt ?? run.scheduledFor, locale)}
        </span>
      </div>
      {result ? (
        <p
          className={cn(
            "mt-1.5 line-clamp-2 pl-[22px] text-[11px] leading-4",
            run.error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {result}
        </p>
      ) : null}
      {canCancel || run.logPath || run.sessionId ? (
        <div className="mt-1.5 flex items-center justify-end gap-1 opacity-70 transition-opacity group-hover:opacity-100">
          {canCancel ? (
            <Button
              aria-label={copy.cancelRun}
              disabled={cancelling}
              onClick={onCancel}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <CircleStop aria-hidden />
            </Button>
          ) : null}
          {run.logPath ? (
            <Button asChild size="icon-xs" variant="ghost">
              <a
                aria-label={copy.downloadLog}
                href={`/api/automations/runs/${encodeURIComponent(run.id)}/log`}
              >
                <Download aria-hidden />
              </a>
            </Button>
          ) : null}
          {run.sessionId ? (
            <Button asChild size="icon-xs" variant="ghost">
              <Link
                aria-label={copy.openSession}
                href={`/studio/chat/${encodeURIComponent(run.sessionId)}`}
              >
                <ExternalLink aria-hidden />
              </Link>
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function TaskDetail({
  busy,
  cancellingRunId,
  copy,
  locale,
  needsSidebarToggleOffset,
  onBack,
  onCancelRun,
  onDelete,
  onEdit,
  onRunNow,
  onToggle,
  runs,
  task,
  workspaces,
}: {
  busy: boolean
  cancellingRunId: string | null
  copy: AutomationCopy
  locale: string
  needsSidebarToggleOffset: boolean
  onBack: () => void
  onCancelRun: (run: AutomationRun) => void
  onDelete: () => void
  onEdit: () => void
  onRunNow: () => void
  onToggle: (enabled: boolean) => void
  runs: AutomationRun[]
  task: AutomationTask
  workspaces: StudioWorkspace[]
}) {
  const workspace = workspaces.find(
    (candidate) => candidate.id === task.workspaceId
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header
        className={getSidebarAwarePageInsetClassName({
          className: "shrink-0 border-b bg-background",
          needsSidebarToggleOffset,
          variant: "toolbar",
        })}
      >
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft aria-hidden className="size-3.5" />
            <span>{copy.title}</span>
          </button>
          <ChevronRight
            aria-hidden
            className="size-3.5 shrink-0 text-muted-foreground/60"
          />
          <span className="min-w-0 truncate text-sm font-medium">
            {task.name}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={task.enabled ? copy.pause : copy.resume}
                  disabled={busy}
                  onClick={() => onToggle(!task.enabled)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  {task.enabled ? <Pause aria-hidden /> : <Play aria-hidden />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {task.enabled ? copy.pause : copy.resume}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={copy.edit}
                  onClick={onEdit}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Pencil aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copy.edit}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label={copy.delete}
                  onClick={onDelete}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copy.delete}</TooltipContent>
            </Tooltip>
            <Button
              className="ml-1"
              disabled={busy}
              onClick={onRunNow}
              size="sm"
              type="button"
            >
              <Play aria-hidden />
              {copy.runNow}
            </Button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <section className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-8 sm:px-8">
          <div className="mx-auto max-w-3xl space-y-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {task.kind === "ai" ? (
                <Bot aria-hidden className="size-3.5" />
              ) : (
                <Terminal aria-hidden className="size-3.5" />
              )}
              <span>
                {task.kind === "ai" ? copy.aiTasks : copy.commandTasks}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {task.name}
            </h1>
            {task.kind === "ai" ? (
              <p className="text-[0.9375rem] leading-7 whitespace-pre-wrap text-foreground">
                {task.payload.prompt}
              </p>
            ) : (
              <SynaraCodeBlock code={task.payload.command} language="bash" />
            )}
          </div>
        </section>

        <aside className="min-h-0 w-full shrink-0 overflow-y-auto border-t bg-muted/10 lg:w-80 lg:border-t-0 lg:border-l">
          <div className="flex flex-col gap-6 px-4 py-6">
            <DetailGroup title={copy.status}>
              <DetailRow label={copy.status}>
                <span className="inline-flex items-center gap-1.5">
                  <StatusIndicator
                    enabled={task.enabled}
                    status={task.lastRunStatus}
                  />
                  {task.enabled ? copy.enabled : copy.paused}
                </span>
              </DetailRow>
              <DetailRow label={copy.nextRun}>
                {formatDateTime(task.nextRunAt, locale) ?? "—"}
              </DetailRow>
              <DetailRow label={copy.lastRun}>
                {formatDateTime(task.lastRunAt, locale) ?? "—"}
              </DetailRow>
            </DetailGroup>

            <DetailGroup title={copy.details}>
              <DetailRow label={copy.type}>
                {task.kind === "ai" ? copy.ai : copy.command}
              </DetailRow>
              <DetailRow label={copy.workspace}>
                {workspace?.name ?? copy.noWorkspace}
              </DetailRow>
              <DetailRow label={copy.schedule}>
                {formatSchedule(task, copy)}
              </DetailRow>
              <DetailRow label={copy.timeZone}>{task.timeZone}</DetailRow>
              {task.kind === "ai" ? (
                <>
                  <DetailRow label={copy.runtime}>
                    {task.payload.runtimeId}
                  </DetailRow>
                  <DetailRow label={copy.model}>{task.payload.model}</DetailRow>
                  <DetailRow label={copy.reasoning}>
                    {task.payload.reasoningEffort ?? copy.defaultReasoning}
                  </DetailRow>
                  <DetailRow label={copy.permission}>
                    {task.payload.permissionMode === "default"
                      ? copy.defaultPermission
                      : copy.fullAccess}
                  </DetailRow>
                </>
              ) : (
                <>
                  <DetailRow label={copy.workingDirectory}>
                    {task.payload.workingDirectory}
                  </DetailRow>
                  <DetailRow label={copy.maxLogSize}>
                    {task.payload.maxLogBytes / (1024 * 1024)} MB
                  </DetailRow>
                </>
              )}
              <DetailRow label={copy.timeout}>{task.timeoutSeconds}</DetailRow>
              <DetailRow label={copy.concurrency}>
                {task.concurrencyPolicy === "skip" ? copy.skip : copy.queue}
              </DetailRow>
              <DetailRow label={copy.misfire}>
                {task.misfirePolicy === "run_once"
                  ? copy.runOnce
                  : copy.skipMissed}
              </DetailRow>
              <DetailRow label={copy.maxRetries}>{task.maxRetries}</DetailRow>
            </DetailGroup>

            <DetailGroup title={copy.previousRuns}>
              {runs.length === 0 ? (
                <p className="px-1.5 py-1 text-xs text-muted-foreground">
                  {copy.noRuns}
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {runs.map((run) => (
                    <RunRow
                      cancelling={cancellingRunId === run.id}
                      copy={copy}
                      key={run.id}
                      locale={locale}
                      onCancel={() => onCancelRun(run)}
                      run={run}
                    />
                  ))}
                </div>
              )}
            </DetailGroup>
          </div>
        </aside>
      </div>
    </div>
  )
}

export function AutomationsPage() {
  const { locale } = useI18n()
  const copy = getAutomationCopy(locale)
  const { isMobile, open: sidebarOpen } = useSidebar()
  const [overview, setOverview] = React.useState<AutomationOverview>({
    tasks: [],
    activeCount: 0,
    totalCount: 0,
  })
  const [runs, setRuns] = React.useState<AutomationRun[]>([])
  const [runsTaskId, setRunsTaskId] = React.useState<string | null>(null)
  const [workspaces, setWorkspaces] = React.useState<StudioWorkspace[]>([])
  const [runtimes, setRuntimes] = React.useState<AgentRuntimeInfo[]>([])
  const [modelSettings, setModelSettings] =
    React.useState<AgentModelSettingsPayload | null>(null)
  const [selectedTaskId, setSelectedTaskId] = React.useState<string | null>(
    null
  )
  const [query, setQuery] = React.useState("")
  const [typeFilter, setTypeFilter] = React.useState<TypeFilter>("all")
  const [stateFilter, setStateFilter] = React.useState<StateFilter>("all")
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [editingTaskId, setEditingTaskId] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<AutomationTask | null>(
    null
  )
  const [saving, setSaving] = React.useState(false)
  const [busyTaskId, setBusyTaskId] = React.useState<string | null>(null)
  const [cancellingRunId, setCancellingRunId] = React.useState<string | null>(
    null
  )
  const [desktopSettings, setDesktopSettings] =
    React.useState<AstraFlowAutomationBackgroundSettings | null>(null)
  const needsSidebarToggleOffset = isMobile || !sidebarOpen

  const selectedTask =
    overview.tasks.find((task) => task.id === selectedTaskId) ?? null
  const editingTask =
    overview.tasks.find((task) => task.id === editingTaskId) ?? null

  const loadTasks = React.useCallback(
    async (initial = false) => {
      if (initial) setLoading(true)

      try {
        const data = await requestData<AutomationOverview>("/api/automations")
        setOverview(data)
        setLoadError(null)
        setSelectedTaskId((current) =>
          current && data.tasks.some((task) => task.id === current)
            ? current
            : null
        )
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : copy.loadFailed)
      } finally {
        if (initial) setLoading(false)
      }
    },
    [copy.loadFailed]
  )

  const loadRuns = React.useCallback(
    async (taskId: string) => {
      try {
        const data = await requestData<AutomationRun[]>(
          `/api/automations/${encodeURIComponent(taskId)}/runs?limit=100`
        )
        setRuns(data)
        setRunsTaskId(taskId)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : copy.loadFailed)
      }
    },
    [copy.loadFailed]
  )

  React.useEffect(() => {
    queueMicrotask(() => void loadTasks(true))
    const interval = window.setInterval(() => void loadTasks(), 5_000)
    return () => window.clearInterval(interval)
  }, [loadTasks])

  React.useEffect(() => {
    let cancelled = false

    void Promise.all([
      requestData<StudioWorkspace[]>("/api/studio/workspaces"),
      requestData<AgentRuntimeInfo[]>("/api/studio/agent-runtimes"),
      requestData<AgentModelSettingsPayload>(
        "/api/studio/agent-model-settings"
      ),
    ])
      .then(([nextWorkspaces, nextRuntimes, nextModelSettings]) => {
        if (cancelled) return
        setWorkspaces(nextWorkspaces)
        setRuntimes(nextRuntimes)
        setModelSettings(nextModelSettings)
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(
            error instanceof Error ? error.message : copy.optionsLoadFailed
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [copy.optionsLoadFailed])

  React.useEffect(() => {
    const bridge = window.astraflowDesktop
    if (!bridge?.getAutomationBackgroundSettings) return

    let cancelled = false
    void bridge
      .getAutomationBackgroundSettings()
      .then((settings) => {
        if (!cancelled) setDesktopSettings(settings)
      })
      .catch((error) => {
        if (!cancelled) {
          toast.error(error instanceof Error ? error.message : copy.loadFailed)
        }
      })
    const dispose = bridge.onAutomationBackgroundSettingsChanged?.((settings) =>
      setDesktopSettings(settings)
    )

    return () => {
      cancelled = true
      dispose?.()
    }
  }, [copy.loadFailed])

  React.useEffect(() => {
    if (!selectedTaskId) return

    queueMicrotask(() => {
      setRuns([])
      setRunsTaskId(selectedTaskId)
      void loadRuns(selectedTaskId)
    })
    const interval = window.setInterval(
      () => void loadRuns(selectedTaskId),
      3_000
    )
    return () => window.clearInterval(interval)
  }, [loadRuns, selectedTaskId])

  const filteredTasks = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return overview.tasks.filter((task) => {
      const matchesQuery =
        !normalizedQuery ||
        [task.name, task.kind, formatSchedule(task, copy)]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery)
      const matchesType = typeFilter === "all" || task.kind === typeFilter
      const matchesState =
        stateFilter === "all" ||
        (stateFilter === "enabled" ? task.enabled : !task.enabled)

      return matchesQuery && matchesType && matchesState
    })
  }, [copy, overview.tasks, query, stateFilter, typeFilter])

  const activeTasks = filteredTasks.filter((task) => task.enabled)
  const pausedTasks = filteredTasks.filter((task) => !task.enabled)

  function openNewTask() {
    setEditingTaskId(null)
    setSheetOpen(true)
  }

  function openEditTask(task: AutomationTask) {
    setEditingTaskId(task.id)
    setSheetOpen(true)
  }

  async function saveTask(input: AutomationTaskInput) {
    setSaving(true)

    try {
      if (editingTask) {
        await requestData<AutomationTask>(
          `/api/automations/${encodeURIComponent(editingTask.id)}`,
          { method: "PATCH", body: JSON.stringify(input) }
        )
        toast.success(copy.updateSucceeded)
      } else {
        const created = await requestData<AutomationTask>("/api/automations", {
          method: "POST",
          body: JSON.stringify(input),
        })
        setSelectedTaskId(created.id)
        toast.success(copy.createSucceeded)
      }
      setSheetOpen(false)
      await loadTasks()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.formInvalid)
    } finally {
      setSaving(false)
    }
  }

  async function toggleTask(task: AutomationTask, enabled: boolean) {
    setBusyTaskId(task.id)

    try {
      await requestData<AutomationTask>(
        `/api/automations/${encodeURIComponent(task.id)}`,
        { method: "PATCH", body: JSON.stringify({ enabled }) }
      )
      toast.success(copy.updateSucceeded)
      await loadTasks()
      if (selectedTaskId === task.id) await loadRuns(task.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.loadFailed)
    } finally {
      setBusyTaskId(null)
    }
  }

  async function runTask(task: AutomationTask) {
    setBusyTaskId(task.id)

    try {
      await requestData<AutomationRun>(
        `/api/automations/${encodeURIComponent(task.id)}/run`,
        { method: "POST" }
      )
      toast.success(copy.runQueued)
      setSelectedTaskId(task.id)
      await Promise.all([loadTasks(), loadRuns(task.id)])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.loadFailed)
    } finally {
      setBusyTaskId(null)
    }
  }

  async function cancelRun(run: AutomationRun) {
    setCancellingRunId(run.id)

    try {
      await requestData<AutomationRun>(
        `/api/automations/runs/${encodeURIComponent(run.id)}/cancel`,
        { method: "POST" }
      )
      toast.success(copy.cancelSucceeded)
      await Promise.all([loadTasks(), loadRuns(run.taskId)])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.loadFailed)
    } finally {
      setCancellingRunId(null)
    }
  }

  async function deleteTask() {
    if (!deleteTarget) return

    setBusyTaskId(deleteTarget.id)

    try {
      await requestData<{ id: string }>(
        `/api/automations/${encodeURIComponent(deleteTarget.id)}`,
        { method: "DELETE" }
      )
      if (selectedTaskId === deleteTarget.id) setSelectedTaskId(null)
      setDeleteTarget(null)
      toast.success(copy.deleteSucceeded)
      await loadTasks()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.loadFailed)
    } finally {
      setBusyTaskId(null)
    }
  }

  async function updateDesktopSettings(
    next: AstraFlowAutomationBackgroundSettings
  ) {
    try {
      const saved =
        await window.astraflowDesktop?.setAutomationBackgroundSettings?.(next)
      if (saved) setDesktopSettings(saved)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.loadFailed)
    }
  }

  function renderTaskSection(title: string, tasks: AutomationTask[]) {
    if (tasks.length === 0) return null

    return (
      <section className="flex flex-col gap-0.5">
        <h2 className="px-2 pb-1 text-sm font-medium text-foreground">
          {title}
        </h2>
        <div className="flex flex-col">
          {tasks.map((task) => (
            <AutomationListRow
              copy={copy}
              key={task.id}
              onDelete={() => setDeleteTarget(task)}
              onOpen={() => setSelectedTaskId(task.id)}
              task={task}
              workspaces={workspaces}
            />
          ))}
        </div>
      </section>
    )
  }

  return (
    <main className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
      {selectedTask ? (
        <TaskDetail
          busy={busyTaskId === selectedTask.id}
          cancellingRunId={cancellingRunId}
          copy={copy}
          locale={locale}
          needsSidebarToggleOffset={needsSidebarToggleOffset}
          onBack={() => setSelectedTaskId(null)}
          onCancelRun={(run) => void cancelRun(run)}
          onDelete={() => setDeleteTarget(selectedTask)}
          onEdit={() => openEditTask(selectedTask)}
          onRunNow={() => void runTask(selectedTask)}
          onToggle={(enabled) => void toggleTask(selectedTask, enabled)}
          runs={runsTaskId === selectedTask.id ? runs : []}
          task={selectedTask}
          workspaces={workspaces}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header
            className={getSidebarAwarePageInsetClassName({
              className: "shrink-0 border-b bg-background",
              needsSidebarToggleOffset,
              variant: "toolbar",
            })}
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <h1 className="truncate text-xl font-semibold tracking-tight">
                {copy.title}
              </h1>
              <div className="flex shrink-0 items-center gap-1">
                {desktopSettings ? (
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={copy.backgroundSettings}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            <Settings2 aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>{copy.backgroundSettings}</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end" className="min-w-64">
                      <DropdownMenuCheckboxItem
                        checked={desktopSettings.keepRunningInBackground}
                        onCheckedChange={(checked) =>
                          void updateDesktopSettings({
                            ...desktopSettings,
                            keepRunningInBackground: checked,
                          })
                        }
                      >
                        {copy.keepRunning}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={desktopSettings.openAtLogin}
                        onCheckedChange={(checked) =>
                          void updateDesktopSettings({
                            ...desktopSettings,
                            openAtLogin: checked,
                          })
                        }
                      >
                        {copy.openAtLogin}
                      </DropdownMenuCheckboxItem>
                      <DropdownMenuCheckboxItem
                        checked={desktopSettings.notificationsEnabled}
                        onCheckedChange={(checked) =>
                          void updateDesktopSettings({
                            ...desktopSettings,
                            notificationsEnabled: checked,
                          })
                        }
                      >
                        {copy.desktopNotifications}
                      </DropdownMenuCheckboxItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      aria-label={copy.refresh}
                      onClick={() => void loadTasks()}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <RefreshCw aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{copy.refresh}</TooltipContent>
                </Tooltip>
                <Button onClick={openNewTask} size="sm" type="button">
                  <Plus aria-hidden />
                  {copy.addTask}
                </Button>
              </div>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-8 pb-12">
              {loadError ? (
                <Alert variant="destructive">
                  <CalendarClock aria-hidden />
                  <AlertTitle>{copy.loadFailed}</AlertTitle>
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              ) : null}

              {overview.tasks.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 px-2">
                  <PageSearchInput
                    className="w-full sm:w-56"
                    onValueChange={setQuery}
                    placeholder={copy.searchPlaceholder}
                    size="sm"
                    value={query}
                  />
                  <Select
                    onValueChange={(value) =>
                      setTypeFilter(value as TypeFilter)
                    }
                    value={typeFilter}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" position="popper">
                      <SelectItem value="all">{copy.allTypes}</SelectItem>
                      <SelectItem value="ai">{copy.aiTasks}</SelectItem>
                      <SelectItem value="command">
                        {copy.commandTasks}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <Select
                    onValueChange={(value) =>
                      setStateFilter(value as StateFilter)
                    }
                    value={stateFilter}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" position="popper">
                      <SelectItem value="all">{copy.allStatuses}</SelectItem>
                      <SelectItem value="enabled">{copy.enabled}</SelectItem>
                      <SelectItem value="paused">{copy.paused}</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs text-muted-foreground">
                    {overview.activeCount} {copy.activeSummary} ·{" "}
                    {overview.totalCount} {copy.totalSummary}
                  </span>
                </div>
              ) : null}

              {loading ? (
                <div className="space-y-2 px-2 py-2">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <Skeleton className="h-9 w-full" key={index} />
                  ))}
                </div>
              ) : overview.tasks.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-16 text-center">
                  <p className="text-sm font-medium">{copy.noTasks}</p>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    {copy.noTasksDescription}
                  </p>
                </div>
              ) : filteredTasks.length === 0 ? (
                <div className="flex flex-col items-center gap-1 py-16 text-center">
                  <p className="text-sm font-medium">{copy.noMatches}</p>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    {copy.noMatchesDescription}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {renderTaskSection(copy.current, activeTasks)}
                  {renderTaskSection(copy.paused, pausedTasks)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {sheetOpen ? (
        <AutomationTaskSheet
          copy={copy}
          modelSettings={modelSettings}
          onOpenChange={setSheetOpen}
          onSubmit={(input) => void saveTask(input)}
          open={sheetOpen}
          runtimes={runtimes}
          saving={saving}
          task={editingTask}
          workspaces={workspaces}
        />
      ) : null}

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
      >
        <DialogContent closeLabel={copy.cancel}>
          <DialogHeader>
            <DialogTitle>{copy.deleteTitle}</DialogTitle>
            <DialogDescription>{copy.deleteDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => setDeleteTarget(null)}
              type="button"
              variant="outline"
            >
              {copy.cancel}
            </Button>
            <Button
              disabled={busyTaskId === deleteTarget?.id}
              onClick={() => void deleteTask()}
              type="button"
              variant="destructive"
            >
              <Trash2 aria-hidden />
              {copy.deleteConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
