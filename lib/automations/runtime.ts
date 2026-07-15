import "server-only"

import { randomUUID } from "node:crypto"

import { executeAiAutomation } from "./executors/ai"
import { executeCommandAutomation } from "./executors/command"
import { queueAutomationDesktopNotification } from "./notifications"
import {
  cancelAutomationRunRecord,
  claimNextAutomationRun,
  completeAutomationRun,
  enqueueDueAutomationRuns,
  failAutomationRun,
  getAutomationRun,
  pruneAutomationRunHistory,
  reconcileExpiredAutomationRuns,
  refreshAutomationRunLease,
} from "./store"
import type { AutomationRun, AutomationTask } from "./types"

const SCHEDULER_INTERVAL_MS = 15_000
const LEASE_DURATION_MS = 60_000
const LEASE_REFRESH_INTERVAL_MS = 15_000
const MAX_CONCURRENT_RUNS = 2
const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000

type ActiveAutomationExecution = {
  taskId: string
  cancel: (() => void) | null
  cancelRequested: boolean
}

type AutomationRuntimeState = {
  owner: string
  timer: ReturnType<typeof setInterval> | null
  tickPromise: Promise<void> | null
  active: Map<string, ActiveAutomationExecution>
  lastMaintenanceAt: number
  started: boolean
}

declare global {
  var astraflowAutomationRuntimeState: AutomationRuntimeState | undefined
}

function runtimeState() {
  if (!globalThis.astraflowAutomationRuntimeState) {
    globalThis.astraflowAutomationRuntimeState = {
      owner: randomUUID(),
      timer: null,
      tickPromise: null,
      active: new Map(),
      lastMaintenanceAt: 0,
      started: false,
    }
  }

  return globalThis.astraflowAutomationRuntimeState
}

function executionError(error: unknown) {
  return error instanceof Error ? error.message : "Automation execution failed."
}

async function executeClaimedRun(task: AutomationTask, run: AutomationRun) {
  const state = runtimeState()
  const active: ActiveAutomationExecution = {
    taskId: task.id,
    cancel: null,
    cancelRequested: false,
  }
  state.active.set(run.id, active)

  const registerCancel = (cancel: () => void) => {
    active.cancel = cancel
    if (active.cancelRequested) {
      cancel()
    }
  }
  const heartbeat = setInterval(() => {
    refreshAutomationRunLease({
      runId: run.id,
      owner: state.owner,
      leaseDurationMs: LEASE_DURATION_MS,
    })
  }, LEASE_REFRESH_INTERVAL_MS)
  heartbeat.unref?.()

  try {
    const outcome =
      task.kind === "ai"
        ? await executeAiAutomation({ task, run, registerCancel })
        : await executeCommandAutomation({ task, run, registerCancel })

    if (outcome.ok) {
      const completed = completeAutomationRun(run.id, outcome.result)
      if (completed) {
        queueAutomationDesktopNotification({ run: completed, task })
      }
    } else {
      const failed = failAutomationRun(run.id, outcome.error, outcome.result)
      if (failed?.status === "failed") {
        queueAutomationDesktopNotification({ run: failed, task })
      }
    }
  } catch (error) {
    const failed = failAutomationRun(run.id, executionError(error))
    if (failed?.status === "failed") {
      queueAutomationDesktopNotification({ run: failed, task })
    }
  } finally {
    clearInterval(heartbeat)
    state.active.delete(run.id)
    requestAutomationSchedulerTick()
  }
}

async function performSchedulerTick() {
  const state = runtimeState()

  if (Date.now() - (state.lastMaintenanceAt ?? 0) >= MAINTENANCE_INTERVAL_MS) {
    pruneAutomationRunHistory()
    state.lastMaintenanceAt = Date.now()
  }

  reconcileExpiredAutomationRuns(new Date(), state.owner)
  enqueueDueAutomationRuns()

  while (state.active.size < MAX_CONCURRENT_RUNS) {
    const claimed = claimNextAutomationRun({
      owner: state.owner,
      leaseDurationMs: LEASE_DURATION_MS,
    })
    if (!claimed) {
      break
    }

    void executeClaimedRun(claimed.task, claimed.run)
  }
}

export function requestAutomationSchedulerTick() {
  const state = runtimeState()
  if (state.tickPromise) {
    return state.tickPromise
  }

  const tick = performSchedulerTick()
    .catch((error) => {
      console.error(
        "[automations] scheduler_tick_failed",
        executionError(error)
      )
    })
    .finally(() => {
      if (state.tickPromise === tick) {
        state.tickPromise = null
      }
    })
  state.tickPromise = tick
  return tick
}

export function ensureAutomationRuntimeStarted() {
  const state = runtimeState()
  if (state.started) {
    return
  }

  state.started = true
  state.timer = setInterval(
    () => void requestAutomationSchedulerTick(),
    SCHEDULER_INTERVAL_MS
  )
  state.timer.unref?.()
  void requestAutomationSchedulerTick()
}

export function cancelAutomationRun(runId: string) {
  const run = cancelAutomationRunRecord(runId)
  const active = runtimeState().active.get(runId)

  if (active) {
    active.cancelRequested = true
    active.cancel?.()
  }

  return run ?? getAutomationRun(runId)
}

export function isAutomationRunActive(runId: string) {
  return runtimeState().active.has(runId)
}
