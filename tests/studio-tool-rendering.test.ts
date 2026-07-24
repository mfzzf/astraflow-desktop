// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { ThemeProvider } from "@/components/theme-provider"
import { AssistantActivity } from "@/components/studio-message-parts/tool"
import { ToolActivityDetails } from "@/components/studio-message-parts/tool-output"
import {
  aggregateTurnFileChanges,
  AssistantFileChangeGroup,
} from "@/components/studio-message-parts/file-change"
import { getWrittenFileInfo } from "@/components/studio-message-parts/file-output"
import { MessagePartsRenderer } from "@/components/studio-message-parts/renderer"
import { getToolInputCodeBlockOptions } from "@/components/studio-message-parts/tool-output"
import type { StudioMessageActivity } from "@/lib/studio-types"

const TestThemeProvider = ThemeProvider as React.ComponentType<{
  defaultTheme?: "light" | "dark" | "system"
}>

function renderWithTheme(element: React.ReactNode) {
  return renderToStaticMarkup(
    createElement(TestThemeProvider, { defaultTheme: "light" }, element)
  )
}

describe("studio ACP tool rendering", () => {
  test("uses the command view for ACP protocol details without duplicate output", () => {
    const output = "acp-runtime.ts\nclaude-features.ts"
    const activity: StudioMessageActivity = {
      id: "claude-bash",
      toolName: "execute",
      title: 'ls lib/agent/acp && grep -R "claude" lib/agent',
      kind: "execute",
      status: "running",
      input: "{}",
      output: JSON.stringify({
        content: [{ type: "text", text: output }],
      }),
      error: null,
      rawInput: {},
      rawOutput: {
        content: [{ type: "text", text: output }],
      },
      content: [
        {
          type: "content",
          content: { type: "text", text: output },
        },
      ],
    }

    const html = renderWithTheme(createElement(AssistantActivity, { activity }))

    expect(html).toContain("ls lib/agent/acp")
    expect(html.match(/acp-runtime\.ts/g)).toHaveLength(1)
    expect(html).not.toContain("&quot;content&quot;")
  })

  test("renders Claude hook lifecycle details without duplicated titles", () => {
    const activity: StudioMessageActivity = {
      id: "claude-pre-tool-hook",
      toolName: "hook",
      title: "PreToolUse: PreToolUse:Bash",
      kind: "think",
      status: "error",
      input: JSON.stringify({
        event: "PreToolUse",
        name: "PreToolUse:Bash",
      }),
      output: "",
      error: "Hook command failed.",
    }

    const html = renderWithTheme(createElement(AssistantActivity, { activity }))

    expect(html).toContain("PreToolUse: Bash")
    expect(html).not.toContain("PreToolUse: PreToolUse")
    expect(html).toContain("Lifecycle event")
    expect(html).toContain("Matcher")
    expect(html).toContain("Hook command failed.")
  })

  test("keeps Pi writes in the file renderer when ACP raw details are present", () => {
    const activity: StudioMessageActivity = {
      id: "pi-write",
      toolName: "write_file",
      title: "write",
      kind: "edit",
      status: "running",
      input: JSON.stringify({ title: "write" }),
      output: "",
      error: null,
      rawInput: {
        path: "demo.html",
        content: Array.from(
          { length: 12 },
          (_, index) => `<p>line ${index + 1}</p>`
        ).join("\n"),
      },
    }

    const html = renderWithTheme(createElement(AssistantActivity, { activity }))

    expect(html).toContain("demo.html")
    expect(html).toContain('data-unified-diff="true"')
    expect(html).toContain('data-streaming="true"')
    expect(html).toContain("&lt;p&gt;line 1&lt;/p&gt;")
    expect(html).not.toContain("synara-codeblock")
    expect(html).not.toContain("&quot;path&quot;")
  })

  test("renders partial streamed file JSON as an incremental file diff", () => {
    const activity: StudioMessageActivity = {
      id: "pi-write-partial",
      toolName: "write_file",
      title: "write",
      kind: "edit",
      status: "running",
      input: '{"path":"demo.html","content":"line 1\\nline 2',
      output: "",
      error: null,
    }

    expect(getWrittenFileInfo(activity)).toEqual({
      path: "demo.html",
      kind: "create",
      oldText: "",
      newText: "line 1\nline 2",
    })
    const html = renderWithTheme(createElement(AssistantActivity, { activity }))

    expect(html).toContain("demo.html")
    expect(html).toContain('data-unified-diff="true"')
    expect(html).toContain('data-streaming="true"')
    expect(html).toContain("line 1")
    expect(html).toContain("line 2")
    expect(html).not.toContain("&quot;content&quot;")
  })

  test("shows canonical raw parameters instead of an ACP title placeholder", () => {
    const activity: StudioMessageActivity = {
      id: "download-file",
      toolName: "download_file",
      title: "download_file",
      kind: "other",
      status: "complete",
      input: JSON.stringify({ title: "download_file" }),
      output: "",
      error: null,
      rawInput: {
        path: "/workspace/index.html",
        name: "index.html",
      },
    }
    const html = renderWithTheme(
      createElement(ToolActivityDetails, { activity })
    )

    expect(html).toContain("/workspace/index.html")
    expect(html).toContain("&quot;name&quot;")
    expect(html).not.toContain("&quot;title&quot;")
  })

  test("does not collapse ordinary running tool input", () => {
    expect(
      getToolInputCodeBlockOptions({
        toolName: "execute",
        status: "running",
      })
    ).toEqual({
      collapsedLines: undefined,
      defaultWrap: false,
      streaming: true,
    })
  })

  test("renders a structured service failure as an error, not a success", () => {
    const activity: StudioMessageActivity = {
      id: "service-failed",
      toolName: "sandbox_start_service",
      title: "Start service",
      kind: "execute",
      status: "complete",
      input: "{}",
      output: "Service failed.",
      error: null,
      rawOutput: {
        structuredContent: {
          astraflow: {
            service: {
              schemaVersion: 1,
              serviceId: null,
              name: "demo",
              status: "failed",
              port: null,
              cwd: "/workspace",
              healthPath: "/",
              logPath: "",
              entryPath: "demo.html",
              artifactKey: "demo",
              specFingerprint: "",
              specRevision: null,
              publicUrl: null,
              failure: "Health check timed out.",
            },
          },
        },
      },
    }
    const html = renderWithTheme(createElement(AssistantActivity, { activity }))

    expect(html).toContain("tabler-icon-x")
    expect(html).not.toContain("tabler-icon-check")
    expect(html).toContain("Health check timed out.")
  })

  test("renders a completed mutation as an expanded scrollable file diff", () => {
    const html = renderWithTheme(
      createElement(AssistantFileChangeGroup, {
        files: [
          {
            id: "file-change",
            type: "file",
            path: "demo.html",
            kind: "create",
            status: "complete",
            error: null,
            content: "Created demo.html",
            diff: [
              "diff --git a/demo.html b/demo.html",
              "new file mode 100644",
              "--- /dev/null",
              "+++ b/demo.html",
              "@@ -0,0 +1 @@",
              "+<main>ready</main>",
            ].join("\n"),
            toolCallId: "pi-write",
            revision: "revision-1",
          },
        ],
      })
    )

    expect(html).toContain('aria-expanded="true"')
    expect(html.match(/data-file-diff-trigger="true"/g)).toHaveLength(1)
    expect(html).toContain('data-file-diff-content="true"')
    expect(html).toContain("animate-collapsible-down")
    expect(html).toContain("animate-collapsible-up")
    expect(html).toContain('data-unified-diff="true"')
    expect(html).toContain("&lt;main&gt;ready&lt;/main&gt;")
    expect(html).toContain("demo.html")
    expect(html).toContain("+1")
    expect(html).toContain("-0")
    expect(html).not.toContain("diff --git")
    expect(html).not.toContain("new file mode")
    expect(html).not.toContain("/dev/null")
    expect(html).not.toContain("Show")
  })

  test("preserves a large mutation blob reference for Review", () => {
    const file = {
      id: "large-file-change",
      type: "file" as const,
      path: "large.html",
      kind: "edit" as const,
      status: "complete" as const,
      error: null,
      content: "Edited large.html",
      diff: null,
      stats: { additions: 420, deletions: 19 },
      diffBlobId: "a".repeat(64),
      diffTruncated: true,
      revision: "b".repeat(64),
    }
    const changes = aggregateTurnFileChanges([file])
    const html = renderWithTheme(
      createElement(AssistantFileChangeGroup, { files: [file] })
    )

    expect(changes).toMatchObject([
      {
        path: "large.html",
        additions: 420,
        deletions: 19,
        diff: null,
        diffBlobId: "a".repeat(64),
        diffTruncated: true,
        revision: "b".repeat(64),
      },
    ])
    expect(html).toContain("open Review to load the full diff")
  })

  test("states explicitly when a truncated mutation has no full diff blob", () => {
    const html = renderWithTheme(
      createElement(AssistantFileChangeGroup, {
        files: [
          {
            id: "large-file-change-without-blob",
            type: "file",
            path: "large.html",
            kind: "edit",
            status: "complete",
            error: null,
            content: "Edited large.html",
            diff: null,
            stats: { additions: 420, deletions: 19 },
            diffBlobId: null,
            diffTruncated: true,
            revision: "b".repeat(64),
          },
        ],
      })
    )

    expect(html).toContain("full diff is unavailable")
    expect(html).not.toContain("open Review to load")
  })

  test("replaces a completed write tool with its authoritative file card", () => {
    const activity: StudioMessageActivity = {
      id: "pi-write-complete",
      toolName: "write_file",
      title: "write",
      kind: "edit",
      status: "complete",
      input: JSON.stringify({
        path: "/workspace/demo.html",
        content: "<main>ready</main>",
      }),
      output: "wrote demo.html",
      error: null,
    }
    const diff = [
      "diff --git a/demo.html b/demo.html",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/demo.html",
      "@@ -0,0 +1 @@",
      "+<main>ready</main>",
    ].join("\n")
    const html = renderWithTheme(
      createElement(MessagePartsRenderer, {
        content: "Done.",
        activities: [activity],
        parts: [
          { id: activity.id, type: "tool", activity },
          {
            id: "file-change",
            type: "file",
            path: "demo.html",
            kind: "create",
            status: "complete",
            error: null,
            content: "Created demo.html",
            diff,
            toolCallId: activity.id,
            revision: "revision-1",
          },
          {
            id: "answer",
            type: "text",
            content: "Done.",
            phase: "final_answer",
          },
        ],
        startedAt: "2026-07-23T00:00:00.000Z",
        completedAt: "2026-07-23T00:00:01.000Z",
      })
    )

    expect(html.match(/data-unified-diff="true"/g)).toHaveLength(1)
    expect(html).not.toContain("synara-codeblock")
    expect(html).toContain("&lt;main&gt;ready&lt;/main&gt;")
    expect(html).toContain("Done.")
    expect(html).not.toContain("wrote demo.html")
  })
})
