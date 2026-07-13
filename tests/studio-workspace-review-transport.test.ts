// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { getStudioWorkspaceReviewEndpoint } from "@/lib/studio-review-data"
import type { StudioWorkspace } from "@/lib/studio-types"
import { isStudioWorkspaceGitReviewUnsupported } from "@/lib/studio-workspace-git-review"

const timestamps = {
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
  lastOpenedAt: null,
}

describe("studio workspace review transport", () => {
  test("routes a local workspace only through its registered local project", () => {
    const workspace: StudioWorkspace = {
      ...timestamps,
      id: "workspace-local",
      type: "local",
      name: "Local",
      rootPath: "/Users/me/project",
      localProjectId: "project/local id",
    }

    expect(getStudioWorkspaceReviewEndpoint(workspace)).toBe(
      "/api/studio/local-projects/git?id=project%2Flocal+id&workspaceId=workspace-local"
    )
  })

  test("routes a sandbox workspace only through its workspace-scoped Gateway", () => {
    const workspace: StudioWorkspace = {
      ...timestamps,
      id: "workspace/sandbox id",
      type: "sandbox",
      name: "Sandbox",
      rootPath: "/workspace/project-a",
      sandboxId: "sandbox-1",
    }

    expect(getStudioWorkspaceReviewEndpoint(workspace)).toBe(
      "/api/studio/workspaces/workspace%2Fsandbox%20id/git/review"
    )
  })

  test("treats an old Gateway without Git review as a supported empty state", () => {
    expect(
      isStudioWorkspaceGitReviewUnsupported(404, {
        error: { code: "NOT_FOUND" },
      })
    ).toBe(true)
    expect(
      isStudioWorkspaceGitReviewUnsupported(400, {
        error: { code: "CAPABILITY_NOT_SUPPORTED" },
      })
    ).toBe(true)
    expect(
      isStudioWorkspaceGitReviewUnsupported(500, {
        error: { code: "INTERNAL_ERROR" },
      })
    ).toBe(false)
  })
})
