// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { DOMParser as LinkedomDOMParser } from "linkedom"

import {
  prepareWorkspaceHtmlPreview,
  StudioHtmlFilePreview,
  validateWorkspaceHtmlPreviewRevision,
} from "@/components/studio-chat/right-panel/previews"

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
    expect(html).toContain("Safe preview · scripts off")
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain("source-only-marker")
  })

  test("strips script and network-capable content from rendered HTML", async () => {
    const previousDOMParser = globalThis.DOMParser

    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: LinkedomDOMParser,
    })

    try {
      const prepared = await prepareWorkspaceHtmlPreview(
        `<!doctype html><html><head>
          <meta http-equiv="refresh" content="0;url=https://evil.example">
          <link rel="stylesheet" href="https://evil.example/theme.css">
          <style>
            @import "https://evil.example/import.css";
            body { background: url(https://evil.example/background.png); }
          </style>
        </head><body background="https://evil.example/body.png">
          <script>globalThis.compromised = true</script>
          <img src="https://evil.example/pixel.png" srcset="https://evil.example/2x.png 2x" onerror="alert(1)">
          <iframe src="https://evil.example/frame"></iframe>
          <form action="https://evil.example/post"><button formaction="https://evil.example/action">Go</button></form>
          <a href="https://evil.example/click" ping="https://evil.example/ping">link</a>
        </body></html>`,
        "/workspace",
        {
          id: "workspace-1",
          rootPath: "/workspace",
          type: "sandbox",
        }
      )

      expect(prepared).toContain("Content-Security-Policy")
      expect(prepared).toContain("default-src 'none'")
      expect(prepared).not.toContain("<script")
      expect(prepared).not.toContain("<iframe")
      expect(prepared).not.toContain("http-equiv=\"refresh\"")
      expect(prepared).not.toContain("https://evil.example")
      expect(prepared).not.toContain("onerror")
      expect(prepared).not.toContain("srcset")
      expect(prepared).not.toContain("formaction")
      expect(prepared).not.toContain("background=")
    } finally {
      Object.defineProperty(globalThis, "DOMParser", {
        configurable: true,
        value: previousDOMParser,
      })
    }
  })

  test("validates the current file content against its authoritative SHA-256 revision", async () => {
    expect(
      await validateWorkspaceHtmlPreviewRevision(
        "hello",
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
      )
    ).toBe(true)
    expect(
      await validateWorkspaceHtmlPreviewRevision(
        "changed",
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
      )
    ).toBe(false)
    expect(
      await validateWorkspaceHtmlPreviewRevision("hello", "revision-1")
    ).toBe(false)
  })
})
