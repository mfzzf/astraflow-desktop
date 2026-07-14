"use client"

import type { StudioWorkspace } from "@/lib/studio-types"

import { submitStudioFeedback } from "./api"

const MAX_CONSOLE_ERROR_ENTRIES = 20
const MAX_CONSOLE_ERROR_LENGTH = 1_200
const MAX_FEEDBACK_DESCRIPTION_LENGTH = 3_900
const PANEL_OPEN_VERIFICATION_DELAY_MS = 800
const AUTOMATIC_FEEDBACK_COOLDOWN_MS = 5 * 60 * 1000
const REDACTED_VALUE = "[REDACTED]"

export type StudioPanelKind = "terminal" | "right"

export type StudioPanelVisibilitySnapshot = {
  found: boolean
  connected: boolean
  ariaHidden: string | null
  width: number
  height: number
  display: string
  visibility: string
}

type StudioPanelFailureContext = {
  panel: StudioPanelKind
  locale: "en" | "zh"
  sessionId?: string
  workspace: StudioWorkspace | null
  snapshot: StudioPanelVisibilitySnapshot
}

type StudioRuntimeFailureContext = {
  source: "start_request" | "live_snapshot"
  locale: "en" | "zh"
  sessionId: string
  runId?: string
  runtimeId: string
  model: string
  environment?: "local" | "remote" | null
  workspace: StudioWorkspace | null
  error: string
}

type ConsoleErrorEntry = {
  timestamp: string
  message: string
}

const consoleErrorEntries: ConsoleErrorEntry[] = []
const lastAutomaticFeedbackAt = new Map<string, number>()

let consoleCaptureSubscribers = 0
let originalConsoleError: typeof console.error | null = null
let installedConsoleErrorWrapper: typeof console.error | null = null

function truncate(value: string, maximumLength: number) {
  return value.length <= maximumLength
    ? value
    : `${value.slice(0, Math.max(0, maximumLength - 1))}…`
}

function isSensitiveKey(key: string) {
  return /(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key)/i.test(
    key
  )
}

