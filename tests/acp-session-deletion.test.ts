// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { deletePersistedAcpSession } from "@/lib/agent/acp/session-deletion"

describe("ACP-backed Studio session deletion", () => {
  test("prepares a dormant connection and deletes the persisted agent session", async () => {
    let prepared = false
    const deleted: string[] = []

    const result = await deletePersistedAcpSession({
      storedAgentSessionId: "agent-session",
      getSnapshot: () =>
        prepared
          ? {
              sessionId: null,
              session: { canDelete: true },
            }
          : null,
      prepare: async () => {
        prepared = true
      },
      deleteSession: async (agentSessionId) => {
        deleted.push(agentSessionId)
      },
    })

    expect(result).toEqual({
      deleted: true,
      agentSessionId: "agent-session",
    })
    expect(deleted).toEqual(["agent-session"])
  })

  test("prefers the active ACP session id", async () => {
    const deleted: string[] = []

    const result = await deletePersistedAcpSession({
      storedAgentSessionId: "stored-session",
      getSnapshot: () => ({
        sessionId: "active-session",
        session: { canDelete: true },
      }),
      prepare: async () => undefined,
      deleteSession: async (agentSessionId) => {
        deleted.push(agentSessionId)
      },
    })

    expect(result).toEqual({
      deleted: true,
      agentSessionId: "active-session",
    })
    expect(deleted).toEqual(["active-session"])
  })

  test("does not call session/delete when the agent lacks the capability", async () => {
    let deleted = false

    const result = await deletePersistedAcpSession({
      storedAgentSessionId: "agent-session",
      getSnapshot: () => ({
        sessionId: null,
        session: { canDelete: false },
      }),
      prepare: async () => undefined,
      deleteSession: async () => {
        deleted = true
      },
    })

    expect(result).toEqual({ deleted: false, reason: "unsupported" })
    expect(deleted).toBe(false)
  })

  test("propagates remote deletion failures so local history can be retained", async () => {
    await expect(
      deletePersistedAcpSession({
        storedAgentSessionId: "agent-session",
        getSnapshot: () => ({
          sessionId: null,
          session: { canDelete: true },
        }),
        prepare: async () => undefined,
        deleteSession: async () => {
          throw new Error("remote delete failed")
        },
      })
    ).rejects.toThrow("remote delete failed")
  })
})
