// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { findReusableWorkspaceFilePreviewTab } from "@/components/studio-chat/workspace-tabs"
import type { StudioWorkspaceTab } from "@/components/studio-chat/types"

describe("studio workspace preview tabs", () => {
  const pinnedTab: StudioWorkspaceTab = {
    id: "pinned-file",
    kind: "files",
    title: "Pinned",
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
})
