// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  createStudioSessionMarkdown,
  createStudioSessionMarkdownFilename,
} from "@/lib/studio-session-markdown"
import type { StudioMessage } from "@/lib/studio-types"

function message(
  role: StudioMessage["role"],
  content: string,
  overrides: Partial<StudioMessage> = {}
): StudioMessage {
  return {
    id: `${role}-1`,
    sessionId: "session-1",
    role,
    content,
    model: null,
    versionGroupId: null,
    versionIndex: 0,
    versionCount: 1,
    isActiveVersion: true,
    activities: [],
    parts: [],
    reasoningContent: "",
    reasoningDurationMs: null,
    status: "complete",
    attachments: [],
    createdAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  }
}

describe("studio session Markdown export", () => {
  test("preserves rendered Markdown without exporting hidden reasoning", () => {
    const markdown = createStudioSessionMarkdown(
      { title: "Plan review" },
      [
        message("user", "Please make a plan."),
        message("assistant", "- Inspect\n- Implement", {
          reasoningContent: "private chain of thought",
        }),
      ]
    )

    expect(markdown).toContain("# Plan review")
    expect(markdown).toContain("## User\n\nPlease make a plan.")
    expect(markdown).toContain("## Assistant\n\n- Inspect\n- Implement")
    expect(markdown).not.toContain("private chain of thought")
  })

  test("falls back to visible text parts and lists attachments", () => {
    const markdown = createStudioSessionMarkdown(
      { title: "Files" },
      [
        message("user", "", {
          parts: [{ id: "text-1", type: "text", content: "Review this." }],
          attachments: [
            { type: "file", name: "notes.md", mimeType: "text/markdown" },
          ],
        }),
      ]
    )

    expect(markdown).toContain("Review this.")
    expect(markdown).toContain("- Attachment: notes.md")
  })

  test("exports visible audit activity while redacting secret answers", () => {
    const markdown = createStudioSessionMarkdown(
      { title: "Audit" },
      [
        message("assistant", "Done.", {
          parts: [
            {
              id: "tool-1",
              type: "tool",
              activity: {
                id: "tool-1",
                toolName: "bash",
                status: "complete",
                input: "secret command input",
                output: "secret tool output",
                error: null,
                title: "Listed directory",
              },
            },
            {
              id: "plan-1",
              type: "plan",
              content: "Ship the fix",
              todos: [
                { text: "Run tests", status: "completed" },
              ],
            },
            {
              id: "permission-1",
              type: "permission",
              toolName: "bash",
              input: "sensitive input",
              status: "approved",
              options: [
                {
                  optionId: "allow_once",
                  name: "Allow once",
                  kind: "allow_once",
                },
              ],
              selectedOptionId: "allow_once",
            },
            {
              id: "input-1",
              type: "user_input",
              status: "answered",
              questions: [
                {
                  id: "token",
                  header: "Token",
                  question: "API token?",
                  options: [],
                  allowOther: true,
                  isSecret: true,
                },
              ],
              answers: [
                {
                  questionId: "token",
                  optionId: null,
                  label: null,
                  text: "sk-private",
                },
              ],
              autoResolutionMs: null,
            },
          ],
        }),
      ]
    )

    expect(markdown).toContain("### Activity")
    expect(markdown).toContain("- Tool completed: Listed directory")
    expect(markdown).toContain("- [x] Run tests (completed)")
    expect(markdown).toContain("Permission approved: bash — Allow once")
    expect(markdown).toContain("Token: [redacted]")
    expect(markdown).not.toContain("secret command input")
    expect(markdown).not.toContain("secret tool output")
    expect(markdown).not.toContain("sk-private")
  })

  test("creates a filesystem-safe Markdown filename", () => {
    expect(createStudioSessionMarkdownFilename('Plan: "alpha/beta"')).toBe(
      "Plan- -alpha-beta-.md"
    )
  })
})
