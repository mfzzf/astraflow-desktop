"use client"

import Link from "next/link"
import * as React from "react"
import {
  Bot,
  CalendarClock,
  ChevronLeft,
  CircleStop,
  Download,
  ExternalLink,
  MoreHorizontal,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

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
  if (!run.startedAt) {
    return "-"
  }

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

function statusBadgeClass(status: AutomationRunStatus) {
  switch (status) {
    case "succeeded":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    case "failed":
      return "border-destructive/30 bg-destructive/10 text-destructive"
    case "running":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
    case "queued":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    case "cancelled":
      return "border-zinc-500/30 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"
    case "skipped":
      return "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300"
  }
}

function StatusBadge({
  copy,
  status,
}: {
  copy: AutomationCopy
  status: AutomationRunStatus
}) {
  return (
    <Badge className={statusBadgeClass(status)} variant="outline">
      {statusLabel(status, copy)}
    </Badge>
  )
}

function TypeBadge({
  copy,
  kind,
}: {
  copy: AutomationCopy
  kind: AutomationKind
}) {
  const Icon = kind === "ai" ? Bot : Terminal
  return (
    <Badge variant="secondary">
      <Icon aria-hidden />
      {kind === "ai" ? copy.ai : copy.command}
    </Badge>
  )
}

function triggerLabel(run: AutomationRun, copy: AutomationCopy) {
  switch (run.trigger) {
    case "manual":
      return copy.manual
    case "schedule":
      return copy.scheduled
    case "catch_up":
      return copy.catchUp
    case "retry":
      return copy.retry
  }
}

function DetailValue({
  children,
  label,
}: {
  children: React.ReactNode
  label: string
}) {
  return (
    <div className="min-w-0 border-b py-3 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm break-words">{children}</dd>
    </div>
  )
}

function TaskConfiguration({
  copy,
  locale,
  task,
  workspaces,
}: {
  copy: AutomationCopy
  locale: string
  task: AutomationTask
  workspaces: StudioWorkspace[]
}) {
  const workspace = workspaces.find(
    (candidate) => candidate.id === task.workspaceId
  )

  return (
    <dl className="px-4 pb-5">
      <DetailValue label={copy.type}>
        <TypeBadge copy={copy} kind={task.kind} />
      </DetailValue>
      <DetailValue label={copy.schedule}>
        <span>{formatSchedule(task, copy)}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {task.timeZone}
        </span>
      </DetailValue>
      <DetailValue label={copy.nextRun}>
        {formatDateTime(task.nextRunAt, locale) ??
          (task.enabled && task.schedule.kind === "once"
            ? copy.completed
            : "-")}
      </DetailValue>
      <DetailValue label={copy.workspace}>
        {workspace?.name ?? copy.noWorkspace}
      </DetailValue>
      {task.kind === "ai" ? (
        <>
          <DetailValue label={copy.prompt}>
            <p className="whitespace-pre-wrap">{task.payload.prompt}</p>
          </DetailValue>
          <DetailValue label={copy.runtime}>
            {task.payload.runtimeId}
          </DetailValue>
          <DetailValue label={copy.model}>{task.payload.model}</DetailValue>
          <DetailValue label={copy.reasoning}>
            {task.payload.reasoningEffort ?? copy.defaultReasoning}
          </DetailValue>
          <DetailValue label={copy.permission}>
            {task.payload.permissionMode}
          </DetailValue>
        </>
      ) : (
        <>
          <DetailValue label={copy.shellCommand}>
            <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">
              {task.payload.command}
            </pre>
          </DetailValue>
          <DetailValue label={copy.workingDirectory}>
            <code>{task.payload.workingDirectory}</code>
          </DetailValue>
          <DetailValue label={copy.maxLogSize}>
            {task.payload.maxLogBytes / (1024 * 1024)} MB
          </DetailValue>
        </>
      )}
      <DetailValue label={copy.timeout}>{task.timeoutSeconds}</DetailValue>
      <DetailValue label={copy.concurrency}>
        {task.concurrencyPolicy === "skip" ? copy.skip : copy.queue}
      </DetailValue>
      <DetailValue label={copy.misfire}>
        {task.misfirePolicy === "run_once" ? copy.runOnce : copy.skipMissed}
      </DetailValue>
      <DetailValue label={copy.maxRetries}>{task.maxRetries}</DetailValue>
      {task.maxRetries > 0 ? (
        <DetailValue label={copy.retryDelay}>
          {task.retryDelaySeconds}
        </DetailValue>
      ) : null}
    </dl>
  )
}

function RunHistory({
  cancellingRunId,
  copy,
  locale,
  onCancel,
  runs,
}: {
  cancellingRunId: string | null
  copy: AutomationCopy
  locale: string
  onCancel: (run: AutomationRun) => void
  runs: AutomationRun[]
}) {
  if (runs.length === 0) {
    return (
      <Empty className="min-h-56 rounded-none border-0 p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClock aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{copy.noRuns}</EmptyTitle>
          <EmptyDescription>{copy.noRunsDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="divide-y">
      {runs.map((run) => (
        <article className="space-y-3 px-4 py-4" key={run.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge copy={copy} status={run.status} />
                <span className="text-xs text-muted-foreground">
                  {triggerLabel(run, copy)}
                </span>
                {run.attempt > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {copy.attempt} {run.attempt + 1}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {formatDateTime(run.startedAt ?? run.scheduledFor, locale)} ·{" "}
                {formatDuration(run, locale)}
              </p>
            </div>
            {run.status === "queued" || run.status === "running" ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    aria-label={copy.cancelRun}
                    disabled={cancellingRunId === run.id}
                    onClick={() => onCancel(run)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <CircleStop aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{copy.cancelRun}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>

          {run.error ? (
            <div className="text-xs text-destructive">
              <span className="font-medium">{copy.error}: </span>
              {run.error}
            </div>
          ) : null}
          {run.exitCode !== null ? (
            <p className="text-xs text-muted-foreground">
              {copy.exitCode}: <code>{run.exitCode}</code>
            </p>
          ) : null}
          {run.outputPreview ? (
            <pre className="max-h-52 overflow-auto rounded-md bg-muted/60 p-3 font-mono text-xs whitespace-pre-wrap">
              {run.outputPreview}
            </pre>
          ) : null}
          {run.logPath ? (
            <Button asChild size="sm" variant="outline">
              <a
                href={`/api/automations/runs/${encodeURIComponent(run.id)}/log`}
              >
                <Download aria-hidden />
                {copy.downloadLog}
              </a>
            </Button>
          ) : null}
          {run.sessionId ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/studio/chat/${encodeURIComponent(run.sessionId)}`}>
                <ExternalLink aria-hidden />
                {copy.openSession}
              </Link>
            </Button>
          ) : null}
        </article>
      ))}
    </div>
  )
}

function TaskDetails({
  cancellingRunId,
  copy,
  locale,
  onBack,
  onCancelRun,
  onEdit,
  onRunNow,
  runBusy,
  runs,
  task,
  workspaces,
}: {
  cancellingRunId: string | null
  copy: AutomationCopy
  locale: string
  onBack: () => void
  onCancelRun: (run: AutomationRun) => void
  onEdit: () => void
  onRunNow: () => void
  runBusy: boolean
  runs: AutomationRun[]
  task: AutomationTask | null
  workspaces: StudioWorkspace[]
}) {
  if (!task) {
    return (
      <Empty className="rounded-none border-0 p-6">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarClock aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{copy.noSelection}</EmptyTitle>
          <EmptyDescription>{copy.noSelectionDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-3">
        <Button
          aria-label={copy.back}
          className="lg:hidden"
          onClick={onBack}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <ChevronLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium" title={task.name}>
            {task.name}
          </h2>
          <div className="mt-1 flex items-center gap-2">
            <TypeBadge copy={copy} kind={task.kind} />
            <span className="text-xs text-muted-foreground">
              {task.enabled ? copy.enabled : copy.paused}
            </span>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={copy.runNow}
              disabled={runBusy}
              onClick={onRunNow}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <Play aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copy.runNow}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              aria-label={copy.edit}
              onClick={onEdit}
              size="icon-sm"
              type="button"
              variant="outline"
            >
              <Pencil aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copy.edit}</TooltipContent>
        </Tooltip>
      </header>

      <Tabs
        className="min-h-0 flex-1 gap-0 overflow-hidden"
        defaultValue="runs"
      >
        <div className="shrink-0 border-b px-3 py-2">
          <TabsList variant="line">
            <TabsTrigger value="runs">{copy.runHistory}</TabsTrigger>
            <TabsTrigger value="configuration">
              {copy.configuration}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent className="min-h-0 overflow-y-auto" value="runs">
          <RunHistory
            cancellingRunId={cancellingRunId}
            copy={copy}
            locale={locale}
            onCancel={onCancelRun}
            runs={runs}
          />
        </TabsContent>
        <TabsContent className="min-h-0 overflow-y-auto" value="configuration">
          <TaskConfiguration
            copy={copy}
            locale={locale}
            task={task}
            workspaces={workspaces}
          />
        </TabsContent>
      </Tabs>
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
      if (initial) {
        setLoading(true)
      }

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
        if (initial) {
          setLoading(false)
        }
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
        if (!cancelled) {
          setWorkspaces(nextWorkspaces)
          setRuntimes(nextRuntimes)
          setModelSettings(nextModelSettings)
        }
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
    if (!bridge?.getAutomationBackgroundSettings) {
      return
    }

    let cancelled = false
    void bridge
      .getAutomationBackgroundSettings()
      .then((settings) => {
        if (!cancelled) {
          setDesktopSettings(settings)
        }
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
    if (!selectedTaskId) {
      return
    }

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
      if (selectedTaskId === task.id) {
        await loadRuns(task.id)
      }
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
    if (!deleteTarget) {
      return
    }

    setBusyTaskId(deleteTarget.id)
    try {
      await requestData<{ id: string }>(
        `/api/automations/${encodeURIComponent(deleteTarget.id)}`,
        { method: "DELETE" }
      )
      if (selectedTaskId === deleteTarget.id) {
        setSelectedTaskId(null)
      }
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
      if (saved) {
        setDesktopSettings(saved)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.loadFailed)
    }
  }

  return (
    <main className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
      <div
        className={getSidebarAwarePageInsetClassName({
          className: "shrink-0 border-b bg-background",
          needsSidebarToggleOffset,
          variant: "toolbar",
        })}
      >
        <div className="flex flex-wrap items-center gap-2">
          <PageSearchInput
            className="w-full sm:w-64"
            onValueChange={setQuery}
            placeholder={copy.searchPlaceholder}
            size="sm"
            value={query}
          />
          <Select
            onValueChange={(value) => setTypeFilter(value as TypeFilter)}
            value={typeFilter}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="start" position="popper">
              <SelectItem value="all">{copy.allTypes}</SelectItem>
              <SelectItem value="ai">{copy.aiTasks}</SelectItem>
              <SelectItem value="command">{copy.commandTasks}</SelectItem>
            </SelectContent>
          </Select>
          <Select
            onValueChange={(value) => setStateFilter(value as StateFilter)}
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
            {overview.activeCount} {copy.activeSummary} · {overview.totalCount}{" "}
            {copy.totalSummary}
          </span>
          <div className="ml-auto flex items-center gap-1">
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
      </div>

      {loadError ? (
        <div className="shrink-0 px-4 pt-3 sm:px-6">
          <Alert variant="destructive">
            <CalendarClock aria-hidden />
            <AlertTitle>{copy.loadFailed}</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(340px,410px)]">
        <section
          className={cn(
            "min-h-0 flex-col overflow-hidden lg:flex",
            selectedTask ? "hidden" : "flex"
          )}
        >
          {loading ? (
            <div className="space-y-3 p-4 sm:p-6">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton className="h-12 w-full" key={index} />
              ))}
            </div>
          ) : filteredTasks.length === 0 ? (
            <Empty className="rounded-none border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClock aria-hidden />
                </EmptyMedia>
                <EmptyTitle>
                  {overview.tasks.length === 0 ? copy.noTasks : copy.noMatches}
                </EmptyTitle>
                <EmptyDescription>
                  {overview.tasks.length === 0
                    ? copy.noTasksDescription
                    : copy.noMatchesDescription}
                </EmptyDescription>
              </EmptyHeader>
              {overview.tasks.length === 0 ? (
                <Button onClick={openNewTask} size="sm" type="button">
                  <Plus aria-hidden />
                  {copy.addTask}
                </Button>
              ) : null}
            </Empty>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <Table className="min-w-[920px] table-fixed">
                <colgroup>
                  <col className="w-[28%]" />
                  <col className="w-24" />
                  <col className="w-44" />
                  <col className="w-36" />
                  <col className="w-28" />
                  <col className="w-24" />
                  <col className="w-20" />
                </colgroup>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="px-5 text-left">
                      {copy.task}
                    </TableHead>
                    <TableHead className="text-center">{copy.type}</TableHead>
                    <TableHead className="text-center">
                      {copy.schedule}
                    </TableHead>
                    <TableHead className="text-center">
                      {copy.nextRun}
                    </TableHead>
                    <TableHead className="text-center">
                      {copy.lastResult}
                    </TableHead>
                    <TableHead className="text-center">{copy.state}</TableHead>
                    <TableHead className="px-2 text-center">
                      {copy.actions}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTasks.map((task) => (
                    <TableRow
                      className="cursor-pointer"
                      data-state={
                        selectedTaskId === task.id ? "selected" : undefined
                      }
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <TableCell className="px-5 text-left">
                        <button
                          className="block w-full min-w-0 text-left"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedTaskId(task.id)
                          }}
                          type="button"
                        >
                          <div
                            className="truncate font-medium"
                            title={task.name}
                          >
                            {task.name}
                          </div>
                          {task.kind === "command" ? (
                            <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                              {task.payload.command}
                            </div>
                          ) : null}
                        </button>
                      </TableCell>
                      <TableCell className="px-2 text-center">
                        <div className="flex justify-center">
                          <TypeBadge copy={copy} kind={task.kind} />
                        </div>
                      </TableCell>
                      <TableCell className="max-w-56 text-center">
                        <div
                          className="truncate text-xs"
                          title={formatSchedule(task, copy)}
                        >
                          {formatSchedule(task, copy)}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {task.timeZone}
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {formatDateTime(task.nextRunAt, locale) ??
                          (task.enabled && task.schedule.kind === "once"
                            ? copy.completed
                            : "-")}
                      </TableCell>
                      <TableCell className="text-center">
                        {task.lastRunStatus ? (
                          <div className="flex justify-center">
                            <StatusBadge
                              copy={copy}
                              status={task.lastRunStatus}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {copy.never}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div
                          className="flex justify-center"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Switch
                            aria-label={
                              task.enabled ? copy.enabled : copy.paused
                            }
                            checked={task.enabled}
                            disabled={busyTaskId === task.id}
                            onCheckedChange={(enabled) =>
                              void toggleTask(task, enabled)
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell className="px-2 text-center">
                        <div
                          className="flex justify-center"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                aria-label={copy.actions}
                                size="icon-sm"
                                type="button"
                                variant="ghost"
                              >
                                <MoreHorizontal aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                disabled={busyTaskId === task.id}
                                onSelect={() => void runTask(task)}
                              >
                                <Play aria-hidden />
                                {copy.runNow}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => openEditTask(task)}
                              >
                                <Pencil aria-hidden />
                                {copy.edit}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onSelect={() => setDeleteTarget(task)}
                              >
                                <Trash2 aria-hidden />
                                {copy.delete}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <aside
          className={cn(
            "min-h-0 border-l bg-muted/15 lg:flex",
            selectedTask ? "flex" : "hidden"
          )}
        >
          <TaskDetails
            cancellingRunId={cancellingRunId}
            copy={copy}
            locale={locale}
            onBack={() => setSelectedTaskId(null)}
            onCancelRun={(run) => void cancelRun(run)}
            onEdit={() => selectedTask && openEditTask(selectedTask)}
            onRunNow={() => selectedTask && void runTask(selectedTask)}
            runBusy={busyTaskId === selectedTask?.id}
            runs={runsTaskId === selectedTaskId ? runs : []}
            task={selectedTask}
            workspaces={workspaces}
          />
        </aside>
      </div>

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
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogContent>
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