export function redactStudioDiagnosticText(value: string) {
  return value
    .replace(
      /\bauthorization\b(\s*[:=]\s*)(?:Bearer\s+)?([^\s,;]+)/gi,
      (_match, separator: string) =>
        `Authorization${separator}${REDACTED_VALUE}`
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED_VALUE}`)
    .replace(
      /\b(cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key)\b(\s*[:=]\s*)([^\s,;]+)/gi,
      (_match, key: string, separator: string) =>
        `${key}${separator}${REDACTED_VALUE}`
    )
}

function serializeConsoleValue(value: unknown) {
  if (value instanceof Error) {
    return [value.name, value.message, value.stack].filter(Boolean).join(": ")
  }

  if (typeof value === "string") {
    return value
  }

  if (value === undefined) {
    return "undefined"
  }

  if (value === null || typeof value !== "object") {
    return String(value)
  }

  const visited = new WeakSet<object>()

  try {
    return JSON.stringify(value, (key, nestedValue: unknown) => {
      if (isSensitiveKey(key)) {
        return REDACTED_VALUE
      }

      if (nestedValue && typeof nestedValue === "object") {
        if (visited.has(nestedValue)) {
          return "[Circular]"
        }

        visited.add(nestedValue)
      }

      return nestedValue
    })
  } catch {
    return String(value)
  }
}

function formatConsoleError(args: unknown[]) {
  return truncate(
    redactStudioDiagnosticText(args.map(serializeConsoleValue).join(" ")),
    MAX_CONSOLE_ERROR_LENGTH
  )
}

export function recordStudioConsoleError(
  args: unknown[],
  timestamp = new Date().toISOString()
) {
  const message = formatConsoleError(args)

  if (!message) {
    return
  }

  consoleErrorEntries.push({ timestamp, message })

  if (consoleErrorEntries.length > MAX_CONSOLE_ERROR_ENTRIES) {
    consoleErrorEntries.splice(
      0,
      consoleErrorEntries.length - MAX_CONSOLE_ERROR_ENTRIES
    )
  }
}

function getRecentConsoleErrors() {
  return [...consoleErrorEntries]
    .reverse()
    .map((entry) => `[${entry.timestamp}] ${entry.message}`)
}

function emitStudioDiagnosticWarning(...args: unknown[]) {
  recordStudioConsoleError(args)
  console.warn(...args)
}

function handleWindowError(event: ErrorEvent) {
  recordStudioConsoleError([
    "[window.error]",
    event.error ?? event.message,
    event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "",
  ])
}

function handleUnhandledRejection(event: PromiseRejectionEvent) {
  recordStudioConsoleError(["[unhandledrejection]", event.reason])
}

export function installStudioConsoleErrorCapture() {
  if (typeof window === "undefined") {
    return () => undefined
  }

  consoleCaptureSubscribers += 1

  if (consoleCaptureSubscribers === 1) {
    originalConsoleError = console.error
    installedConsoleErrorWrapper = (...args: unknown[]) => {
      recordStudioConsoleError(args)
      originalConsoleError?.(...args)
    }
    console.error = installedConsoleErrorWrapper
    window.addEventListener("error", handleWindowError)
    window.addEventListener("unhandledrejection", handleUnhandledRejection)
  }

  let uninstalled = false

  return () => {
    if (uninstalled) {
      return
    }

    uninstalled = true
    consoleCaptureSubscribers = Math.max(0, consoleCaptureSubscribers - 1)

    if (consoleCaptureSubscribers > 0) {
      return
    }

    window.removeEventListener("error", handleWindowError)
    window.removeEventListener("unhandledrejection", handleUnhandledRejection)

    if (
      originalConsoleError &&
      installedConsoleErrorWrapper &&
      console.error === installedConsoleErrorWrapper
    ) {
      console.error = originalConsoleError
    }

    originalConsoleError = null
    installedConsoleErrorWrapper = null
  }
}

function getPanelSelector(panel: StudioPanelKind) {
  return panel === "terminal"
    ? '[data-testid="studio-terminal-panel"]'
    : '[data-testid="studio-right-panel"]'
}

export function readStudioPanelVisibility(
  panel: StudioPanelKind
): StudioPanelVisibilitySnapshot {
  if (typeof document === "undefined") {
    return {
      found: false,
      connected: false,
      ariaHidden: null,
      width: 0,
      height: 0,
      display: "",
      visibility: "",
    }
  }

  const element = document.querySelector<HTMLElement>(getPanelSelector(panel))

  if (!element) {
    return {
      found: false,
      connected: false,
      ariaHidden: null,
      width: 0,
      height: 0,
      display: "",
      visibility: "",
    }
  }

  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)

  return {
    found: true,
    connected: element.isConnected,
    ariaHidden: element.getAttribute("aria-hidden"),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    display: style.display,
    visibility: style.visibility,
  }
}

export function isStudioPanelVisiblyOpen(
  panel: StudioPanelKind,
  snapshot: StudioPanelVisibilitySnapshot
) {
  const renderedSize = panel === "terminal" ? snapshot.height : snapshot.width

  return (
    snapshot.found &&
    snapshot.connected &&
    snapshot.ariaHidden !== "true" &&
    snapshot.display !== "none" &&
    snapshot.visibility !== "hidden" &&
    renderedSize >= 24
  )
}

function createAutomaticFeedbackDescription(
  diagnostics: Record<string, unknown>
) {
  const page =
    typeof window === "undefined"
      ? "unknown"
      : `${window.location.pathname}${window.location.search}`
  const consoleErrors = getRecentConsoleErrors()
  const description = [
    "[Automatic client diagnostic]",
    JSON.stringify({ ...diagnostics, page }, null, 2),
    "Recent console errors (newest first):",
    consoleErrors.length > 0 ? consoleErrors.join("\n") : "(none captured)",
  ].join("\n")

  return truncate(
    redactStudioDiagnosticText(description),
    MAX_FEEDBACK_DESCRIPTION_LENGTH
  )
}

export async function reportStudioPanelOpenFailure(
  context: StudioPanelFailureContext
) {
  const eventName = `${context.panel}_panel_open_failed`
  const now = Date.now()
  const lastReportedAt = lastAutomaticFeedbackAt.get(eventName) ?? 0

  emitStudioDiagnosticWarning("[studio-panels] open_verification_failed", {
    event: eventName,
    sessionId: context.sessionId ?? null,
    workspaceId: context.workspace?.id ?? null,
    snapshot: context.snapshot,
  })

  if (now - lastReportedAt < AUTOMATIC_FEEDBACK_COOLDOWN_MS) {
    return
  }

  lastAutomaticFeedbackAt.set(eventName, now)

  try {
    await submitStudioFeedback({
      targetMessageId: null,
      entryPoint: "titlebar",
      description: createAutomaticFeedbackDescription({
        event: eventName,
        panel: context.panel,
        sessionId: context.sessionId ?? null,
        workspace: context.workspace
          ? {
              id: context.workspace.id,
              type: context.workspace.type,
              rootPath: context.workspace.rootPath,
            }
          : null,
        visibility: context.snapshot,
      }),
      images: [],
      locale: context.locale,
    })
  } catch (error) {
    console.warn("[studio-feedback] automatic_report_failed", error)
  }
}

export async function reportStudioRuntimeFailure(
  context: StudioRuntimeFailureContext
) {
  const normalizedError = truncate(
    redactStudioDiagnosticText(context.error.trim() || "Unknown runtime error"),
    MAX_CONSOLE_ERROR_LENGTH
  )
  const reportKey = context.runId
    ? `runtime:${context.runId}`
    : `runtime:${context.sessionId}:${context.runtimeId}:${normalizedError}`
  const now = Date.now()
  const lastReportedAt = lastAutomaticFeedbackAt.get(reportKey) ?? 0
  const diagnostics = {
    event: "runtime_failed",
    source: context.source,
    sessionId: context.sessionId,
    runId: context.runId ?? null,
    runtimeId: context.runtimeId,
    model: context.model,
    environment: context.environment ?? null,
    workspace: context.workspace
      ? {
          id: context.workspace.id,
          type: context.workspace.type,
          rootPath: context.workspace.rootPath,
        }
      : null,
    error: normalizedError,
  }

  if (now - lastReportedAt < AUTOMATIC_FEEDBACK_COOLDOWN_MS) {
    return
  }

  lastAutomaticFeedbackAt.set(reportKey, now)
  emitStudioDiagnosticWarning("[studio-runtime] run_failed", diagnostics)

  try {
    await submitStudioFeedback({
      targetMessageId: null,
      entryPoint: "titlebar",
      description: createAutomaticFeedbackDescription(diagnostics),
      images: [],
      locale: context.locale,
    })
  } catch (error) {
    console.warn("[studio-feedback] automatic_runtime_report_failed", error)
  }
}

export function scheduleStudioPanelOpenVerification(
  context: Omit<StudioPanelFailureContext, "snapshot">
) {
  if (typeof window === "undefined") {
    return () => undefined
  }

  const timer = window.setTimeout(() => {
    const snapshot = readStudioPanelVisibility(context.panel)

    if (isStudioPanelVisiblyOpen(context.panel, snapshot)) {
      return
    }

    void reportStudioPanelOpenFailure({ ...context, snapshot })
  }, PANEL_OPEN_VERIFICATION_DELAY_MS)

  return () => window.clearTimeout(timer)
}

export function resetStudioClientDiagnosticsForTests() {
  consoleErrorEntries.length = 0
  lastAutomaticFeedbackAt.clear()
}
