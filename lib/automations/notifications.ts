import "server-only"

import { randomUUID } from "node:crypto"
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

import type { AutomationRun, AutomationTask } from "./types"

export type AutomationDesktopNotification = {
  id: string
  taskId: string
  taskName: string
  runId: string
  kind: AutomationTask["kind"]
  status: "succeeded" | "failed"
  error: string | null
  createdAt: string
}

function notificationDirectory() {
  const configured = process.env.ASTRAFLOW_AUTOMATION_NOTIFICATIONS_PATH?.trim()
  return configured ? resolve(configured) : null
}

export function queueAutomationDesktopNotification({
  run,
  task,
}: {
  run: AutomationRun
  task: AutomationTask
}) {
  if (run.status !== "succeeded" && run.status !== "failed") {
    return false
  }

  const directory = notificationDirectory()
  if (!directory) {
    return false
  }

  const id = randomUUID()
  const notification: AutomationDesktopNotification = {
    id,
    taskId: task.id,
    taskName: task.name,
    runId: run.id,
    kind: task.kind,
    status: run.status,
    error: run.error,
    createdAt: new Date().toISOString(),
  }
  const temporaryPath = join(directory, `.${id}.tmp`)
  const targetPath = join(directory, `${id}.json`)

  try {
    mkdirSync(directory, { recursive: true })
    writeFileSync(temporaryPath, JSON.stringify(notification), {
      encoding: "utf8",
      mode: 0o600,
    })
    renameSync(temporaryPath, targetPath)
    return true
  } catch (error) {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      // The original queue error is more useful than a cleanup failure.
    }
    console.warn("[automations] notification_queue_failed", error)
    return false
  }
}
