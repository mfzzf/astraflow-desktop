// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { FILE_DELIVERY_RULE } from "@/lib/agent/agent-conduct-rules"
import {
  formatStudioFileDeliveryLinks,
  toStudioFilePreviewHref,
} from "@/lib/ai/tools/file-delivery"
import { parseFilePathHrefTarget } from "@/lib/markdown-file-paths"

describe("studio file delivery", () => {
  test("returns preview and download links for every supported preview family", () => {
    for (const fileName of [
      "main.ts",
      "notes.md",
      "image.png",
      "paper.pdf",
      "report.docx",
      "deck.pptx",
      "data.xlsx",
      "analysis.ipynb",
      "protein.pdb",
      "module.wasm",
      "server.log",
    ]) {
      const result = formatStudioFileDeliveryLinks({
        fileId: "file-1",
        fileName,
        filePath: `/workspace/outputs/${fileName}`,
      })

      expect(result).toContain("Preview:")
      expect(result).toContain("Download:")
      expect(result).toContain("include both the Preview and Download links")
    }
  })

  test("returns only download for unsupported file types", () => {
    const result = formatStudioFileDeliveryLinks({
      fileId: "file-2",
      fileName: "source.zip",
      filePath: "/workspace/outputs/source.zip",
    })

    expect(result).not.toContain("Preview:")
    expect(result).toContain(
      "Download: [source.zip](/api/studio/files/file-2/content?download=1)"
    )
  })

  test("encodes local and sandbox preview paths", () => {
    const sandboxHref = toStudioFilePreviewHref(
      "/workspace/输出/测试 演示.pptx"
    )
    const windowsHref = toStudioFilePreviewHref("C:\\Work\\测试演示.pptx")

    expect(sandboxHref).toBe(
      "sandbox:/workspace/%E8%BE%93%E5%87%BA/%E6%B5%8B%E8%AF%95%20%E6%BC%94%E7%A4%BA.pptx"
    )
    expect(windowsHref).toBe(
      "sandbox:/C%3A/Work/%E6%B5%8B%E8%AF%95%E6%BC%94%E7%A4%BA.pptx"
    )
    expect(parseFilePathHrefTarget(sandboxHref)?.path).toBe(
      "/workspace/输出/测试 演示.pptx"
    )
    expect(parseFilePathHrefTarget(windowsHref)?.path).toBe(
      "C:/Work/测试演示.pptx"
    )
  })

  test("requires both links in the shared agent prompt", () => {
    expect(FILE_DELIVERY_RULE).toContain("both Preview and Download")
    expect(FILE_DELIVERY_RULE).toContain("never provide only the download")
  })
})
