import type { ChatReasoningEffort } from "@/lib/chat-models"
import type { StudioPermissionMode } from "@/lib/studio-types"

export const automationKinds = ["ai", "command"] as const
export const automationScheduleKinds = [
  "once",
  "interval",
  "daily",
  "weekly",
  "cron",
] as const
export const automationIntervalUnits = ["minutes", "hours", "days"] as const
export const automationConcurrencyPolicies = ["skip", "queue"] as const
export const automationMisfirePolicies = ["run_once", "skip"] as const
export const automationRunTriggers = [
  "schedule",
  "catch_up",
  "manual",
  "retry",
] as const
export const automationRunStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
] as const
export const automationPermissionModes = [
  "readonly",
  "auto",
  "full_access",
] as const satisfies readonly StudioPermissionMode[]

export type AutomationKind = (typeof automationKinds)[number]
export type AutomationScheduleKind = (typeof automationScheduleKinds)[number]
export type AutomationIntervalUnit = (typeof automationIntervalUnits)[number]
export type AutomationConcurrencyPolicy =
  (typeof automationConcurrencyPolicies)[number]
export type AutomationMisfirePolicy = (typeof automationMisfirePolicies)[number]
export type AutomationRunTrigger = (typeof automationRunTriggers)[number]
export type AutomationRunStatus = (typeof automationRunStatuses)[number]
export type AutomationPermissionMode =
  (typeof automationPermissionModes)[number]

export type AutomationSchedule =
  | {
      kind: "once"
      localDateTime: string
    }
  | {
      kind: "interval"
      every: number
      unit: AutomationIntervalUnit
      anchorAt: string
    }
  | {
      kind: "daily"
      time: string
    }
  | {
      kind: "weekly"
      weekdays: number[]
      time: string
    }
  | {
      kind: "cron"
      expression: string
    }

export type AutomationAiPayload = {
  prompt: string
  runtimeId: string
  model: string
  reasoningEffort: ChatReasoningEffort | null
  permissionMode: AutomationPermissionMode
}

export type AutomationCommandPayload = {
  command: string
  workingDirectory: string
  maxLogBytes: number
}

type AutomationTaskBase = {
  id: string
  name: string
  enabled: boolean
  workspaceId: string | null
  schedule: AutomationSchedule
  timeZone: string
  timeoutSeconds: number
  concurrencyPolicy: AutomationConcurrencyPolicy
  misfirePolicy: AutomationMisfirePolicy
  maxRetries: number
  retryDelaySeconds: number
  nextRunAt: string | null
  lastRunAt: string | null
  lastRunStatus: AutomationRunStatus | null
  createdAt: string
  updatedAt: string
}

export type AutomationTask = AutomationTaskBase &
  (
    | { kind: "ai"; payload: AutomationAiPayload }
    | { kind: "command"; payload: AutomationCommandPayload }
  )

export type AutomationTaskInput = Omit<
  AutomationTask,
  "id" | "nextRunAt" | "lastRunAt" | "lastRunStatus" | "createdAt" | "updatedAt"
>

export type AutomationRun = {
  id: string
  taskId: string
  taskName: string
  taskKind: AutomationKind
  scheduledFor: string
  availableAt: string
  trigger: AutomationRunTrigger
  status: AutomationRunStatus
  attempt: number
  sessionId: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  startedAt: string | null
  finishedAt: string | null
  exitCode: number | null
  outputPreview: string
  logPath: string | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export type AutomationRunExecutionResult = {
  exitCode?: number | null
  logPath?: string | null
  outputPreview?: string
  sessionId?: string | null
}

export type AutomationExecutorOutcome =
  | {
      ok: true
      result: AutomationRunExecutionResult
    }
  | {
      ok: false
      error: string
      result: AutomationRunExecutionResult
    }

export type AutomationOverview = {
  tasks: AutomationTask[]
  activeCount: number
  totalCount: number
}

export function automationTaskToInput(
  task: AutomationTask
): AutomationTaskInput {
  return {
    name: task.name,
    kind: task.kind,
    enabled: task.enabled,
    workspaceId: task.workspaceId,
    schedule: task.schedule,
    timeZone: task.timeZone,
    payload: task.payload,
    timeoutSeconds: task.timeoutSeconds,
    concurrencyPolicy: task.concurrencyPolicy,
    misfirePolicy: task.misfirePolicy,
    maxRetries: task.maxRetries,
    retryDelaySeconds: task.retryDelaySeconds,
  } as AutomationTaskInput
}
