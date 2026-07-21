// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { AssistantActivity } from "@/components/studio-message-parts/tool"
import type { StudioMessageActivity } from "@/lib/studio-types"

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

    const html = renderToStaticMarkup(
      createElement(AssistantActivity, { activity })
    )

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

    const html = renderToStaticMarkup(
      createElement(AssistantActivity, { activity })
    )

    expect(html).toContain("PreToolUse: Bash")
    expect(html).not.toContain("PreToolUse: PreToolUse")
    expect(html).toContain("Lifecycle event")
    expect(html).toContain("Matcher")
    expect(html).toContain("Hook command failed.")
  })
})
