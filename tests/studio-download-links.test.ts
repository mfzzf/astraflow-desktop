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
import { isStudioAppDownloadHref } from "@/lib/studio-markdown-open"

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

  test("renders Studio file-library links as direct downloads", () => {
    const html = renderToStaticMarkup(
      createElement(
        TestMarkdown,
        { openLinksInWorkspace: true },
        "[report.pdf](/api/studio/files/file-1/content?download=1)"
      )
    )

    expect(html).toContain(
      'href="/api/studio/files/file-1/content?download=1"'
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
