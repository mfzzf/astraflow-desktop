// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { StudioHtmlFilePreview } from "@/components/studio-chat/right-panel/previews"

describe("Studio HTML file preview", () => {
  test("starts in rendered mode instead of showing source code", () => {
    const html = renderToStaticMarkup(
      createElement(StudioHtmlFilePreview, {
        entry: {
          extension: "html",
          kind: "file",
          modifiedAt: 1,
          name: "demo.html",
          path: "/workspace/demo.html",
          size: 54,
        },
        file: {
          content: "<!doctype html><title>source-only-marker</title>",
          directory: "/workspace",
          modifiedAt: 1,
          name: "demo.html",
          path: "/workspace/demo.html",
          size: 54,
          truncated: false,
        },
        workspace: {
          id: "workspace-1",
          rootPath: "/workspace",
          type: "sandbox",
        },
      })
    )

    expect(html).toContain("Preparing preview…")
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain("source-only-marker")
  })
})
