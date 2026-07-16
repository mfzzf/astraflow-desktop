// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"

import {
  compactSessionRequest,
  createSession,
  getWorkspaceHistoryRequest,
  mutateWorkspaceHistoryRequest,
} from "@/components/studio-chat/api"

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("studio chat session creation", () => {
  test("creates a new session with its workspace binding atomically", async () => {
    let requestBody: Record<string, unknown> | null = null

    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>

      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            id: "session-1",
            mode: "chat",
            title: "Workspace task",
            projectId: "project-1",
            permissionMode: "auto",
            chatModel: "kimi-k2.5",
            chatRuntimeId: "astraflow",
            chatReasoningEffort: "medium",
            latestRunUsage: null,
            pinnedAt: null,
            archivedAt: null,
            isRunning: false,
            createdAt: "2026-07-13T00:00:00.000Z",
            updatedAt: "2026-07-13T00:00:00.000Z",
          },
        }),
        { headers: { "Content-Type": "application/json" }, status: 201 }
      )
    }

    const session = await createSession("Workspace task", {
      chatModel: "kimi-k2.5",
      chatRuntimeId: "astraflow",
      chatReasoningEffort: "medium",
      projectId: "project-1",
      permissionMode: "auto",
    })

    expect(session.projectId).toBe("project-1")
    expect(requestBody).toMatchObject({
      mode: "chat",
      projectId: "project-1",
      permissionMode: "auto",
    })
  })
})

describe("studio Pi command requests", () => {
  test("forwards custom compact instructions", async () => {
    let requestUrl = ""
    let requestBody: Record<string, unknown> | null = null

    globalThis.fetch = async (input, init) => {
      requestUrl = String(input)
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>

      return new Response(
        JSON.stringify({
          ok: true,
          data: { usage: null },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }

    await compactSessionRequest(
      "session with spaces",
      "Keep architectural decisions"
    )

    expect(requestUrl).toBe(
      "/api/studio/sessions/session%20with%20spaces/compact"
    )
    expect(requestBody).toEqual({
      instructions: "Keep architectural decisions",
    })
  })

  test("sends rewind actions and assistant message ids to workspace history", async () => {
    let requestBody: Record<string, unknown> | null = null

    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>

      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            messages: [],
            draft: "restored prompt",
            canUndo: false,
            canRedo: true,
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }

    const result = await mutateWorkspaceHistoryRequest({
      sessionId: "session-1",
      action: "rewind",
      assistantMessageId: "assistant-7",
    })

    expect(requestBody).toEqual({
      action: "rewind",
      assistantMessageId: "assistant-7",
    })
    expect(result.draft).toBe("restored prompt")
    expect(result.canRedo).toBe(true)
  })

  test("loads workspace history state for the tree command", async () => {
    let requestUrl = ""
    let requestInit: RequestInit | undefined

    globalThis.fetch = async (input, init) => {
      requestUrl = String(input)
      requestInit = init

      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            turns: [{ assistantMessageId: "assistant-1" }],
            canUndo: true,
            canRedo: false,
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }

    const history = await getWorkspaceHistoryRequest("session-1")

    expect(requestUrl).toBe(
      "/api/studio/sessions/session-1/workspace-history"
    )
    expect(requestInit).toEqual({ cache: "no-store" })
    expect(history.turns).toHaveLength(1)
  })
})
