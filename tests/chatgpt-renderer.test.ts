// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { getMarkdownTargetFilePath } from "@/components/studio-chat/markdown-targets"
import {
  getSynaraStreamTargetVelocity,
  isSynaraAppendOnlyStreamUpdate,
  selectSynaraMarkdownText,
  smoothSynaraStreamVelocity,
} from "@/hooks/use-smooth-streamed-text"
import {
  encodeFilePathChipHref,
  parseFilePathChipHref,
  parseFilePathHrefTarget,
  parseFilePathText,
  resolveMarkdownRelativeFileHref,
} from "@/lib/markdown-file-paths"
import {
  dedentMarkdownCode,
  parseMarkdownCodeFenceInfo,
} from "@/lib/markdown-code-fence"
import {
  protectLiteralMarkdownDollars,
  restoreLiteralDollarPlaceholders,
} from "@/lib/markdown-math"

describe("Synara-style Markdown code fences", () => {
  test("parses ranged file references and derives their language", () => {
    expect(
      parseMarkdownCodeFenceInfo("173:186:components/chat/Message.tsx")
    ).toEqual({
      language: "tsx",
      isFileReference: true,
      filePath: "components/chat/Message.tsx",
      fileName: "Message.tsx",
      directory: "components/chat",
      lineRange: "173-186",
    })
  })

  test("keeps bare languages and dedents referenced snippets", () => {
    expect(parseMarkdownCodeFenceInfo("typescript")).toMatchObject({
      language: "typescript",
      isFileReference: false,
    })
    expect(dedentMarkdownCode("    const value = 1\n      return value")).toBe(
      "const value = 1\n  return value"
    )
  })
})

describe("Synara-style Markdown math parsing", () => {
  test("keeps math delimiters while protecting currency and shell variables", () => {
    const source = "Price is $50, env is $HOME, and math is $x+1$."
    const protectedValue = protectLiteralMarkdownDollars(source)

    expect(protectedValue).toContain("$x+1$")
    expect(protectedValue).not.toContain("$50")
    expect(protectedValue).not.toContain("$HOME")
    expect(restoreLiteralDollarPlaceholders(protectedValue)).toBe(source)
  })

  test("does not rewrite dollars inside inline or fenced code", () => {
    const source = "`echo $HOME`\n```sh\necho $PATH\n```"
    expect(protectLiteralMarkdownDollars(source)).toBe(source)
  })
})

describe("Synara-style smooth streaming Markdown", () => {
  test("animates append-only provider snapshots and snaps replacements", () => {
    expect(isSynaraAppendOnlyStreamUpdate("Hello", "Hello world")).toBe(true)
    expect(isSynaraAppendOnlyStreamUpdate("Hello", "Replacement")).toBe(false)
    expect(isSynaraAppendOnlyStreamUpdate("Hello", "Hell")).toBe(false)
  })

  test("adapts reveal velocity to backlog with Synara's hard ceiling", () => {
    expect(getSynaraStreamTargetVelocity(16)).toBe(100)
    expect(getSynaraStreamTargetVelocity(10_000)).toBe(2_000)
    expect(smoothSynaraStreamVelocity(0, 10_000)).toBe(300)
  })

  test("defers only active streams and shows exact completed Markdown", () => {
    expect(
      selectSynaraMarkdownText({
        normalizedText: "complete",
        deferredText: "comple",
        streaming: true,
      })
    ).toBe("comple")
    expect(
      selectSynaraMarkdownText({
        normalizedText: "complete",
        deferredText: "comple",
        streaming: false,
      })
    ).toBe("complete")
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

  test("keeps spaces inside absolute path segments", () => {
    expect(
      parseFilePathText(
        "/Users/zzf/Library/Application Support/AstraFlow/workspaces/ws/portfolio.html"
      )
    ).toEqual({
      path: "/Users/zzf/Library/Application Support/AstraFlow/workspaces/ws/portfolio.html",
      line: null,
      column: null,
      endLine: null,
    })
    expect(
      parseFilePathHrefTarget(
        "/Users/zzf/Library/Application Support/ws/report.md#L2"
      )
    ).toEqual({
      path: "/Users/zzf/Library/Application Support/ws/report.md",
      line: 2,
      column: null,
      endLine: null,
    })
    expect(parseFilePathText("~/My Documents/notes/todo.md")).toMatchObject({
      path: "~/My Documents/notes/todo.md",
    })
  })

  test("still treats relative paths with spaces as ambiguous", () => {
    expect(
      parseFilePathText("Library/Application Support/ws/report.md")
    ).toBeNull()
  })
})
