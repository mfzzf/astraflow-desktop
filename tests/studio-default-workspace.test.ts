// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  createStudioAgentWorkspace,
  createStudioDefaultHomeWorkspace,
} from "@/lib/studio-default-workspace"

describe("default Studio home workspace", () => {
  test("creates a stable local workspace rooted at the desktop home path", () => {
    expect(createStudioDefaultHomeWorkspace(" /Users/example ")).toEqual({
      id: "astraflow:default-home",
      type: "local",
      name: "~",
      rootPath: "/Users/example",
      localProjectId: "",
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      lastOpenedAt: null,
    })
  })

  test("does not create a workspace without a resolved home path", () => {
    expect(createStudioDefaultHomeWorkspace("   ")).toBeNull()
  })
})

describe("per-session agent workspace", () => {
  test("creates a local workspace rooted at the agent workspace path", () => {
    expect(
      createStudioAgentWorkspace(
        "session-1",
        " /Users/example/Library/Application Support/AstraFlow/acp-workspaces/session-1 "
      )
    ).toEqual({
      id: "astraflow:agent-workspace:session-1",
      type: "local",
      name: "Agent workspace",
      rootPath:
        "/Users/example/Library/Application Support/AstraFlow/acp-workspaces/session-1",
      localProjectId: "",
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      lastOpenedAt: null,
    })
  })

  test("does not create a workspace without a session or root path", () => {
    expect(createStudioAgentWorkspace("", "/tmp/agent")).toBeNull()
    expect(createStudioAgentWorkspace("session-1", null)).toBeNull()
    expect(createStudioAgentWorkspace("session-1", "  ")).toBeNull()
  })
})
