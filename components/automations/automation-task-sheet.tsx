"use client"

import * as React from "react"

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
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { AgentModelSettingsPayload } from "@/lib/agent-model-settings-shared"
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"
import type {
  AutomationConcurrencyPolicy,
  AutomationIntervalUnit,
  AutomationKind,
  AutomationMisfirePolicy,
  AutomationPermissionMode,
  AutomationScheduleKind,
  AutomationTask,
  AutomationTaskInput,
} from "@/lib/automations/types"
import type { ChatReasoningEffort } from "@/lib/chat-models"
import type { StudioWorkspace } from "@/lib/studio-types"

import type { AutomationCopy } from "./automation-copy"

type AutomationDraft = {
  name: string
  kind: AutomationKind
  enabled: boolean
  workspaceId: string
  scheduleKind: AutomationScheduleKind
  onceLocalDateTime: string
  intervalEvery: string
  intervalUnit: AutomationIntervalUnit
  intervalAnchor: string
  dailyTime: string
  weeklyTime: string
  weekdays: string[]
  cronExpression: string
  timeZone: string
  prompt: string
  runtimeId: string
  model: string
  reasoningEffort: ChatReasoningEffort | ""
  permissionMode: AutomationPermissionMode
  command: string
  workingDirectory: string
  maxLogMegabytes: string
  timeoutSeconds: string
  concurrencyPolicy: AutomationConcurrencyPolicy
  misfirePolicy: AutomationMisfirePolicy
  maxRetries: string
  retryDelaySeconds: string
}

function toLocalInputValue(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value)
  const pad = (number: number) => String(number).padStart(2, "0")

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function currentTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
}

function createDraft(task: AutomationTask | null): AutomationDraft {
  const now = new Date()
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000)
  const defaultDraft: AutomationDraft = {
    name: "",
    kind: "ai",
    enabled: true,
    workspaceId: "",
    scheduleKind: "daily",
    onceLocalDateTime: toLocalInputValue(nextHour),
    intervalEvery: "1",
    intervalUnit: "hours",
    intervalAnchor: toLocalInputValue(now),
    dailyTime: "09:00",
    weeklyTime: "09:00",
    weekdays: ["1", "2", "3", "4", "5"],
    cronExpression: "0 9 * * 1-5",
    timeZone: currentTimeZone(),
    prompt: "",
    runtimeId: "",
    model: "",
    reasoningEffort: "",
    permissionMode: "readonly",
    command: "",
    workingDirectory: ".",
    maxLogMegabytes: "10",
    timeoutSeconds: "3600",
    concurrencyPolicy: "skip",
    misfirePolicy: "run_once",
    maxRetries: "0",
    retryDelaySeconds: "60",
  }

  if (!task) {
    return defaultDraft
  }

  const scheduleValues: Partial<AutomationDraft> = {
    scheduleKind: task.schedule.kind,
  }

  switch (task.schedule.kind) {
    case "once":
      scheduleValues.onceLocalDateTime = task.schedule.localDateTime
      break
    case "interval":
      scheduleValues.intervalEvery = String(task.schedule.every)
      scheduleValues.intervalUnit = task.schedule.unit
      scheduleValues.intervalAnchor = toLocalInputValue(task.schedule.anchorAt)
      break
    case "daily":
      scheduleValues.dailyTime = task.schedule.time
      break
    case "weekly":
      scheduleValues.weeklyTime = task.schedule.time
      scheduleValues.weekdays = task.schedule.weekdays.map(String)
      break
    case "cron":
      scheduleValues.cronExpression = task.schedule.expression
      break
  }

  return {
    ...defaultDraft,
    ...scheduleValues,
    name: task.name,
    kind: task.kind,
    enabled: task.enabled,
    workspaceId: task.workspaceId ?? "",
    timeZone: task.timeZone,
    timeoutSeconds: String(task.timeoutSeconds),
    concurrencyPolicy: task.concurrencyPolicy,
    misfirePolicy: task.misfirePolicy,
    maxRetries: String(task.maxRetries),
    retryDelaySeconds: String(task.retryDelaySeconds),
    prompt: task.kind === "ai" ? task.payload.prompt : "",
    runtimeId: task.kind === "ai" ? task.payload.runtimeId : "",
    model: task.kind === "ai" ? task.payload.model : "",
    reasoningEffort:
      task.kind === "ai" ? (task.payload.reasoningEffort ?? "") : "",
    permissionMode:
      task.kind === "ai" ? task.payload.permissionMode : "readonly",
    command: task.kind === "command" ? task.payload.command : "",
    workingDirectory:
      task.kind === "command" ? task.payload.workingDirectory : ".",
    maxLogMegabytes:
      task.kind === "command"
        ? String(task.payload.maxLogBytes / (1024 * 1024))
        : "10",
  }
}

