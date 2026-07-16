// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import {
  createElement,
  type ComponentType,
  type PropsWithChildren,
} from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  Markdown,
  type MarkdownProps,
} from "@/components/prompt-kit/markdown"
import { getStudioRemoteFileUrl } from "@/components/studio-chat/remote-workspace-api"
import { AssistantReasoning } from "@/components/studio-message-parts/reasoning"
import { MessageRenderEnvironmentContext } from "@/components/studio-message-parts/shared"
import { SandboxToolOutput } from "@/components/studio-message-parts/tool-output"
import {
  isStudioAppDownloadHref,
  isStudioExternalFileHref,
  openStudioMarkdownUrlWithFallback,
} from "@/lib/studio-markdown-open"

const TestMarkdown = Markdown as ComponentType<
  PropsWithChildren<Omit<MarkdownProps, "children">>
>

describe("studio download links", () => {
  test("keeps same-origin Studio content downloads in the current page", () => {
    expect(
      isStudioAppDownloadHref("/api/studio/files/file-1/content?download=1")
    ).toBe(true)
    expect(
      isStudioAppDownloadHref(
        "/api/studio/image-outputs/output-1/content/?download=1"
      )
    ).toBe(true)
  })

  test("does not classify previews or external URLs as app downloads", () => {
    expect(isStudioAppDownloadHref("/api/studio/files/file-1/content")).toBe(
      false
    )
    expect(
      isStudioAppDownloadHref(
        "https://example.com/api/studio/files/file-1/content?download=1"
      )
    ).toBe(false)
  })

  test("routes external file URLs outside the in-app browser", () => {
    expect(
      isStudioExternalFileHref(
        "https://downloads.example.com/%E6%98%9F%E5%9B%BE%E5%AE%A2%E6%88%B7%E7%AB%AF_%E4%BA%A7%E5%93%81%E4%BB%8B%E7%BB%8D-1.pptx"
      )
    ).toBe(true)
    expect(
      isStudioExternalFileHref(
        "https://downloads.example.com/content?id=deck&download=1"
      )
    ).toBe(true)
    expect(
      isStudioExternalFileHref(
        "https://downloads.example.com/content?filename=source-files.zip"
      )
    ).toBe(true)
    expect(
      isStudioExternalFileHref("//downloads.example.com/source-files.tar.gz")
    ).toBe(true)
    expect(
      isStudioExternalFileHref("https://example.com/docs/getting-started")
    ).toBe(false)
    expect(isStudioExternalFileHref("https://example.com/preview.html")).toBe(
      false
    )
  })

  test("falls back to the in-app browser when external web opening fails", async () => {
    const workspaceUrls: string[] = []

    await expect(
      openStudioMarkdownUrlWithFallback({
        url: "https://example.com/report.md",
        openExternal: async () => false,
        openInWorkspace: (url) => {
          workspaceUrls.push(url)
          return true
        },
      })
    ).resolves.toBe("workspace")
    expect(workspaceUrls).toEqual(["https://example.com/report.md"])
  })

  test("does not open a browser tab after the system handler succeeds", async () => {
    let workspaceOpenCount = 0

    await expect(
      openStudioMarkdownUrlWithFallback({
        url: "https://example.com/docs",
        openExternal: async () => true,
        openInWorkspace: () => {
          workspaceOpenCount += 1
          return true
        },
      })
    ).resolves.toBe("external")
    expect(workspaceOpenCount).toBe(0)
  })

  test("keeps unsupported protocol failures away from the current page", async () => {
    let workspaceOpenCount = 0

    await expect(
      openStudioMarkdownUrlWithFallback({
        url: "mailto:support@example.com",
        openExternal: async () => {
          throw new Error("No mail client")
        },
        openInWorkspace: () => {
          workspaceOpenCount += 1
          return true
        },
      })
    ).resolves.toBe("unavailable")
    expect(workspaceOpenCount).toBe(0)
  })

  test("builds authenticated sandbox download URLs without exposing raw paths", () => {
    const href = getStudioRemoteFileUrl(
      "workspace/with spaces",
      "/workspace/outputs/星图客户端_产品介绍-1.pptx",
      { download: true }
    )
    const parsed = new URL(href, "http://localhost")

    expect(parsed.pathname).toBe(
      "/api/studio/workspaces/workspace%2Fwith%20spaces/fs/file"
    )
    expect(parsed.searchParams.get("path")).toBe(
      "/workspace/outputs/星图客户端_产品介绍-1.pptx"
    )
    expect(parsed.searchParams.get("download")).toBe("1")
  })

  test("renders Studio file-library links as direct downloads", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestMarkdown,
        { openLinksInWorkspace: true },
        "[report.pdf](/api/studio/files/file-1/content?download=1)"
      )
    )

    expect(html).toContain('href="/api/studio/files/file-1/content?download=1"')
    expect(html).toContain('download=""')
    expect(html).not.toContain('target="_blank"')
  })

  test("keeps generated media download links out of the preview panel", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestMarkdown,
        { openLinksInWorkspace: true },
        "[image](/api/studio/image-outputs/output-1/content?download=1)"
      )
    )

    expect(html).toContain(
      'href="/api/studio/image-outputs/output-1/content?download=1"'
    )
    expect(html).toContain('download=""')
    expect(html).not.toContain('target="_blank"')
  })

  test("turns sandbox links into workspace file controls", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestMarkdown,
        { openLinksInWorkspace: true },
        "[下载拼接后的大图](sandbox:/Users/user/两张截图_左右拼接.png)"
      )
    )

    expect(html).toContain("下载拼接后的大图")
    expect(html).toContain("<button")
    expect(html).not.toContain('href="sandbox:')
    expect(html).not.toContain('<a href=""')
  })

  test("turns archives and unknown file extensions into workspace controls", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestMarkdown,
        { openLinksInWorkspace: true },
        [
          "[source bundle](outputs/source-files.zip)",
          "[custom result](outputs/result.custom-format)",
        ].join("\n\n")
      )
    )

    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).toContain("source bundle")
    expect(html).toContain("custom result")
    expect(html).not.toContain('href="outputs/source-files.zip"')
    expect(html).not.toContain('href="outputs/result.custom-format"')
  })

  test("keeps sandbox reasoning and tool-output file paths clickable", () => {
    const reasoningHtml = renderToStaticMarkup(
      createElement(AssistantReasoning, {
        content: "[report](/workspace/outputs/report.md)",
        environment: "remote",
      })
    )
    const toolOutputHtml = renderToStaticMarkup(
      createElement(
        MessageRenderEnvironmentContext.Provider,
        { value: "remote" },
        createElement(SandboxToolOutput, {
          output: "[report](/workspace/outputs/report.md)",
        })
      )
    )

    expect(reasoningHtml).toContain("<button")
    expect(reasoningHtml).not.toContain('href="/workspace/outputs/report.md"')
    expect(toolOutputHtml).toContain("<button")
    expect(toolOutputHtml).not.toContain('href="/workspace/outputs/report.md"')
  })

  test("continues sanitizing unsafe protocols in workspace Markdown", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestMarkdown,
        { openLinksInWorkspace: true },
        "[unsafe](javascript:alert(1))"
      )
    )

    expect(html).not.toContain("javascript:")
  })
})
