// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { findReusableWorkspaceFilePreviewTab } from "@/components/studio-chat/workspace-tabs"
import type { StudioWorkspaceTab } from "@/components/studio-chat/types"
import { isStudioFileWorkspaceTargetForEnvironment } from "@/lib/studio-file-workspace"

describe("studio workspace preview tabs", () => {
  const workspace = {
    id: "sandbox-1",
    type: "sandbox" as const,
    rootPath: "/workspace",
  }
  const pinnedTab: StudioWorkspaceTab = {
    id: "pinned-file",
    kind: "files",
    title: "Pinned",
    workspace,
    entry: {
      name: "pinned.pdf",
      path: "/workspace/pinned.pdf",
      kind: "file",
      extension: "pdf",
      size: 0,
      modifiedAt: 0,
    },
    focusLine: null,
    focusColumn: null,
    focusEndLine: null,
  }
  const previewTab: StudioWorkspaceTab = {
    id: "preview-file",
    kind: "files",
    title: "Preview",
    workspace,
    entry: {
      name: "deck.pptx",
      path: "/workspace/deck.pptx",
      kind: "file",
      extension: "pptx",
      size: 0,
      modifiedAt: 0,
    },
    focusLine: null,
    focusColumn: null,
    focusEndLine: null,
  }

  test("reuses the active preview identity instead of replacing the tab", () => {
    expect(
      findReusableWorkspaceFilePreviewTab(
        [pinnedTab, previewTab],
        new Set(["preview-file"])
      )
    ).toBe(previewTab)
  })

  test("never overwrites a pinned file tab", () => {
    expect(
      findReusableWorkspaceFilePreviewTab([pinnedTab, previewTab], new Set())
    ).toBeNull()
  })

  test("does not attach a sandbox workspace to local file output", () => {
    expect(isStudioFileWorkspaceTargetForEnvironment(workspace, "remote")).toBe(
      true
    )
    expect(isStudioFileWorkspaceTargetForEnvironment(workspace, "local")).toBe(
      false
    )
  })
})
