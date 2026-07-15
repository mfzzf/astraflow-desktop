import "server-only"

import { randomUUID } from "node:crypto"

import type Database from "better-sqlite3"

import { getStudioDatabase } from "@/lib/studio-db/connection"
import { deleteStudioSession } from "@/lib/studio-db/sessions"
import { getStudioWorkspace } from "@/lib/studio-db/workspaces"

import { removeAutomationLog } from "./paths"
import { getLatestAutomationRunAt, getNextAutomationRunAt } from "./schedule"
import type {
  AutomationAiPayload,
  AutomationCommandPayload,
  AutomationKind,
  AutomationRun,
  AutomationRunExecutionResult,
  AutomationRunStatus,
  AutomationRunTrigger,
  AutomationSchedule,
  AutomationTask,
  AutomationTaskInput,
} from "./types"
import { automationTaskToInput } from "./types"
import {
  automationAiPayloadSchema,
  automationCommandPayloadSchema,
  automationScheduleSchema,
  parseAutomationTaskInput,
} from "./validation"

const MISFIRE_GRACE_MS = 60_000
const OUTPUT_PREVIEW_LIMIT = 64 * 1024

type AutomationTaskRow = {
  id: string
  name: string
  kind: AutomationKind
  enabled: number
  workspace_id: string | null
  schedule_kind: string
  schedule_config: string
  time_zone: string
  payload: string
  timeout_seconds: number
  concurrency_policy: "skip" | "queue"
  misfire_policy: "run_once" | "skip"
  max_retries: number
  retry_delay_seconds: number
  next_run_at: string | null
  last_run_at: string | null
  last_run_status: AutomationRunStatus | null
  created_at: string
  updated_at: string
}

type AutomationRunRow = {
  id: string
  task_id: string
  task_name: string
  task_kind: AutomationKind
  scheduled_for: string
  available_at: string
  trigger: AutomationRunTrigger
  status: AutomationRunStatus
  attempt: number
  session_id: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  output_preview: string
  log_path: string | null
  error: string | null
  created_at: string
  updated_at: string
}

const TASK_COLUMNS = `
  id,
  name,
  kind,
  enabled,
  workspace_id,
  schedule_kind,
  schedule_config,
  time_zone,
  payload,
  timeout_seconds,
  concurrency_policy,
  misfire_policy,
  max_retries,
  retry_delay_seconds,
  next_run_at,
  last_run_at,
  last_run_status,
  created_at,
  updated_at
`

const RUN_COLUMNS = `
  run.id,
  run.task_id,
  task.name AS task_name,
  task.kind AS task_kind,
  run.scheduled_for,
  run.available_at,
  run.trigger,
  run.status,
  run.attempt,
  run.session_id,
  run.lease_owner,
  run.lease_expires_at,
  run.started_at,
  run.finished_at,
  run.exit_code,
  run.output_preview,
  run.log_path,
  run.error,
  run.created_at,
  run.updated_at
`

function nowIso(now = new Date()) {
  return now.toISOString()
}

function truncateOutput(value: string | undefined | null) {
  const normalized = value ?? ""
  return normalized.length > OUTPUT_PREVIEW_LIMIT
    ? normalized.slice(-OUTPUT_PREVIEW_LIMIT)
    : normalized
}

export function removeAutomationSession(sessionId: string) {
  try {
    deleteStudioSession(sessionId)
    return
  } catch (error) {
    console.warn("[automations] session_cleanup_failed", error)
  }

  try {
    getStudioDatabase()
      .prepare("DELETE FROM studio_sessions WHERE id = ?")
      .run(sessionId)
  } catch (error) {
    console.warn("[automations] session_cleanup_fallback_failed", error)
  }
}

function parseJson(value: string, label: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    throw new Error(`Stored ${label} JSON is invalid.`)
  }
}

