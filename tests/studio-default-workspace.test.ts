// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"

import {
  getAcpWorkspacePath,
  getLegacyAcpWorkspacePath,
} from "@/lib/agent/acp/workspace"
import { createStudioAgentWorkspace } from "@/lib/studio-default-workspace"

const originalManagedRoot = process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH
const originalAcpRoot = process.env.ASTRAFLOW_ACP_WORKSPACES_PATH
const originalStudioFilesRoot = process.env.ASTRAFLOW_STUDIO_FILES_PATH

afterEach(() => {
  if (originalManagedRoot === undefined) {
    delete process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH
  } else {
    process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH = originalManagedRoot
  }

  if (originalAcpRoot === undefined) {
    delete process.env.ASTRAFLOW_ACP_WORKSPACES_PATH
  } else {
    process.env.ASTRAFLOW_ACP_WORKSPACES_PATH = originalAcpRoot
  }

  if (originalStudioFilesRoot === undefined) {
    delete process.env.ASTRAFLOW_STUDIO_FILES_PATH
  } else {
    process.env.ASTRAFLOW_STUDIO_FILES_PATH = originalStudioFilesRoot
  }
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
      origin: "legacy_local",
      name: "Agent workspace",
      rootPath:
        "/Users/example/Library/Application Support/AstraFlow/acp-workspaces/session-1",
      localProjectId: null,
      allocationKey: "legacy-agent-workspace:session-1",
      createdBySessionId: "session-1",
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

describe("ACP support workspace", () => {
  test("keeps runtime support files under private app data", () => {
    process.env.ASTRAFLOW_MANAGED_WORKSPACES_PATH = "/Users/example/AstraFlow"
    process.env.ASTRAFLOW_ACP_WORKSPACES_PATH =
      "/Users/example/Library/Application Support/AstraFlow/acp-workspaces"
    process.env.ASTRAFLOW_STUDIO_FILES_PATH =
      "/Users/example/Library/Application Support/AstraFlow/studio-files"

    expect(getAcpWorkspacePath("session-1")).toBe(
      "/Users/example/Library/Application Support/AstraFlow/acp-workspaces/session-1"
    )
    expect(getLegacyAcpWorkspacePath("session-1")).toBe(
      "/Users/example/Library/Application Support/AstraFlow/acp-workspaces/session-1"
    )
  })
})
