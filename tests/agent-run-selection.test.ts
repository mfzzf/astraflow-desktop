// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { isAgentRunSelectionCurrent } from "@/lib/agent/run-selection"

const currentSession = {
  workspaceId: "workspace-current",
  permissionMode: "full_access" as const,
  chatRuntimeId: "astraflow",
}

describe("Agent run selection", () => {
  test("accepts only the current workspace, runtime, and permission snapshot", () => {
    expect(
      isAgentRunSelectionCurrent({
        session: currentSession,
        workspaceId: "workspace-current",
        runtimeId: "astraflow",
        permissionMode: "full_access",
      })
    ).toBe(true)

    for (const stale of [
      {
        workspaceId: "workspace-stale",
        runtimeId: "astraflow",
        permissionMode: "full_access" as const,
      },
      {
        workspaceId: "workspace-current",
        runtimeId: "codex",
        permissionMode: "full_access" as const,
      },
      {
        workspaceId: "workspace-current",
        runtimeId: "astraflow",
        permissionMode: "default" as const,
      },
    ]) {
      expect(
        isAgentRunSelectionCurrent({
          session: currentSession,
          ...stale,
        })
      ).toBe(false)
    }
  })

  test("resolves an unset stored runtime to AstraFlow", () => {
    expect(
      isAgentRunSelectionCurrent({
        session: {
          workspaceId: null,
          permissionMode: "default",
          chatRuntimeId: null,
        },
        workspaceId: null,
        runtimeId: "astraflow",
        permissionMode: "default",
      })
    ).toBe(true)
  })
})
