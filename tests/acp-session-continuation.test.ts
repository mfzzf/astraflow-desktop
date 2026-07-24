// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  assertAcpSessionCanContinue,
  continueAcpSessionInStudio,
} from "@/lib/agent/acp/session-continuation"
import type { StudioSession } from "@/lib/studio-types"

function studioSession(overrides: Partial<StudioSession> = {}): StudioSession {
  return {
    id: "studio-source",
    mode: "chat",
    title: "Source",
    workspaceId: null,
    projectId: null,
    permissionMode: "default",
    storedPermissionMode: "default",
    permissionSchemaVersion: 2,
    requiresPermissionMigration: false,
    localFullAccessGranted: false,
    chatModel: "model",
    chatRuntimeId: "astraflow",
    chatReasoningEffort: "medium",
    latestRunUsage: null,
    pinnedAt: null,
    archivedAt: null,
    isRunning: false,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  }
}

describe("ACP session continuation", () => {
  test("requires the agent session to belong to the active workspace", () => {
    expect(() =>
      assertAcpSessionCanContinue({
        activeWorkspace: "/workspace/current/",
        agentSession: {
          sessionId: "agent-session",
          cwd: "/workspace/current",
        },
      })
    ).not.toThrow()

    expect(() =>
      assertAcpSessionCanContinue({
        activeWorkspace: "/workspace/current",
        agentSession: {
          sessionId: "agent-session",
          cwd: "/workspace/other",
        },
      })
    ).toThrow("original Studio workspace")
  })

  test("creates a separate local chat and records the provider binding", () => {
    const source = studioSession()
    const created = studioSession({ id: "studio-continuation" })
    const recorded: string[] = []
    const result = continueAcpSessionInStudio({
      activeWorkspace: "/workspace/current",
      agentSession: {
        sessionId: "agent-session",
        cwd: "/workspace/current",
        title: "Remote work",
      },
      runtimeId: "astraflow",
      sourceSession: source,
      findExistingSession: () => null,
      createSession: (input) => {
        expect(input).toMatchObject({
          mode: "chat",
          title: "Remote work",
          chatRuntimeId: "astraflow",
        })
        return created
      },
      deleteCreatedSession: () => undefined,
      recordSelection: (session) => recorded.push(session.id),
    })

    expect(result).toEqual({ session: created, reused: false })
    expect(recorded).toEqual(["studio-continuation"])
  })

  test("reuses a matching Studio chat and rolls back failed bindings", () => {
    const source = studioSession()
    const existing = studioSession({ id: "studio-existing" })
    const deleted: string[] = []

    expect(
      continueAcpSessionInStudio({
        activeWorkspace: "/workspace/current",
        agentSession: {
          sessionId: "agent-session",
          cwd: "/workspace/current",
        },
        runtimeId: "astraflow",
        sourceSession: source,
        findExistingSession: () => existing,
        createSession: () => {
          throw new Error("should not create")
        },
        deleteCreatedSession: () => undefined,
        recordSelection: () => undefined,
      })
    ).toEqual({ session: existing, reused: true })

    expect(() =>
      continueAcpSessionInStudio({
        activeWorkspace: "/workspace/current",
        agentSession: {
          sessionId: "agent-new",
          cwd: "/workspace/current",
        },
        runtimeId: "astraflow",
        sourceSession: source,
        findExistingSession: () => null,
        createSession: () => studioSession({ id: "studio-failed" }),
        deleteCreatedSession: (sessionId) => deleted.push(sessionId),
        recordSelection: () => {
          throw new Error("record failed")
        },
      })
    ).toThrow("record failed")
    expect(deleted).toEqual(["studio-failed"])
  })
})
