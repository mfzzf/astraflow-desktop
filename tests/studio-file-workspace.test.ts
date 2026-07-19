// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  createStudioRunFileWorkspaceTarget,
  getStudioFileWorkspaceTargetCandidates,
} from "@/lib/studio-file-workspace"

describe("Studio run file workspace targets", () => {
  test("captures an explicit remote Sandbox workspace", () => {
    expect(
      createStudioRunFileWorkspaceTarget({
        environment: "remote",
        sessionId: "session-1",
        workspaceId: "workspace-1",
        workspaceRoot: "/workspace/project",
      })
    ).toEqual({
      id: "workspace-1",
      type: "sandbox",
      rootPath: "/workspace/project",
    })
  })

  test("captures the actual cwd for an unbound local agent session", () => {
    expect(
      createStudioRunFileWorkspaceTarget({
        agentWorkspaceRoot: "/tmp/agent-session",
        environment: "local",
        projectPath: "/fallback/project",
        sessionId: "session-2",
      })
    ).toEqual({
      id: "astraflow:agent-workspace:session-2",
      type: "local",
      rootPath: "/tmp/agent-session",
    })
  })

  test("does not invent a remote workspace identity", () => {
    expect(
      createStudioRunFileWorkspaceTarget({
        environment: "remote",
        sessionId: "session-3",
        workspaceRoot: "/workspace/project",
      })
    ).toBeNull()
  })

  test("retries a recreated workspace with the same execution root", () => {
    const source = {
      id: "deleted-workspace",
      type: "sandbox" as const,
      rootPath: "/workspace/project",
    }
    const active = {
      id: "recreated-workspace",
      type: "sandbox" as const,
      rootPath: "/workspace/project/",
    }

    expect(getStudioFileWorkspaceTargetCandidates(source, active)).toEqual([
      source,
      active,
    ])
  })

  test("does not search an unrelated active workspace", () => {
    const source = {
      id: "workspace-a",
      type: "sandbox" as const,
      rootPath: "/workspace/project-a",
    }
    const active = {
      id: "workspace-b",
      type: "sandbox" as const,
      rootPath: "/workspace/project-b",
    }

    expect(getStudioFileWorkspaceTargetCandidates(source, active)).toEqual([
      source,
    ])
  })
})
