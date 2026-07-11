// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { repairStreamingMarkdown } from "@/components/prompt-kit/markdown"
import { getMarkdownTargetFilePath } from "@/components/studio-chat/markdown-targets"
import {
  encodeFilePathChipHref,
  parseFilePathChipHref,
  parseFilePathHrefTarget,
  parseFilePathText,
  resolveMarkdownRelativeFileHref,
} from "@/lib/markdown-file-paths"

describe("ChatGPT-style streaming Markdown repair", () => {
  test("temporarily closes an unfinished fenced block", () => {
    expect(repairStreamingMarkdown("```ts\nconst value = 1")).toEqual({
      isCodeFenceOpen: true,
      markdown: "```ts\nconst value = 1\n```",
    })
  })

  test("repairs incomplete links and emphasis without mutating complete input", () => {
    expect(
      repairStreamingMarkdown("Read [the docs](https://example.com")
    ).toEqual({
      isCodeFenceOpen: false,
      markdown: "Read [the docs](https://example.com)",
    })
    expect(repairStreamingMarkdown("This is **important").markdown).toBe(
      "This is **important**"
    )
    expect(repairStreamingMarkdown("Already **complete**").markdown).toBe(
      "Already **complete**"
    )
  })

  test("removes the private incomplete-stream marker", () => {
    expect(repairStreamingMarkdown("Ready\uE200partial").markdown).toBe("Ready")
  })
})

describe("ChatGPT-style file references", () => {
  test("parses line and column references from text and links", () => {
    expect(parseFilePathText("components/view.tsx:12:4-18")).toEqual({
      path: "components/view.tsx",
      line: 12,
      column: 4,
      endLine: 18,
    })
    expect(parseFilePathHrefTarget("components/view.tsx#L12C4-L18")).toEqual({
      path: "components/view.tsx",
      line: 12,
      column: 4,
      endLine: 18,
    })
    expect(parseFilePathText("@components/view.tsx:7")).toEqual({
      path: "components/view.tsx",
      line: 7,
      column: null,
      endLine: null,
    })
  })

  test("round-trips file chips for every preview kind", () => {
    const target = {
      path: "reports/quarterly.xlsx",
      line: 7,
      column: 2,
      endLine: 11,
    }

    expect(parseFilePathChipHref(encodeFilePathChipHref(target))).toEqual(
      target
    )
  })

  test("does not turn ordinary extensionless identifiers into files", () => {
    expect(parseFilePathHrefTarget("hello")).toBeNull()
    expect(parseFilePathHrefTarget("docs")).toBeNull()
    expect(parseFilePathHrefTarget("/settings")).toBeNull()
    expect(parseFilePathHrefTarget("docs/getting-started")).toBeNull()
    expect(parseFilePathHrefTarget("Dockerfile")).toMatchObject({
      path: "Dockerfile",
    })
  })

  test("parses native Windows paths and file URLs", () => {
    expect(parseFilePathHrefTarget("C:\\Work\\view.tsx:12:4-18")).toEqual({
      path: "C:\\Work\\view.tsx",
      line: 12,
      column: 4,
      endLine: 18,
    })
    expect(parseFilePathHrefTarget("C:/Work/view.tsx#L7-L9")).toEqual({
      path: "C:/Work/view.tsx",
      line: 7,
      column: null,
      endLine: 9,
    })
    expect(parseFilePathHrefTarget("file:///C:/Work/view.tsx#L3")).toEqual({
      path: "C:/Work/view.tsx",
      line: 3,
      column: null,
      endLine: null,
    })
    expect(getMarkdownTargetFilePath("C:\\Work\\view.tsx:12")).toBe(
      "C:\\Work\\view.tsx"
    )
    expect(getMarkdownTargetFilePath("file:///C:/Work/view.tsx#L3")).toBe(
      "C:/Work/view.tsx"
    )
  })

  test("resolves nested Markdown links against their source directory", () => {
    expect(
      resolveMarkdownRelativeFileHref(
        "../assets/diagram.png#L2",
        "/workspace/docs/guides"
      )
    ).toBe("/workspace/docs/assets/diagram.png#L2")
    expect(
      resolveMarkdownRelativeFileHref("./guide.md", "C:\\repo\\docs")
    ).toBe("C:/repo/docs/guide.md")
    expect(
      resolveMarkdownRelativeFileHref(
        "https://example.com/image.png",
        "/workspace/docs"
      )
    ).toBe("https://example.com/image.png")
  })
})
