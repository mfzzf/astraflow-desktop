import "server-only"

import { rmSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

export function automationLogDirectory() {
  const configured = process.env.ASTRAFLOW_AUTOMATION_LOG_DIR?.trim()
  if (configured) {
    return resolve(configured)
  }

  const databasePath =
    process.env.ASTRAFLOW_SQLITE_PATH?.trim() ||
    join(process.cwd(), ".data", "astraflow.sqlite")
  return join(dirname(databasePath), "automation-runs")
}

export function removeAutomationLog(logPath: string | null | undefined) {
  const target = resolveAutomationLogPath(logPath)
  if (!target) {
    return false
  }

  try {
    rmSync(target, { force: true })
    return true
  } catch (error) {
    console.warn("[automations] log_cleanup_failed", error)
    return false
  }
}

export function resolveAutomationLogPath(logPath: string | null | undefined) {
  if (!logPath) {
    return null
  }

  const root = resolve(automationLogDirectory())
  const target = resolve(logPath)
  const relativePath = relative(root, target)

  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    return null
  }

  return target
}
