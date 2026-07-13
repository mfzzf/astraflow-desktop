// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  extractMarkdownArtifactHrefs,
  isPathInsideLocalRoot,
  markdownHrefTargetsSessionWorkspace,
  resolveMarkdownArtifactPath,
} from "@/lib/studio-markdown-artifacts"

describe("studio markdown artifacts", () => {
  const sessionId = "2edc2bb3-02bc-4750-9732-b4864dea0dd2"
  const projectRoot = "/Users/zzf/Documents/UCloud 项目"
  const sandboxRoot =
    "/Users/zzf/Library/Application Support/Electron/sandbox-workspaces/2edc2bb3-02bc-4750-9732-b4864dea0dd2"

  test("extracts linked output artifacts without treating source links as outputs", () => {
    const markdown = [
      "PPT 已生成：**[UCloud介绍.pptx](UCloud介绍.pptx)**",
      "[数据](reports/季度数据.xlsx)",
      "[说明](README.md)",
      "[脚本](create_ucloud_ppt.js)",
      "![预览](preview.png)",
      "[官网](https://example.com/report.pdf)",
      "[重复](UCloud介绍.pptx)",
    ].join("\n\n")

    expect(extractMarkdownArtifactHrefs(markdown)).toEqual([
      "UCloud介绍.pptx",
      "reports/季度数据.xlsx",
    ])
  })

  test("resolves unicode and spaced artifact names inside a local project", () => {
    expect(
      resolveMarkdownArtifactPath({
        href: "UCloud介绍.pptx",
        sessionId,
        projectRoot,
        sandboxRoot: null,
      })
    ).toBe(`${projectRoot}/UCloud介绍.pptx`)

    expect(
      resolveMarkdownArtifactPath({
        href: "reports/Quarterly%20Plan.pdf",
        sessionId,
        projectRoot,
        sandboxRoot: null,
      })
    ).toBe(`${projectRoot}/reports/Quarterly Plan.pdf`)
  })

  test("resolves only the current session's sandbox artifact prefix", () => {
    const href = `sandbox-workspaces/${sessionId}/UCloud介绍.pptx`

    expect(markdownHrefTargetsSessionWorkspace(href, sessionId)).toBe(true)
    expect(
      resolveMarkdownArtifactPath({
        href,
        sessionId,
        projectRoot,
        sandboxRoot,
      })
    ).toBe(`${sandboxRoot}/UCloud介绍.pptx`)

    expect(
      resolveMarkdownArtifactPath({
        href: "sandbox-workspaces/another-session/UCloud介绍.pptx",
        sessionId,
        projectRoot,
        sandboxRoot,
      })
    ).toBeNull()
  })

  test("rejects traversal and absolute files outside the active roots", () => {
    expect(
      resolveMarkdownArtifactPath({
        href: "../private/report.pdf",
        sessionId,
        projectRoot,
        sandboxRoot,
      })
    ).toBeNull()
    expect(
      resolveMarkdownArtifactPath({
        href: "/Users/zzf/Desktop/report.pdf",
        sessionId,
        projectRoot,
        sandboxRoot,
      })
    ).toBeNull()
    expect(
      resolveMarkdownArtifactPath({
        href: `${projectRoot}/report.pdf`,
        sessionId,
        projectRoot,
        sandboxRoot,
      })
    ).toBe(`${projectRoot}/report.pdf`)
    expect(
      isPathInsideLocalRoot(
        `${projectRoot}/presentations/deck.pptx`,
        projectRoot
      )
    ).toBe(true)
  })

  test("preserves Windows workspace separators", () => {
    expect(
      resolveMarkdownArtifactPath({
        href: "slides/UCloud介绍.pptx",
        sessionId,
        projectRoot: "C:\\Users\\zzf\\UCloud 项目",
        sandboxRoot: null,
      })
    ).toBe("C:\\Users\\zzf\\UCloud 项目\\slides\\UCloud介绍.pptx")
  })
})