function numericValue(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function draftToInput(draft: AutomationDraft): AutomationTaskInput | null {
  if (!draft.name.trim() || !draft.timeZone.trim()) {
    return null
  }

  const schedule = (() => {
    switch (draft.scheduleKind) {
      case "once":
        return draft.onceLocalDateTime
          ? ({
              kind: "once",
              localDateTime: draft.onceLocalDateTime,
            } as const)
          : null
      case "interval": {
        const anchor = new Date(draft.intervalAnchor)
        return draft.intervalEvery && !Number.isNaN(anchor.getTime())
          ? ({
              kind: "interval",
              every: numericValue(draft.intervalEvery, 0),
              unit: draft.intervalUnit,
              anchorAt: anchor.toISOString(),
            } as const)
          : null
      }
      case "daily":
        return draft.dailyTime
          ? ({ kind: "daily", time: draft.dailyTime } as const)
          : null
      case "weekly":
        return draft.weeklyTime && draft.weekdays.length > 0
          ? ({
              kind: "weekly",
              weekdays: draft.weekdays.map(Number).sort((a, b) => a - b),
              time: draft.weeklyTime,
            } as const)
          : null
      case "cron":
        return draft.cronExpression.trim()
          ? ({ kind: "cron", expression: draft.cronExpression.trim() } as const)
          : null
    }
  })()

  if (!schedule) {
    return null
  }

  const base = {
    name: draft.name.trim(),
    enabled: draft.enabled,
    workspaceId: draft.workspaceId || null,
    schedule,
    timeZone: draft.timeZone.trim(),
    timeoutSeconds: numericValue(draft.timeoutSeconds, 0),
    concurrencyPolicy: draft.concurrencyPolicy,
    misfirePolicy: draft.misfirePolicy,
    maxRetries: numericValue(draft.maxRetries, 0),
    retryDelaySeconds: numericValue(draft.retryDelaySeconds, 0),
  }

  if (draft.kind === "ai") {
    if (!draft.prompt.trim() || !draft.runtimeId || !draft.model) {
      return null
    }

    return {
      ...base,
      kind: "ai",
      payload: {
        prompt: draft.prompt.trim(),
        runtimeId: draft.runtimeId,
        model: draft.model,
        reasoningEffort: draft.reasoningEffort || null,
        permissionMode: draft.permissionMode,
      },
    }
  }

  if (!draft.workspaceId || !draft.command.trim()) {
    return null
  }

  return {
    ...base,
    kind: "command",
    payload: {
      command: draft.command.trim(),
      workingDirectory: draft.workingDirectory.trim() || ".",
      maxLogBytes: Math.round(
        numericValue(draft.maxLogMegabytes, 0) * 1024 * 1024
      ),
    },
  }
}

const timeZones = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
]