function mapTask(row: AutomationTaskRow): AutomationTask {
  const schedule = automationScheduleSchema.parse(
    parseJson(row.schedule_config, "automation schedule")
  ) as AutomationSchedule

  if (schedule.kind !== row.schedule_kind) {
    throw new Error(
      "Stored automation schedule kind does not match its payload."
    )
  }

  const base = {
    id: row.id,
    name: row.name,
    enabled: Boolean(row.enabled),
    workspaceId: row.workspace_id,
    schedule,
    timeZone: row.time_zone,
    timeoutSeconds: row.timeout_seconds,
    concurrencyPolicy: row.concurrency_policy,
    misfirePolicy: row.misfire_policy,
    maxRetries: row.max_retries,
    retryDelaySeconds: row.retry_delay_seconds,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }

  if (row.kind === "ai") {
    return {
      ...base,
      kind: "ai",
      payload: automationAiPayloadSchema.parse(
        parseJson(row.payload, "automation AI payload")
      ) as AutomationAiPayload,
    }
  }

  return {
    ...base,
    kind: "command",
    payload: automationCommandPayloadSchema.parse(
      parseJson(row.payload, "automation command payload")
    ) as AutomationCommandPayload,
  }
}

function mapRun(row: AutomationRunRow): AutomationRun {
  return {
    id: row.id,
    taskId: row.task_id,
    taskName: row.task_name,
    taskKind: row.task_kind,
    scheduledFor: row.scheduled_for,
    availableAt: row.available_at,
    trigger: row.trigger,
    status: row.status,
    attempt: row.attempt,
    sessionId: row.session_id,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    exitCode: row.exit_code,
    outputPreview: row.output_preview,
    logPath: row.log_path,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateWorkspace(input: AutomationTaskInput) {
  if (!input.workspaceId) {
    if (input.kind === "command") {
      throw new Error("Command tasks require a local workspace.")
    }
    return
  }

  const workspace = getStudioWorkspace(input.workspaceId)
  if (!workspace) {
    throw new Error("Workspace was not found.")
  }
  if (input.kind === "command" && workspace.type !== "local") {
    throw new Error("Command tasks currently require a local workspace.")
  }
}

function nextRunAtForInput(input: AutomationTaskInput, now: Date) {
  if (!input.enabled) {
    return null
  }

  const nextRunAt = getNextAutomationRunAt({
    schedule: input.schedule,
    timeZone: input.timeZone,
    after: new Date(now.getTime() - 1),
  })

  if (!nextRunAt && input.schedule.kind === "once") {
    throw new Error("The one-time schedule must be in the future.")
  }

  return nextRunAt
}

function selectTaskRow(database: Database.Database, taskId: string) {
  return database
    .prepare(
      `
        SELECT ${TASK_COLUMNS}
        FROM studio_scheduled_tasks
        WHERE id = ?
      `
    )
    .get(taskId) as AutomationTaskRow | undefined
}

function selectRunRow(database: Database.Database, runId: string) {
  return database
    .prepare(
      `
        SELECT ${RUN_COLUMNS}
        FROM studio_scheduled_task_runs AS run
        JOIN studio_scheduled_tasks AS task ON task.id = run.task_id
        WHERE run.id = ?
      `
    )
    .get(runId) as AutomationRunRow | undefined
}

export function listAutomationTasks() {
  const rows = getStudioDatabase()
    .prepare(
      `
        SELECT ${TASK_COLUMNS}
        FROM studio_scheduled_tasks
        ORDER BY enabled DESC, COALESCE(next_run_at, updated_at) ASC, updated_at DESC
      `
    )
    .all() as AutomationTaskRow[]

  return rows.map(mapTask)
}

export function getAutomationTask(taskId: string) {
  const row = selectTaskRow(getStudioDatabase(), taskId)
  return row ? mapTask(row) : null
}

export function createAutomationTask(value: unknown, now = new Date()) {
  const input = parseAutomationTaskInput(value)
  validateWorkspace(input)

  const id = randomUUID()
  const timestamp = nowIso(now)
  const nextRunAt = nextRunAtForInput(input, now)

  getStudioDatabase()
    .prepare(
      `
        INSERT INTO studio_scheduled_tasks (
          id, name, kind, enabled, workspace_id, schedule_kind,
          schedule_config, time_zone, payload, timeout_seconds,
          concurrency_policy, misfire_policy, max_retries,
          retry_delay_seconds, next_run_at, last_run_at, last_run_status,
          created_at, updated_at
        ) VALUES (
          @id, @name, @kind, @enabled, @workspaceId, @scheduleKind,
          @scheduleConfig, @timeZone, @payload, @timeoutSeconds,
          @concurrencyPolicy, @misfirePolicy, @maxRetries,
          @retryDelaySeconds, @nextRunAt, NULL, NULL, @createdAt, @updatedAt
        )
      `
    )
    .run({
      id,
      name: input.name,
      kind: input.kind,
      enabled: input.enabled ? 1 : 0,
      workspaceId: input.workspaceId,
      scheduleKind: input.schedule.kind,
      scheduleConfig: JSON.stringify(input.schedule),
      timeZone: input.timeZone,
      payload: JSON.stringify(input.payload),
      timeoutSeconds: input.timeoutSeconds,
      concurrencyPolicy: input.concurrencyPolicy,
      misfirePolicy: input.misfirePolicy,
      maxRetries: input.maxRetries,
      retryDelaySeconds: input.retryDelaySeconds,
      nextRunAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

  return getAutomationTask(id)!
}

export function updateAutomationTask(
  taskId: string,
  value: unknown,
  now = new Date()
) {
  const existing = getAutomationTask(taskId)
  if (!existing) {
    return null
  }

  const input = parseAutomationTaskInput(value)
  validateWorkspace(input)
  const timestamp = nowIso(now)
  const nextRunAt = nextRunAtForInput(input, now)
  const database = getStudioDatabase()

  database
    .transaction(() => {
      const currentRow = selectTaskRow(database, taskId)
      if (!currentRow) {
        return
      }
      const current = mapTask(currentRow)

      if (input.kind !== current.kind) {
        const active = database
          .prepare(
            `
              SELECT 1
              FROM studio_scheduled_task_runs
              WHERE task_id = ? AND status IN ('queued', 'running')
              LIMIT 1
            `
          )
          .get(taskId)
        if (active) {
          throw new Error(
            "Task type cannot be changed while a run is queued or running."
          )
        }
      }

      database
        .prepare(
          `
          UPDATE studio_scheduled_tasks
          SET
            name = @name,
            kind = @kind,
            enabled = @enabled,
            workspace_id = @workspaceId,
            schedule_kind = @scheduleKind,
            schedule_config = @scheduleConfig,
            time_zone = @timeZone,
            payload = @payload,
            timeout_seconds = @timeoutSeconds,
            concurrency_policy = @concurrencyPolicy,
            misfire_policy = @misfirePolicy,
            max_retries = @maxRetries,
            retry_delay_seconds = @retryDelaySeconds,
            next_run_at = @nextRunAt,
            updated_at = @updatedAt
          WHERE id = @id
        `
        )
        .run({
          id: taskId,
          name: input.name,
          kind: input.kind,
          enabled: input.enabled ? 1 : 0,
          workspaceId: input.workspaceId,
          scheduleKind: input.schedule.kind,
          scheduleConfig: JSON.stringify(input.schedule),
          timeZone: input.timeZone,
          payload: JSON.stringify(input.payload),
          timeoutSeconds: input.timeoutSeconds,
          concurrencyPolicy: input.concurrencyPolicy,
          misfirePolicy: input.misfirePolicy,
          maxRetries: input.maxRetries,
          retryDelaySeconds: input.retryDelaySeconds,
          nextRunAt,
          updatedAt: timestamp,
        })

      if (current.enabled && !input.enabled) {
        database
          .prepare(
            `
            UPDATE studio_scheduled_task_runs
            SET status = 'cancelled', finished_at = ?, updated_at = ?,
                error = COALESCE(error, 'Task was disabled before execution.')
            WHERE task_id = ? AND status = 'queued'
          `
          )
          .run(timestamp, timestamp, taskId)
      }
    })
    .immediate()

  return getAutomationTask(taskId)
}

export function setAutomationTaskEnabled(
  taskId: string,
  enabled: boolean,
  now = new Date()
) {
  const task = getAutomationTask(taskId)
  if (!task) {
    return null
  }

  const input = { ...automationTaskToInput(task), enabled }
  if (enabled) {
    validateWorkspace(input)
  }
  const timestamp = nowIso(now)
  const nextRunAt = enabled ? nextRunAtForInput(input, now) : null
  const database = getStudioDatabase()

  database
    .transaction(() => {
      database
        .prepare(
          `
          UPDATE studio_scheduled_tasks
          SET enabled = ?, next_run_at = ?, updated_at = ?
          WHERE id = ?
        `
        )
        .run(enabled ? 1 : 0, nextRunAt, timestamp, taskId)

      if (!enabled) {
        database
          .prepare(
            `
            UPDATE studio_scheduled_task_runs
            SET status = 'cancelled', finished_at = ?, updated_at = ?,
                error = COALESCE(error, 'Task was disabled before execution.')
            WHERE task_id = ? AND status = 'queued'
          `
          )
          .run(timestamp, timestamp, taskId)
      }
    })
    .immediate()

  return getAutomationTask(taskId)
}

export function deleteAutomationTask(taskId: string) {
  const database = getStudioDatabase()
  const result = database
    .transaction(() => {
      const active = database
        .prepare(
          `
            SELECT 1
            FROM studio_scheduled_task_runs
            WHERE task_id = ? AND status IN ('queued', 'running')
            LIMIT 1
          `
        )
        .get(taskId)
      if (active) {
        return { artifacts: [], deleted: false }
      }

      const artifacts = database
        .prepare(
          `
            SELECT session_id, log_path
            FROM studio_scheduled_task_runs
            WHERE task_id = ?
          `
        )
        .all(taskId) as Array<{
        session_id: string | null
        log_path: string | null
      }>
      const deletion = database
        .prepare("DELETE FROM studio_scheduled_tasks WHERE id = ?")
        .run(taskId)

      return { artifacts, deleted: deletion.changes > 0 }
    })
    .immediate()

  if (result.deleted) {
    for (const row of result.artifacts) {
      if (row.session_id) {
        removeAutomationSession(row.session_id)
      }
      removeAutomationLog(row.log_path)
    }
  }

  return result.deleted
}

export function listAutomationRuns({
  taskId,
  limit = 100,
}: {
  taskId?: string
  limit?: number
} = {}) {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  const database = getStudioDatabase()
  const rows = taskId
    ? (database
        .prepare(
          `
            SELECT ${RUN_COLUMNS}
            FROM studio_scheduled_task_runs AS run
            JOIN studio_scheduled_tasks AS task ON task.id = run.task_id
            WHERE run.task_id = ?
            ORDER BY run.created_at DESC
            LIMIT ?
          `
        )
        .all(taskId, safeLimit) as AutomationRunRow[])
    : (database
        .prepare(
          `
            SELECT ${RUN_COLUMNS}
            FROM studio_scheduled_task_runs AS run
            JOIN studio_scheduled_tasks AS task ON task.id = run.task_id
            ORDER BY run.created_at DESC
            LIMIT ?
          `
        )
        .all(safeLimit) as AutomationRunRow[])

  return rows.map(mapRun)
}

export function getAutomationRun(runId: string) {
  const row = selectRunRow(getStudioDatabase(), runId)
  return row ? mapRun(row) : null
}

function insertRun(
  database: Database.Database,
  {
    task,
    scheduledFor,
    trigger,
    status = "queued",
    error = null,
    now = new Date(),
  }: {
    task: AutomationTask
    scheduledFor: string
    trigger: AutomationRunTrigger
    status?: AutomationRunStatus
    error?: string | null
    now?: Date
  }
) {
  const id = randomUUID()
  const timestamp = nowIso(now)
  const result = database
    .prepare(
      `
        INSERT OR IGNORE INTO studio_scheduled_task_runs (
          id, task_id, scheduled_for, available_at, trigger, status, attempt,
          session_id, lease_owner, lease_expires_at, started_at, finished_at,
          exit_code, output_preview, log_path, error, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, ?,
          NULL, '', NULL, ?, ?, ?
        )
      `
    )
    .run(
      id,
      task.id,
      scheduledFor,
      timestamp,
      trigger,
      status,
      status === "skipped" || status === "cancelled" ? timestamp : null,
      error,
      timestamp,
      timestamp
    )

  return result.changes > 0 ? id : null
}

export function enqueueAutomationRunNow(taskId: string, now = new Date()) {
  const database = getStudioDatabase()
  const runId = database
    .transaction(() => {
      const taskRow = selectTaskRow(database, taskId)
      if (!taskRow) {
        throw new Error("Automation task was not found.")
      }

      const task = mapTask(taskRow)
      if (task.concurrencyPolicy === "skip") {
        const active = database
          .prepare(
            `
            SELECT 1
            FROM studio_scheduled_task_runs
            WHERE task_id = ? AND status IN ('queued', 'running')
            LIMIT 1
          `
          )
          .get(taskId)
        if (active) {
          throw new Error("This task already has an active run.")
        }
      }

      return insertRun(database, {
        task,
        scheduledFor: nowIso(now),
        trigger: "manual",
        now,
      })
    })
    .immediate()

  if (!runId) {
    throw new Error("Failed to enqueue the automation run.")
  }

  return getAutomationRun(runId)!
}

export function enqueueDueAutomationRuns(now = new Date()) {
  const database = getStudioDatabase()
  const timestamp = nowIso(now)
  const taskRows = database
    .prepare(
      `
        SELECT ${TASK_COLUMNS}
        FROM studio_scheduled_tasks
        WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
        ORDER BY next_run_at ASC
        LIMIT 100
      `
    )
    .all(timestamp) as AutomationTaskRow[]

  return database
    .transaction(() => {
      let enqueued = 0

      for (const row of taskRows) {
        const currentRow = selectTaskRow(database, row.id)
        if (
          !currentRow ||
          currentRow.enabled !== 1 ||
          currentRow.next_run_at !== row.next_run_at
        ) {
          continue
        }

        const task = mapTask(currentRow)
        const scheduledFor = task.nextRunAt
        if (!scheduledFor) {
          continue
        }

        const lateness = now.getTime() - new Date(scheduledFor).getTime()
        const missed = lateness > MISFIRE_GRACE_MS
        const effectiveScheduledFor = missed
          ? (getLatestAutomationRunAt({
              schedule: task.schedule,
              timeZone: task.timeZone,
              atOrBefore: now,
            }) ?? scheduledFor)
          : scheduledFor
        const hasActive = Boolean(
          database
            .prepare(
              `
              SELECT 1
              FROM studio_scheduled_task_runs
              WHERE task_id = ? AND status IN ('queued', 'running')
              LIMIT 1
            `
            )
            .get(task.id)
        )
        const shouldSkipMisfire = missed && task.misfirePolicy === "skip"
        const shouldSkipOverlap = hasActive && task.concurrencyPolicy === "skip"
        const status =
          shouldSkipMisfire || shouldSkipOverlap ? "skipped" : "queued"
        const error = shouldSkipMisfire
          ? "Missed while AstraFlow was not running."
          : shouldSkipOverlap
            ? "Skipped because the previous run was still active."
            : null
        const runId = insertRun(database, {
          task,
          scheduledFor: effectiveScheduledFor,
          trigger: missed ? "catch_up" : "schedule",
          status,
          error,
          now,
        })

        if (runId && status === "queued") {
          enqueued += 1
        }

        const nextRunAt = getNextAutomationRunAt({
          schedule: task.schedule,
          timeZone: task.timeZone,
          after: now,
        })
        database
          .prepare(
            `
            UPDATE studio_scheduled_tasks
            SET next_run_at = ?,
                last_run_at = CASE WHEN ? = 'skipped' THEN ? ELSE last_run_at END,
                last_run_status = CASE WHEN ? = 'skipped' THEN 'skipped' ELSE last_run_status END,
                updated_at = ?
            WHERE id = ?
          `
          )
          .run(nextRunAt, status, timestamp, status, timestamp, task.id)
      }

      return enqueued
    })
    .immediate()
}

export function claimNextAutomationRun({
  owner,
  now = new Date(),
  leaseDurationMs,
}: {
  owner: string
  now?: Date
  leaseDurationMs: number
}) {
  const database = getStudioDatabase()
  const timestamp = nowIso(now)
  const leaseExpiresAt = nowIso(new Date(now.getTime() + leaseDurationMs))

  const claimedId = database
    .transaction(() => {
      const candidates = database
        .prepare(
          `
          SELECT run.id, run.task_id
          FROM studio_scheduled_task_runs AS run
          WHERE run.status = 'queued' AND run.available_at <= ?
          ORDER BY run.available_at ASC, run.created_at ASC
          LIMIT 20
        `
        )
        .all(timestamp) as Array<{ id: string; task_id: string }>

      for (const candidate of candidates) {
        const result = database
          .prepare(
            `
            UPDATE studio_scheduled_task_runs AS run
            SET status = 'running', lease_owner = ?, lease_expires_at = ?,
                started_at = COALESCE(started_at, ?), updated_at = ?
            WHERE run.id = ? AND run.status = 'queued'
              AND NOT EXISTS (
                SELECT 1
                FROM studio_scheduled_task_runs AS active
                WHERE active.task_id = run.task_id
                  AND active.status = 'running'
                  AND active.id != run.id
              )
          `
          )
          .run(owner, leaseExpiresAt, timestamp, timestamp, candidate.id)

        if (result.changes > 0) {
          return candidate.id
        }
      }

      return null
    })
    .immediate()

  if (!claimedId) {
    return null
  }

  const run = getAutomationRun(claimedId)
  const task = run ? getAutomationTask(run.taskId) : null
  return run && task ? { run, task } : null
}

export function refreshAutomationRunLease({
  runId,
  owner,
  now = new Date(),
  leaseDurationMs,
}: {
  runId: string
  owner: string
  now?: Date
  leaseDurationMs: number
}) {
  const result = getStudioDatabase()
    .prepare(
      `
        UPDATE studio_scheduled_task_runs
        SET lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND status = 'running' AND lease_owner = ?
      `
    )
    .run(
      nowIso(new Date(now.getTime() + leaseDurationMs)),
      nowIso(now),
      runId,
      owner
    )

  return result.changes > 0
}

export function attachAutomationRunSession(runId: string, sessionId: string) {
  const result = getStudioDatabase()
    .prepare(
      `
        UPDATE studio_scheduled_task_runs
        SET session_id = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `
    )
    .run(sessionId, nowIso(), runId)

  return result.changes > 0
}

export function attachAutomationRunLog(runId: string, logPath: string) {
  const result = getStudioDatabase()
    .prepare(
      `
        UPDATE studio_scheduled_task_runs
        SET log_path = ?, updated_at = ?
        WHERE id = ? AND status = 'running'
      `
    )
    .run(logPath, nowIso(), runId)

  return result.changes > 0
}

function updateTaskLastRun(
  database: Database.Database,
  taskId: string,
  status: AutomationRunStatus,
  timestamp: string
) {
  database
    .prepare(
      `
        UPDATE studio_scheduled_tasks
        SET last_run_at = ?, last_run_status = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(timestamp, status, timestamp, taskId)
}

export function completeAutomationRun(
  runId: string,
  result: AutomationRunExecutionResult = {},
  now = new Date()
) {
  const database = getStudioDatabase()
  const timestamp = nowIso(now)

  return database
    .transaction(() => {
      const run = getAutomationRun(runId)
      if (!run || run.status !== "running") {
        return getAutomationRun(runId)
      }

      database
        .prepare(
          `
          UPDATE studio_scheduled_task_runs
          SET status = 'succeeded', session_id = COALESCE(?, session_id),
              lease_owner = NULL, lease_expires_at = NULL, finished_at = ?,
              exit_code = ?, output_preview = ?,
              log_path = COALESCE(?, log_path), error = NULL,
              updated_at = ?
          WHERE id = ? AND status = 'running'
        `
        )
        .run(
          result.sessionId ?? null,
          timestamp,
          result.exitCode ?? null,
          truncateOutput(result.outputPreview),
          result.logPath ?? null,
          timestamp,
          runId
        )
      updateTaskLastRun(database, run.taskId, "succeeded", timestamp)
      return getAutomationRun(runId)
    })
    .immediate()
}

export function failAutomationRun(
  runId: string,
  error: string,
  result: AutomationRunExecutionResult = {},
  now = new Date()
) {
  const database = getStudioDatabase()
  const timestamp = nowIso(now)
  let discardedSessionId: string | null = null

  const updated = database
    .transaction(() => {
      const run = getAutomationRun(runId)
      const task = run ? getAutomationTask(run.taskId) : null
      if (!run || !task || run.status !== "running") {
        return getAutomationRun(runId)
      }

      if (task.enabled && run.attempt < task.maxRetries) {
        const availableAt = nowIso(
          new Date(now.getTime() + task.retryDelaySeconds * 1000)
        )

        if (run.sessionId) {
          discardedSessionId = run.sessionId
        }

        database
          .prepare(
            `
            UPDATE studio_scheduled_task_runs
            SET status = 'queued', trigger = 'retry', attempt = attempt + 1,
                available_at = ?, session_id = NULL,
                lease_owner = NULL, lease_expires_at = NULL, started_at = NULL,
                exit_code = ?, output_preview = ?,
                log_path = COALESCE(?, log_path), error = ?,
                updated_at = ?
            WHERE id = ? AND status = 'running'
          `
          )
          .run(
            availableAt,
            result.exitCode ?? null,
            truncateOutput(result.outputPreview),
            result.logPath ?? null,
            error,
            timestamp,
            runId
          )
        return getAutomationRun(runId)
      }

      database
        .prepare(
          `
          UPDATE studio_scheduled_task_runs
          SET status = 'failed', session_id = COALESCE(?, session_id),
              lease_owner = NULL, lease_expires_at = NULL, finished_at = ?,
              exit_code = ?, output_preview = ?,
              log_path = COALESCE(?, log_path), error = ?,
              updated_at = ?
          WHERE id = ? AND status = 'running'
        `
        )
        .run(
          result.sessionId ?? null,
          timestamp,
          result.exitCode ?? null,
          truncateOutput(result.outputPreview),
          result.logPath ?? null,
          error,
          timestamp,
          runId
        )
      updateTaskLastRun(database, run.taskId, "failed", timestamp)
      return getAutomationRun(runId)
    })
    .immediate()

  if (discardedSessionId) {
    removeAutomationSession(discardedSessionId)
  }

  return updated
}

export function cancelAutomationRunRecord(runId: string, now = new Date()) {
  const database = getStudioDatabase()
  const timestamp = nowIso(now)

  return database
    .transaction(() => {
      const run = getAutomationRun(runId)
      if (!run || !["queued", "running"].includes(run.status)) {
        return run
      }

      database
        .prepare(
          `
          UPDATE studio_scheduled_task_runs
          SET status = 'cancelled', lease_owner = NULL, lease_expires_at = NULL,
              finished_at = ?, error = COALESCE(error, 'Cancelled by user.'),
              updated_at = ?
          WHERE id = ? AND status IN ('queued', 'running')
        `
        )
        .run(timestamp, timestamp, runId)
      updateTaskLastRun(database, run.taskId, "cancelled", timestamp)
      return getAutomationRun(runId)
    })
    .immediate()
}

export function reconcileExpiredAutomationRuns(
  now = new Date(),
  excludeLeaseOwner: string | null = null
) {
  const rows = getStudioDatabase()
    .prepare(
      `
        SELECT run.id
        FROM studio_scheduled_task_runs AS run
        WHERE run.status = 'running'
          AND (run.lease_expires_at IS NULL OR run.lease_expires_at <= ?)
          AND (? IS NULL OR run.lease_owner IS NULL OR run.lease_owner != ?)
      `
    )
    .all(nowIso(now), excludeLeaseOwner, excludeLeaseOwner) as Array<{
    id: string
  }>

  for (const row of rows) {
    failAutomationRun(
      row.id,
      "Execution was interrupted because the AstraFlow runtime stopped.",
      {},
      now
    )
  }

  return rows.length
}

export function pruneAutomationRunHistory({
  maxRunsPerTask = 200,
  now = new Date(),
  retentionDays = 30,
}: {
  maxRunsPerTask?: number
  now?: Date
  retentionDays?: number
} = {}) {
  const database = getStudioDatabase()
  const safeMaxRuns = Math.max(10, Math.min(1_000, Math.floor(maxRunsPerTask)))
  const safeRetentionDays = Math.max(
    1,
    Math.min(365, Math.floor(retentionDays))
  )
  const cutoff = nowIso(
    new Date(now.getTime() - safeRetentionDays * 24 * 60 * 60 * 1000)
  )
  const rows = database
    .prepare(
      `
        WITH ranked AS (
          SELECT
            id,
            session_id,
            log_path,
            status,
            created_at,
            ROW_NUMBER() OVER (
              PARTITION BY task_id
              ORDER BY created_at DESC, id DESC
            ) AS task_rank
          FROM studio_scheduled_task_runs
        )
        SELECT id, session_id, log_path
        FROM ranked
        WHERE status IN ('succeeded', 'failed', 'cancelled', 'skipped')
          AND (created_at < ? OR task_rank > ?)
        LIMIT 500
      `
    )
    .all(cutoff, safeMaxRuns) as Array<{
    id: string
    session_id: string | null
    log_path: string | null
  }>

  const removedRows = database
    .transaction(() => {
      const removed: typeof rows = []

      for (const row of rows) {
        const result = database
          .prepare(
            `
            DELETE FROM studio_scheduled_task_runs
            WHERE id = ?
              AND status IN ('succeeded', 'failed', 'cancelled', 'skipped')
          `
          )
          .run(row.id)
        if (result.changes === 0) {
          continue
        }

        removed.push(row)
      }

      return removed
    })
    .immediate()

  for (const row of removedRows) {
    if (row.session_id) {
      removeAutomationSession(row.session_id)
    }
    removeAutomationLog(row.log_path)
  }

  return removedRows.length
}

export function hasActiveAutomationRuns(taskId: string) {
  return Boolean(
    getStudioDatabase()
      .prepare(
        `
          SELECT 1
          FROM studio_scheduled_task_runs
          WHERE task_id = ? AND status IN ('queued', 'running')
          LIMIT 1
        `
      )
      .get(taskId)
  )
}
