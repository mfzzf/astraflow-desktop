// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  clearAutoPreviewSuppressionsForIdentity,
  collectAutoPreviewSuppressionKeys,
  createWorkspaceFileTab,
  findWorkspaceFileTabForArtifact,
  findReusableWorkspaceFilePreviewTab,
  getAutoPreviewSuppressionKey,
  getWorkspaceArtifactPathKey,
  getWorkspaceBrowserRevisionKey,
  isAuthoritativeWorkspaceFileRevision,
} from "@/components/studio-chat/workspace-tabs"
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

  test("carries file revisions so an existing preview can refresh in place", () => {
    const tab = createWorkspaceFileTab(
      workspace,
      previewTab.kind === "files" ? previewTab.entry : null,
      "Files",
      null,
      null,
      null,
      "revision-2",
      true,
      "run-2"
    )

    expect(tab.revision).toBe("revision-2")
    expect(tab.autoPreview).toBe(true)
    expect(tab.originatingRunId).toBe("run-2")
  })

  test("matches relative and absolute service entry paths to one file tab", () => {
    expect(getWorkspaceArtifactPathKey(workspace, "demo.html")).toBe(
      getWorkspaceArtifactPathKey(workspace, "/workspace/demo.html")
    )
    expect(
      findWorkspaceFileTabForArtifact(
        [pinnedTab, previewTab],
        workspace,
        "deck.pptx"
      )
    ).toBe(previewTab)
    expect(
      findWorkspaceFileTabForArtifact(
        [previewTab],
        { ...workspace, id: "sandbox-2" },
        "deck.pptx"
      )
    ).toBeNull()
    expect(
      findWorkspaceFileTabForArtifact(
        [previewTab],
        workspace,
        "/other/deck.pptx"
      )
    ).toBeNull()
    expect(
      getWorkspaceArtifactPathKey(
        workspace,
        "https://example.test/deck.pptx"
      )
    ).toBeNull()
    expect(getWorkspaceArtifactPathKey(workspace, "~/deck.pptx")).toBeNull()
  })

  test("changes the embedded browser identity when its revision changes", () => {
    expect(
      getWorkspaceBrowserRevisionKey({
        id: "preview-browser",
        revision: "revision-1",
      })
    ).not.toBe(
      getWorkspaceBrowserRevisionKey({
        id: "preview-browser",
        revision: "revision-2",
      })
    )
  })

  test("collects close suppression for file and service auto previews", () => {
    const autoFile: StudioWorkspaceTab = {
      ...(previewTab as Extract<StudioWorkspaceTab, { kind: "files" }>),
      autoPreview: true,
      originatingRunId: "run-1",
    }
    const serviceTab: StudioWorkspaceTab = {
      id: "service-preview",
      kind: "browser",
      title: "Preview",
      address: "https://preview.example.test",
      url: "https://preview.example.test",
      workspace,
      entryPath: "deck.pptx",
      serviceId: "service-1",
      artifactKey: "deck",
      autoPreview: true,
      originatingRunId: "run-1",
    }
    const manualServiceTab: StudioWorkspaceTab = {
      ...serviceTab,
      id: "manual-service",
      serviceId: "manual-service",
      autoPreview: false,
    }
    const suppression = collectAutoPreviewSuppressionKeys([
      autoFile,
      serviceTab,
      manualServiceTab,
    ])

    expect(
      suppression.paths.has(
        getAutoPreviewSuppressionKey("run-1", "/workspace/deck.pptx") ?? ""
      )
    ).toBe(true)
    expect(
      suppression.paths.has(
        getAutoPreviewSuppressionKey(
          "run-1",
          getWorkspaceArtifactPathKey(workspace, "deck.pptx")
        ) ?? ""
      )
    ).toBe(true)
    expect([...suppression.services].sort()).toEqual(
      [
        getAutoPreviewSuppressionKey("run-1", "deck"),
        getAutoPreviewSuppressionKey("run-1", "service-1"),
      ].sort()
    )
  })

  test("scopes close suppression to the originating run and explicit opens restore it", () => {
    const suppressions = new Set([
      getAutoPreviewSuppressionKey("run-1", "demo.html")!,
    ])

    expect(
      suppressions.has(
        getAutoPreviewSuppressionKey("run-1", "demo.html")!
      )
    ).toBe(true)
    expect(
      suppressions.has(
        getAutoPreviewSuppressionKey("run-2", "demo.html")!
      )
    ).toBe(false)

    clearAutoPreviewSuppressionsForIdentity(suppressions, "demo.html")
    expect(suppressions.size).toBe(0)
  })

  test("recognizes only full SHA-256 file revisions as authoritative", () => {
    expect(isAuthoritativeWorkspaceFileRevision("a".repeat(64))).toBe(true)
    expect(isAuthoritativeWorkspaceFileRevision("revision-1")).toBe(false)
    expect(isAuthoritativeWorkspaceFileRevision(null)).toBe(false)
  })
})