export function AutomationTaskSheet({
  copy,
  modelSettings,
  onOpenChange,
  onSubmit,
  open,
  runtimes,
  saving,
  task,
  workspaces,
}: {
  copy: AutomationCopy
  modelSettings: AgentModelSettingsPayload | null
  onOpenChange: (open: boolean) => void
  onSubmit: (input: AutomationTaskInput) => void
  open: boolean
  runtimes: AgentRuntimeInfo[]
  saving: boolean
  task: AutomationTask | null
  workspaces: StudioWorkspace[]
}) {
  const [draft, setDraft] = React.useState(() => createDraft(task))
  const [invalid, setInvalid] = React.useState(false)
  const localWorkspaces = workspaces.filter(
    (workspace) => workspace.type === "local"
  )
  const availableModels = React.useMemo(
    () =>
      (modelSettings?.models ?? []).filter(
        (model) =>
          model.enabled &&
          model.supportedRuntimeIds.some(
            (runtimeId) => runtimeId === draft.runtimeId
          )
      ),
    [draft.runtimeId, modelSettings]
  )
  const selectedModel = availableModels.find(
    (model) => model.id === draft.model
  )

  React.useEffect(() => {
    if (draft.runtimeId || runtimes.length === 0) {
      return
    }

    const runtimeId = runtimes[0].id
    const configuredModel = modelSettings?.runtimes[runtimeId]?.defaultModel
    const fallbackModel = modelSettings?.models.find(
      (model) => model.enabled && model.supportedRuntimeIds.includes(runtimeId)
    )?.id
    queueMicrotask(() => {
      setDraft((current) =>
        current.runtimeId
          ? current
          : {
              ...current,
              runtimeId,
              model: configuredModel ?? fallbackModel ?? "",
            }
      )
    })
  }, [draft.runtimeId, modelSettings, runtimes])

  React.useEffect(() => {
    if (
      !draft.runtimeId ||
      availableModels.length === 0 ||
      availableModels.some((model) => model.id === draft.model) ||
      (task?.kind === "ai" &&
        draft.runtimeId === task.payload.runtimeId &&
        draft.model === task.payload.model)
    ) {
      return
    }

    const runtimeId =
      draft.runtimeId as keyof AgentModelSettingsPayload["runtimes"]
    const configuredModel = modelSettings?.runtimes[runtimeId]?.defaultModel
    const nextModel =
      availableModels.find((model) => model.id === configuredModel) ??
      availableModels[0]
    queueMicrotask(() => {
      setDraft((current) =>
        availableModels.some((model) => model.id === current.model)
          ? current
          : {
              ...current,
              model: nextModel.id,
              reasoningEffort: "",
            }
      )
    })
  }, [availableModels, draft.model, draft.runtimeId, modelSettings, task])

  function update<Key extends keyof AutomationDraft>(
    key: Key,
    value: AutomationDraft[Key]
  ) {
    setInvalid(false)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const input = draftToInput(draft)

    if (!input) {
      setInvalid(true)
      return
    }

    onSubmit(input)
  }

  const weekdayOptions = [
    ["1", copy.monday],
    ["2", copy.tuesday],
    ["3", copy.wednesday],
    ["4", copy.thursday],
    ["5", copy.friday],
    ["6", copy.saturday],
    ["0", copy.sunday],
  ] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(860px,calc(100dvh-2rem))] w-[min(720px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0"
        closeLabel={copy.cancel}
      >
        <DialogHeader className="shrink-0 border-b px-6 py-5 pr-14">
          <DialogTitle>{task ? copy.editTask : copy.addTask}</DialogTitle>
          <DialogDescription className="sr-only">
            {copy.taskTypeDescription}
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <FieldGroup className="gap-8">
              <FieldSet className="gap-4">
                <FieldLegend>{copy.task}</FieldLegend>
                <Field>
                  <FieldLabel htmlFor="automation-name">
                    {copy.taskName}
                  </FieldLabel>
                  <Input
                    id="automation-name"
                    maxLength={120}
                    onChange={(event) => update("name", event.target.value)}
                    placeholder={copy.taskNamePlaceholder}
                    value={draft.name}
                  />
                </Field>
                <Field>
                  <FieldLabel>{copy.taskType}</FieldLabel>
                  <ToggleGroup
                    className="w-full"
                    onValueChange={(value) => {
                      if (value) {
                        const kind = value as AutomationKind
                        setInvalid(false)
                        setDraft((current) => ({
                          ...current,
                          kind,
                          workspaceId:
                            kind === "command" &&
                            !localWorkspaces.some(
                              (workspace) =>
                                workspace.id === current.workspaceId
                            )
                              ? ""
                              : current.workspaceId,
                        }))
                      }
                    }}
                    spacing={1}
                    type="single"
                    value={draft.kind}
                    variant="outline"
                  >
                    <ToggleGroupItem className="flex-1" value="ai">
                      {copy.aiTasks}
                    </ToggleGroupItem>
                    <ToggleGroupItem className="flex-1" value="command">
                      {copy.commandTasks}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
              </FieldSet>

              <FieldSet className="gap-4">
                <FieldLegend>{copy.execution}</FieldLegend>
                {draft.kind === "ai" ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="automation-prompt">
                        {copy.prompt}
                      </FieldLabel>
                      <Textarea
                        className="min-h-32 resize-y"
                        id="automation-prompt"
                        maxLength={20_000}
                        onChange={(event) =>
                          update("prompt", event.target.value)
                        }
                        placeholder={copy.promptPlaceholder}
                        value={draft.prompt}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>{copy.workspace}</FieldLabel>
                      <Select
                        onValueChange={(value) =>
                          update("workspaceId", value === "none" ? "" : value)
                        }
                        value={draft.workspaceId || "none"}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start" position="popper">
                          <SelectItem value="none">
                            {copy.noWorkspace}
                          </SelectItem>
                          {workspaces.map((workspace) => (
                            <SelectItem key={workspace.id} value={workspace.id}>
                              {workspace.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel>{copy.runtime}</FieldLabel>
                        <Select
                          onValueChange={(runtimeId) => {
                            const configuredModel =
                              modelSettings?.runtimes[
                                runtimeId as keyof AgentModelSettingsPayload["runtimes"]
                              ]?.defaultModel ?? ""
                            setDraft((current) => ({
                              ...current,
                              runtimeId,
                              model: configuredModel,
                              reasoningEffort: "",
                            }))
                          }}
                          value={draft.runtimeId}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={copy.runtime} />
                          </SelectTrigger>
                          <SelectContent align="start" position="popper">
                            {draft.runtimeId &&
                            !runtimes.some(
                              (runtime) => runtime.id === draft.runtimeId
                            ) ? (
                              <SelectItem value={draft.runtimeId}>
                                {draft.runtimeId}
                              </SelectItem>
                            ) : null}
                            {runtimes.map((runtime) => (
                              <SelectItem key={runtime.id} value={runtime.id}>
                                {runtime.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field>
                        <FieldLabel>{copy.model}</FieldLabel>
                        <Select
                          onValueChange={(model) => {
                            setDraft((current) => ({
                              ...current,
                              model,
                              reasoningEffort: "",
                            }))
                          }}
                          value={draft.model}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={copy.model} />
                          </SelectTrigger>
                          <SelectContent align="start" position="popper">
                            {draft.model &&
                            !availableModels.some(
                              (model) => model.id === draft.model
                            ) ? (
                              <SelectItem value={draft.model}>
                                {draft.model}
                              </SelectItem>
                            ) : null}
                            {availableModels.map((model) => (
                              <SelectItem key={model.id} value={model.id}>
                                {model.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    </div>
                    <Field>
                      <FieldLabel>{copy.reasoning}</FieldLabel>
                      <Select
                        onValueChange={(value) =>
                          update(
                            "reasoningEffort",
                            value === "default"
                              ? ""
                              : (value as ChatReasoningEffort)
                          )
                        }
                        value={draft.reasoningEffort || "default"}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent align="start" position="popper">
                          <SelectItem value="default">
                            {copy.defaultReasoning}
                          </SelectItem>
                          {(selectedModel?.reasoningEfforts ?? []).map(
                            (effort) => (
                              <SelectItem key={effort} value={effort}>
                                {effort}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel>{copy.permission}</FieldLabel>
                      <ToggleGroup
                        className="w-full"
                        onValueChange={(value) => {
                          if (value) {
                            update(
                              "permissionMode",
                              value as AutomationPermissionMode
                            )
                          }
                        }}
                        spacing={1}
                        type="single"
                        value={draft.permissionMode}
                        variant="outline"
                      >
                        <ToggleGroupItem className="flex-1" value="readonly">
                          {copy.readonly}
                        </ToggleGroupItem>
                        <ToggleGroupItem className="flex-1" value="auto">
                          {copy.auto}
                        </ToggleGroupItem>
                        <ToggleGroupItem className="flex-1" value="full_access">
                          {copy.fullAccess}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                  </>
                ) : (
                  <>
                    <Field>
                      <FieldLabel>{copy.workspace}</FieldLabel>
                      <Select
                        onValueChange={(value) => update("workspaceId", value)}
                        value={draft.workspaceId}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue
                            placeholder={copy.localWorkspaceRequired}
                          />
                        </SelectTrigger>
                        <SelectContent align="start" position="popper">
                          {localWorkspaces.map((workspace) => (
                            <SelectItem key={workspace.id} value={workspace.id}>
                              {workspace.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="automation-command">
                        {copy.shellCommand}
                      </FieldLabel>
                      <Textarea
                        className="min-h-28 resize-y font-mono"
                        id="automation-command"
                        maxLength={32_000}
                        onChange={(event) =>
                          update("command", event.target.value)
                        }
                        placeholder={copy.shellCommandPlaceholder}
                        value={draft.command}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="automation-cwd">
                        {copy.workingDirectory}
                      </FieldLabel>
                      <Input
                        className="font-mono"
                        id="automation-cwd"
                        maxLength={512}
                        onChange={(event) =>
                          update("workingDirectory", event.target.value)
                        }
                        placeholder={copy.workingDirectoryPlaceholder}
                        value={draft.workingDirectory}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="automation-max-log-size">
                        {copy.maxLogSize}
                      </FieldLabel>
                      <Input
                        id="automation-max-log-size"
                        max={100}
                        min={1}
                        onChange={(event) =>
                          update("maxLogMegabytes", event.target.value)
                        }
                        step={1}
                        type="number"
                        value={draft.maxLogMegabytes}
                      />
                    </Field>
                  </>
                )}
              </FieldSet>

              <FieldSet className="gap-4">
                <FieldLegend>{copy.timing}</FieldLegend>
                <Field>
                  <FieldLabel>{copy.scheduleType}</FieldLabel>
                  <Select
                    onValueChange={(value) =>
                      update("scheduleKind", value as AutomationScheduleKind)
                    }
                    value={draft.scheduleKind}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" position="popper">
                      <SelectItem value="once">{copy.once}</SelectItem>
                      <SelectItem value="interval">{copy.interval}</SelectItem>
                      <SelectItem value="daily">{copy.daily}</SelectItem>
                      <SelectItem value="weekly">{copy.weekly}</SelectItem>
                      <SelectItem value="cron">{copy.cron}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                {draft.scheduleKind === "once" ? (
                  <Field>
                    <FieldLabel htmlFor="automation-once">
                      {copy.dateAndTime}
                    </FieldLabel>
                    <Input
                      id="automation-once"
                      onChange={(event) =>
                        update("onceLocalDateTime", event.target.value)
                      }
                      type="datetime-local"
                      value={draft.onceLocalDateTime}
                    />
                  </Field>
                ) : null}

                {draft.scheduleKind === "interval" ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="automation-every">
                        {copy.every}
                      </FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          id="automation-every"
                          min={1}
                          onChange={(event) =>
                            update("intervalEvery", event.target.value)
                          }
                          type="number"
                          value={draft.intervalEvery}
                        />
                        <Select
                          onValueChange={(value) =>
                            update(
                              "intervalUnit",
                              value as AutomationIntervalUnit
                            )
                          }
                          value={draft.intervalUnit}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="end" position="popper">
                            <SelectItem value="minutes">
                              {copy.minutes}
                            </SelectItem>
                            <SelectItem value="hours">{copy.hours}</SelectItem>
                            <SelectItem value="days">{copy.days}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="automation-anchor">
                        {copy.startAt}
                      </FieldLabel>
                      <Input
                        id="automation-anchor"
                        onChange={(event) =>
                          update("intervalAnchor", event.target.value)
                        }
                        type="datetime-local"
                        value={draft.intervalAnchor}
                      />
                    </Field>
                  </div>
                ) : null}

                {draft.scheduleKind === "daily" ? (
                  <Field>
                    <FieldLabel htmlFor="automation-daily-time">
                      {copy.time}
                    </FieldLabel>
                    <Input
                      id="automation-daily-time"
                      onChange={(event) =>
                        update("dailyTime", event.target.value)
                      }
                      type="time"
                      value={draft.dailyTime}
                    />
                  </Field>
                ) : null}

                {draft.scheduleKind === "weekly" ? (
                  <>
                    <Field>
                      <FieldLabel>{copy.weekdays}</FieldLabel>
                      <ToggleGroup
                        className="flex w-full flex-wrap"
                        onValueChange={(value) => update("weekdays", value)}
                        spacing={1}
                        type="multiple"
                        value={draft.weekdays}
                        variant="outline"
                      >
                        {weekdayOptions.map(([value, label]) => (
                          <ToggleGroupItem
                            className="min-w-12 flex-1"
                            key={value}
                            value={value}
                          >
                            {label}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="automation-weekly-time">
                        {copy.time}
                      </FieldLabel>
                      <Input
                        id="automation-weekly-time"
                        onChange={(event) =>
                          update("weeklyTime", event.target.value)
                        }
                        type="time"
                        value={draft.weeklyTime}
                      />
                    </Field>
                  </>
                ) : null}

                {draft.scheduleKind === "cron" ? (
                  <Field>
                    <FieldLabel htmlFor="automation-cron">
                      {copy.cronExpression}
                    </FieldLabel>
                    <Input
                      aria-describedby="automation-cron-description"
                      className="font-mono"
                      id="automation-cron"
                      maxLength={128}
                      onChange={(event) =>
                        update("cronExpression", event.target.value)
                      }
                      placeholder={copy.cronPlaceholder}
                      value={draft.cronExpression}
                    />
                    <FieldDescription
                      className="sr-only"
                      id="automation-cron-description"
                    >
                      {copy.cronDescription}
                    </FieldDescription>
                  </Field>
                ) : null}

                <Field>
                  <FieldLabel htmlFor="automation-timezone">
                    {copy.timeZone}
                  </FieldLabel>
                  <Input
                    id="automation-timezone"
                    list="automation-timezones"
                    maxLength={128}
                    onChange={(event) => update("timeZone", event.target.value)}
                    value={draft.timeZone}
                  />
                  <datalist id="automation-timezones">
                    {timeZones.map((timeZone) => (
                      <option key={timeZone} value={timeZone} />
                    ))}
                  </datalist>
                </Field>
              </FieldSet>

              <FieldSet className="gap-4">
                <FieldLegend>{copy.reliability}</FieldLegend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="automation-timeout">
                      {copy.timeout}
                    </FieldLabel>
                    <Input
                      id="automation-timeout"
                      max={86_400}
                      min={10}
                      onChange={(event) =>
                        update("timeoutSeconds", event.target.value)
                      }
                      type="number"
                      value={draft.timeoutSeconds}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="automation-retries">
                      {copy.maxRetries}
                    </FieldLabel>
                    <Input
                      id="automation-retries"
                      max={5}
                      min={0}
                      onChange={(event) =>
                        update("maxRetries", event.target.value)
                      }
                      type="number"
                      value={draft.maxRetries}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel>{copy.concurrency}</FieldLabel>
                  <Select
                    onValueChange={(value) =>
                      update(
                        "concurrencyPolicy",
                        value as AutomationConcurrencyPolicy
                      )
                    }
                    value={draft.concurrencyPolicy}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" position="popper">
                      <SelectItem value="skip">{copy.skip}</SelectItem>
                      <SelectItem value="queue">{copy.queue}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel>{copy.misfire}</FieldLabel>
                  <Select
                    onValueChange={(value) =>
                      update("misfirePolicy", value as AutomationMisfirePolicy)
                    }
                    value={draft.misfirePolicy}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start" position="popper">
                      <SelectItem value="run_once">{copy.runOnce}</SelectItem>
                      <SelectItem value="skip">{copy.skipMissed}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {numericValue(draft.maxRetries, 0) > 0 ? (
                  <Field>
                    <FieldLabel htmlFor="automation-retry-delay">
                      {copy.retryDelay}
                    </FieldLabel>
                    <Input
                      id="automation-retry-delay"
                      max={86_400}
                      min={10}
                      onChange={(event) =>
                        update("retryDelaySeconds", event.target.value)
                      }
                      type="number"
                      value={draft.retryDelaySeconds}
                    />
                  </Field>
                ) : null}
                <Field orientation="horizontal">
                  <FieldLabel htmlFor="automation-enabled">
                    {copy.enabledAtSave}
                  </FieldLabel>
                  <Switch
                    checked={draft.enabled}
                    id="automation-enabled"
                    onCheckedChange={(checked) => update("enabled", checked)}
                  />
                </Field>
              </FieldSet>

              {invalid ? (
                <p className="text-sm text-destructive" role="alert">
                  {copy.formInvalid}
                </p>
              ) : null}
            </FieldGroup>
          </div>

          <DialogFooter className="shrink-0 flex-row justify-end border-t px-6 py-4">
            <Button
              disabled={saving}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {copy.cancel}
            </Button>
            <Button disabled={saving} type="submit">
              {task ? copy.saveChanges : copy.createTask}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
