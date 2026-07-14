// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, mock, test } from "bun:test"

const timeoutCalls: Array<{
  timeoutMs: number
  options: { requestTimeoutMs?: number; signal?: AbortSignal } | undefined
}> = []

const sandbox = {
  sandboxId: "sandbox-lease-test",
  setTimeout: mock(
    async (
      timeoutMs: number,
      options?: { requestTimeoutMs?: number; signal?: AbortSignal }
    ) => {
      timeoutCalls.push({ timeoutMs, options })
    }
  ),
}

mock.module("@/lib/astraflow-session-sandbox", () => ({
  connectStudioSessionWorkspaceSandbox: async () => sandbox,
}))

describe("remote Agent sandbox timeout lease", () => {
  test("extends the sandbox timeout to one hour when a run starts", async () => {
    const { DeepAgentsE2BBackend } =
      await import("@/lib/agent/deepagents-e2b-backend")
    const controller = new AbortController()
    const backend = new DeepAgentsE2BBackend({
      apiKey: "test-api-key",
      permissionContext: {
        sessionId: "session-lease-test",
        permissionMode: "auto",
        projectId: null,
        emit: () => undefined,
        signal: controller.signal,
      },
      signal: controller.signal,
      sessionId: "session-lease-test",
      workspaceId: "workspace-lease-test",
      workspaceRoot: "/workspace",
    })

    try {
      await backend.startRunSandboxTimeoutLease()

      expect(timeoutCalls).toHaveLength(1)
      expect(timeoutCalls[0]?.timeoutMs).toBe(60 * 60 * 1_000)
      expect(timeoutCalls[0]?.options?.requestTimeoutMs).toBe(30_000)
      expect(timeoutCalls[0]?.options?.signal).toBe(controller.signal)
    } finally {
      backend.dispose()
    }
  })
})
