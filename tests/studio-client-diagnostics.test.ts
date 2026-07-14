// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import {
  isStudioPanelVisiblyOpen,
  recordStudioConsoleError,
  redactStudioDiagnosticText,
  reportStudioPanelOpenFailure,
  reportStudioRuntimeFailure,
  resetStudioClientDiagnosticsForTests,
} from "@/components/studio-chat/client-diagnostics"
import { createStudioDefaultHomeWorkspace } from "@/lib/studio-default-workspace"

const originalConsoleError = console.error
const originalConsoleWarn = console.warn
const originalFetch = globalThis.fetch

beforeEach(() => {
  resetStudioClientDiagnosticsForTests()
  console.error = () => undefined
  console.warn = () => undefined
})

afterEach(() => {
  console.error = originalConsoleError
  console.warn = originalConsoleWarn
  globalThis.fetch = originalFetch
})

describe("studio client diagnostics", () => {
  test("detects panels that changed state but have no rendered size", () => {
    expect(
      isStudioPanelVisiblyOpen("terminal", {
        found: true,
        connected: true,
        ariaHidden: "false",
        width: 1_200,
        height: 0,
        display: "block",
        visibility: "visible",
      })
    ).toBe(false)

    expect(
      isStudioPanelVisiblyOpen("right", {
        found: true,
        connected: true,
        ariaHidden: "false",
        width: 480,
        height: 800,
        display: "block",
        visibility: "visible",
      })
    ).toBe(true)
  })

  test("redacts credentials from captured console text", () => {
    expect(
      redactStudioDiagnosticText(
        "Authorization: Bearer abc.def token=top-secret password=hunter2"
      )
    ).toBe("Authorization: [REDACTED] token=[REDACTED] password=[REDACTED]")
  })

  test("submits one sessionless report with recent console errors", async () => {
    let requestCount = 0
    let requestBody: Record<string, unknown> | null = null

    globalThis.fetch = async (_input, init) => {
      requestCount += 1
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>

      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            feedbackId: "feedback-1",
            createdAt: "2026-07-14T00:00:00.000Z",
          },
        }),
        { headers: { "Content-Type": "application/json" }, status: 201 }
      )
    }

    recordStudioConsoleError(
      [
        "render failed",
        {
          authorization: "Bearer secret-token",
          apiKey: "secret-key",
        },
      ],
      "2026-07-14T00:00:00.000Z"
    )

    const context = {
      panel: "right" as const,
      locale: "zh" as const,
      sessionId: "session-1",
      workspace: createStudioDefaultHomeWorkspace("/Users/tester"),
      snapshot: {
        found: false,
        connected: false,
        ariaHidden: null,
        width: 0,
        height: 0,
        display: "",
        visibility: "",
      },
    }

    await reportStudioPanelOpenFailure(context)
    await reportStudioPanelOpenFailure(context)

    expect(requestCount).toBe(1)
    expect(requestBody).toMatchObject({
      entryPoint: "titlebar",
      targetMessageId: null,
      images: [],
      locale: "zh",
    })
    expect(requestBody).not.toHaveProperty("sessionId")
    expect(requestBody).not.toHaveProperty("messages")

    const description = String(
      (requestBody as Record<string, unknown> | null)?.description
    )

    expect(description).toContain("right_panel_open_failed")
    expect(description).toContain("session-1")
    expect(description).toContain("render failed")
    expect(description).toContain("[REDACTED]")
    expect(description).not.toContain("secret-token")
    expect(description).not.toContain("secret-key")
  })

  test("silently submits one report for a failed runtime run", async () => {
    let requestCount = 0
    let requestBody: Record<string, unknown> | null = null
    let consoleErrorCount = 0
    let consoleWarningCount = 0

    console.error = () => {
      consoleErrorCount += 1
    }
    console.warn = () => {
      consoleWarningCount += 1
    }

    globalThis.fetch = async (_input, init) => {
      requestCount += 1
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>

      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            feedbackId: "feedback-runtime-1",
            createdAt: "2026-07-14T00:00:00.000Z",
          },
        }),
        { headers: { "Content-Type": "application/json" }, status: 201 }
      )
    }

    recordStudioConsoleError(
      ["runtime stderr", { token: "runtime-secret" }],
      "2026-07-14T00:00:00.000Z"
    )

    const context = {
      source: "live_snapshot" as const,
      locale: "zh" as const,
      sessionId: "session-runtime-1",
      runId: "run-1",
      runtimeId: "codex-direct",
      model: "gpt-5.2-codex",
      environment: "local" as const,
      workspace: createStudioDefaultHomeWorkspace("/Users/tester"),
      error: "Runtime process exited unexpectedly",
    }

    await reportStudioRuntimeFailure(context)
    await reportStudioRuntimeFailure(context)

    expect(requestCount).toBe(1)
    expect(requestBody).toMatchObject({
      entryPoint: "titlebar",
      targetMessageId: null,
      images: [],
      locale: "zh",
    })
    expect(requestBody).not.toHaveProperty("sessionId")
    expect(requestBody).not.toHaveProperty("messages")

    const description = String(
      (requestBody as Record<string, unknown> | null)?.description
    )

    expect(description).toContain("runtime_failed")
    expect(description).toContain("live_snapshot")
    expect(description).toContain("codex-direct")
    expect(description).toContain("Runtime process exited unexpectedly")
    expect(description).toContain("runtime stderr")
    expect(description).not.toContain("runtime-secret")
    expect(consoleErrorCount).toBe(0)
    expect(consoleWarningCount).toBe(1)
  })
})
