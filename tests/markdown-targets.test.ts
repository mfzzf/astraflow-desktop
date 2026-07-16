// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  isPathInsideWorkspaceRoot,
  isSessionWorkspaceFileHref,
  resolveRelativeSessionWorkspaceFilePath,
  resolveRelativeWorkspaceFilePath,
  resolveStudioMarkdownOpenTarget,
} from "@/components/studio-chat/markdown-targets"

describe("local session markdown file targets", () => {
  const sessionId = "c8e2223a-22f4-489d-9b03-f7e5bf6a3727"
  const macWorkspace =
    "/Users/zzf/Library/Application Support/Electron/sandbox-workspaces/c8e2223a-22f4-489d-9b03-f7e5bf6a3727"

  test("resolves a bare generated filename inside the session workspace", () => {
    expect(
      resolveRelativeSessionWorkspaceFilePath(
        "presentation.pptx",
        sessionId,
        macWorkspace
      )
    ).toBe(`${macWorkspace}/presentation.pptx`)
  })

  test("removes the matching sandbox-workspaces/session prefix", () => {
    const href = `sandbox-workspaces/${sessionId}/presentation.pptx`

    expect(isSessionWorkspaceFileHref(href, sessionId)).toBe(true)
    expect(
      resolveRelativeSessionWorkspaceFilePath(href, sessionId, macWorkspace)
    ).toBe(`${macWorkspace}/presentation.pptx`)
  })

  test("rejects traversal and another session's workspace", () => {
    expect(
      resolveRelativeSessionWorkspaceFilePath(
        "../presentation.pptx",
        sessionId,
        macWorkspace
      )
    ).toBeNull()
    expect(
      resolveRelativeSessionWorkspaceFilePath(
        "sandbox-workspaces/another-session/presentation.pptx",
        sessionId,
        macWorkspace
      )
    ).toBeNull()
  })

  test("preserves Windows path separators from the resolved workspace", () => {
    const windowsWorkspace = `C:\\Users\\zzf\\AppData\\Roaming\\AstraFlow\\sandbox-workspaces\\${sessionId}`

    expect(
      resolveRelativeSessionWorkspaceFilePath(
        "slides/presentation.pptx",
        sessionId,
        windowsWorkspace
      )
    ).toBe(`${windowsWorkspace}\\slides\\presentation.pptx`)
  })

  test("resolves unicode and spaced paths against an explicit workspace", () => {
    expect(
      resolveRelativeWorkspaceFilePath(
        "reports/季度 Plan.md",
        "/workspace/project-a"
      )
    ).toBe("/workspace/project-a/reports/季度 Plan.md")
  })

  test("keeps generic workspace targets inside the selected root", () => {
    expect(
      resolveRelativeWorkspaceFilePath(
        "../project-b/secret.txt",
        "/workspace/project-a"
      )
    ).toBeNull()
    expect(
      resolveRelativeWorkspaceFilePath(
        "https://example.com/file.txt",
        "/workspace/project-a"
      )
    ).toBeNull()
  })

  test("routes local Markdown paths to preview or the system file handler", () => {
    const workspace = {
      type: "local" as const,
      rootPath: "/Users/zzf/Documents/project",
    }

    expect(
      resolveStudioMarkdownOpenTarget({
        href: "reports/季度%20Plan.md#L12-L18",
        sessionId,
        workspace,
      })
    ).toEqual({
      kind: "workspace_file",
      path: "/Users/zzf/Documents/project/reports/季度 Plan.md",
      line: 12,
      column: null,
      endLine: 18,
    })
    expect(
      resolveStudioMarkdownOpenTarget({
        href: "file:///Users/zzf/Desktop/外部报告.md",
        sessionId,
        workspace,
      })
    ).toEqual({
      kind: "external_file",
      path: "/Users/zzf/Desktop/外部报告.md",
    })
  })

  test("routes every supported sandbox Markdown path into the same preview", () => {
    const workspace = {
      type: "sandbox" as const,
      rootPath: "/workspace",
    }

    for (const href of [
      "outputs/report.md",
      "/workspace/outputs/report.md",
      "sandbox:/workspace/outputs/report.md",
    ]) {
      expect(
        resolveStudioMarkdownOpenTarget({
          href,
          sessionId,
          workspace,
        })
      ).toEqual({
        kind: "workspace_file",
        path: "/workspace/outputs/report.md",
        line: null,
        column: null,
        endLine: null,
      })
    }

    expect(
      resolveStudioMarkdownOpenTarget({
        href: "/tmp/outside.md",
        sessionId,
        workspace,
      })
    ).toEqual({ kind: "unavailable" })
  })

  test("routes web pages to the in-app browser without current-page navigation", () => {
    const workspace = {
      type: "sandbox" as const,
      rootPath: "/workspace",
    }

    expect(
      resolveStudioMarkdownOpenTarget({
        href: "https://example.com/docs",
        sessionId,
        workspace,
      })
    ).toEqual({
      kind: "browser",
      url: "https://example.com/docs",
    })
    expect(
      resolveStudioMarkdownOpenTarget({
        href: "/api/studio/files/file-1/content",
        sessionId,
        workspace,
        browserBaseUrl: "http://127.0.0.1:3000/chat",
      })
    ).toEqual({
      kind: "browser",
      url: "http://127.0.0.1:3000/api/studio/files/file-1/content",
    })
  })

  test("compares macOS and Windows workspace roots without prefix escapes", () => {
    expect(
      isPathInsideWorkspaceRoot("/workspace", "/workspace/report.md")
    ).toBe(true)
    expect(
      isPathInsideWorkspaceRoot("/workspace", "/workspace-other/report.md")
    ).toBe(false)
    expect(
      isPathInsideWorkspaceRoot(
        "C:\\Users\\ZZF\\Project",
        "c:\\users\\zzf\\project\\README.md"
      )
    ).toBe(true)
  })
})
