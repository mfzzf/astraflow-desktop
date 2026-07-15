// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  createStreamingMarkdownBlockCache,
  repairStreamingMarkdown,
} from "@/components/prompt-kit/markdown"
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

describe("streaming Markdown block cache", () => {
  test("reuses completed blocks while only extending the mutable tail", () => {
    const cache = createStreamingMarkdownBlockCache({ stableBatchChars: 8 })
    const firstSource = "First paragraph.\n\nSecond paragraph"
    const first = cache.read(firstSource, firstSource)
    const secondSource = `${firstSource} continues.\n\nThird paragraph`
    const second = cache.read(secondSource, secondSource)

    expect(first.length).toBeGreaterThanOrEqual(2)
    expect(second.length).toBeGreaterThan(first.length)
    expect(second.find((block) => block.content === "First paragraph.")).toBe(
      first.find((block) => block.content === "First paragraph.")
    )
    expect(second.map((block) => block.content).join("")).toBe(secondSource)
  })

  test("falls back safely when streamed content is replaced", () => {
    const cache = createStreamingMarkdownBlockCache()

    cache.read("Old paragraph.\n\nOld tail", "Old paragraph.\n\nOld tail")
    const replacement = "Replacement paragraph.\n\nReplacement tail"
    const blocks = cache.read(replacement, replacement)

    expect(blocks.map((block) => block.content).join("")).toBe(replacement)
  })

  test("finalizes a complete streamed document without rebuilding its blocks", () => {
    const cache = createStreamingMarkdownBlockCache({ stableBatchChars: 8 })
    const source = "First paragraph.\n\nSecond paragraph."
    const streamingBlocks = cache.read(source, source)
    const completedBlocks = cache.complete(source)

    expect(completedBlocks.map((block) => block.content).join("")).toBe(source)
    expect(completedBlocks[0]).toBe(streamingBlocks[0])
    expect(completedBlocks.at(-1)?.key).toBe(streamingBlocks.at(-1)?.key)
    expect(completedBlocks.every((block) => !block.mutable)).toBe(true)
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

  test("parses generated sandbox links as local file targets", () => {
    expect(
      parseFilePathHrefTarget(
        "sandbox:/Users/user/%E4%B8%A4%E5%BC%A0%E6%88%AA%E5%9B%BE.png"
      )
    ).toEqual({
      path: "/Users/user/两张截图.png",
      line: null,
      column: null,
      endLine: null,
    })
    expect(getMarkdownTargetFilePath("sandbox:/Users/user/report.pdf")).toBe(
      "/Users/user/report.pdf"
    )
    expect(
      getMarkdownTargetFilePath("sandbox:/Users/user/两张截图_左右拼接.png")
    ).toBe("/Users/user/两张截图_左右拼接.png")
    expect(
      parseFilePathHrefTarget("sandbox:/C:/Work/archive.zip")
    ).toMatchObject({ path: "C:/Work/archive.zip" })
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
