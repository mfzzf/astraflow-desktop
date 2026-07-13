// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"

import { createSession } from "@/components/studio-chat/api"

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
