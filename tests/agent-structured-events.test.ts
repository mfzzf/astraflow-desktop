// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { createSnapshotAccumulator } from "@/lib/agent/run-orchestrator"
import { parseActivities, parseParts } from "@/lib/studio-db/helpers"
import { studioMessageTextForPrompt } from "@/lib/studio-session-prompt-context"
import type { StudioMessage } from "@/lib/studio-types"

describe("protocol-neutral structured agent events", () => {
  test("persists structured content and keeps legacy text projections", () => {
    const accumulator = createSnapshotAccumulator()

    accumulator.handleEvent({
      type: "content_block",
      messageId: "message-1",
      content: { type: "text", text: "Hello " },
    })
    accumulator.handleEvent({
      type: "content_block",
      messageId: "message-1",
      content: { type: "text", text: "world" },
    })
    accumulator.handleEvent({
      type: "content_block",
      messageId: "message-1",
      content: {
        type: "resource",
        resource: {
          uri: "file:///workspace/notes.md",
          mimeType: "text/markdown",
          text: "Resource text",
        },
      },
    })
    accumulator.handleEvent({
      type: "content_block",
      messageId: "message-1",
      content: {
        type: "image",
        data: "aW1hZ2U=",
        mimeType: "image/png",
      },
    })

    const snapshot = accumulator.getSnapshot()
    const contentParts = snapshot.parts.filter(
      (part) => part.type === "content"
    )

    expect(snapshot.content).toBe("Hello worldResource text")
    expect(contentParts).toHaveLength(3)
    expect(contentParts[0]).toMatchObject({
      type: "content",
      messageId: "message-1",
      content: { type: "text", text: "Hello world" },
    })
    expect(
      parseParts(JSON.stringify(snapshot.parts)).filter(
        (part) => part.type === "content"
      )
    ).toHaveLength(3)
  })

  test("removes retried structured blocks by persisted message id", () => {
    const accumulator = createSnapshotAccumulator()

    accumulator.handleEvent({
      type: "content_block",
      messageId: "attempt-1",
      content: { type: "text", text: "discard me" },
    })
    accumulator.handleEvent({
      type: "assistant_retry",
      phase: "start",
      messageId: "attempt-1",
      channel: "text",
      attempt: 1,
    })

    expect(accumulator.getSnapshot().content).toBe("")
    expect(accumulator.getSnapshot().parts).toHaveLength(0)
  })

  test("upserts and removes independently identified plan variants", () => {
    const accumulator = createSnapshotAccumulator()

    accumulator.handleEvent({
      type: "plan_update",
      planId: "implementation",
      variant: "items",
      todos: [{ text: "Inspect", status: "in_progress" }],
    })
    accumulator.handleEvent({
      type: "plan_update",
      planId: "notes",
      variant: "markdown",
      content: "## Notes",
      todos: [],
    })
    accumulator.handleEvent({
      type: "plan_update",
      planId: "implementation",
      variant: "items",
      todos: [{ text: "Inspect", status: "completed" }],
    })

    let plans = accumulator
      .getSnapshot()
      .parts.filter((part) => part.type === "plan")

    expect(plans).toHaveLength(2)
    expect(
      plans.find((part) => part.planId === "implementation")?.todos
    ).toEqual([{ text: "Inspect", status: "completed" }])
    expect(plans.find((part) => part.planId === "notes")).toMatchObject({
      variant: "markdown",
      content: "## Notes",
    })

    accumulator.handleEvent({ type: "plan_remove", planId: "notes" })
    plans = accumulator
      .getSnapshot()
      .parts.filter((part) => part.type === "plan")
    expect(plans.map((part) => part.planId)).toEqual(["implementation"])
  })

  test("tool updates replace and explicitly clear ACP fields", () => {
    const accumulator = createSnapshotAccumulator()

    accumulator.handleEvent({
      type: "tool_update",
      id: "tool-1",
      name: "execute",
      title: "Run checks",
      kind: "execute",
      acpStatus: "in_progress",
      locations: [{ path: "/workspace/package.json", line: 12 }],
      content: [{ type: "terminal", terminalId: "terminal-1" }],
      rawInput: { command: "bun test" },
      meta: { provider: "fixture" },
    })
    accumulator.handleEvent({
      type: "tool_update",
      id: "tool-1",
      acpStatus: "completed",
      title: "Checks complete",
      content: [
        {
          type: "content",
          content: { type: "text", text: "All checks passed" },
        },
      ],
      rawOutput: { exitCode: 0 },
    })

    expect(accumulator.getSnapshot().activities[0]).toMatchObject({
      id: "tool-1",
      title: "Checks complete",
      kind: "execute",
      status: "complete",
      acpStatus: "completed",
      rawInput: { command: "bun test" },
      rawOutput: { exitCode: 0 },
    })

    accumulator.handleEvent({
      type: "tool_update",
      id: "tool-1",
      title: null,
      locations: null,
      content: null,
      meta: null,
      rawOutput: null,
    })

    const activity = accumulator.getSnapshot().activities[0]
    expect(activity.title).toBeNull()
    expect(activity.locations).toBeNull()
    expect(activity.content).toBeNull()
    expect(activity.meta).toBeNull()
    expect(activity.rawOutput).toBeNull()
    expect(parseActivities(JSON.stringify([activity]))).toHaveLength(1)
  })

  test("persists ACP subagent identity and lifecycle metadata", () => {
    const accumulator = createSnapshotAccumulator()

    accumulator.handleEvent({
      type: "subagent_start",
      taskId: "spawn-1",
      name: "Locke",
      taskInput: "Inspect the renderer",
      providerThreadId: "child-thread-1",
      providerParentThreadId: "parent-thread",
      agentId: "agent-1",
      nickname: "Locke",
      role: "explorer",
      model: "gpt-5.4-mini",
      effort: "high",
      background: true,
    })
    accumulator.handleEvent({
      type: "subagent_end",
      taskId: "spawn-1",
      name: "Locke",
      status: "complete",
      summary: "Renderer inspected",
      providerThreadId: "child-thread-1",
    })

    const part = accumulator
      .getSnapshot()
      .parts.find((candidate) => candidate.type === "subagent")

    expect(part).toMatchObject({
      type: "subagent",
      taskId: "spawn-1",
      name: "Locke",
      status: "complete",
      summary: "Renderer inspected",
      providerThreadId: "child-thread-1",
      providerParentThreadId: "parent-thread",
      agentId: "agent-1",
      nickname: "Locke",
      role: "explorer",
      model: "gpt-5.4-mini",
      effort: "high",
      background: true,
    })
    expect(parseParts(JSON.stringify([part]))).toHaveLength(1)
  })

  test("rejects malformed persisted structured parts", () => {
    expect(
      parseParts(
        JSON.stringify([
          {
            id: "invalid",
            type: "content",
            content: { type: "image", data: 123, mimeType: "image/png" },
          },
        ])
      )
    ).toEqual([])
  })

  test("includes text-bearing structured content in assistant prompt history", () => {
    const message = {
      role: "assistant",
      content: "legacy projection",
      parts: [
        {
          id: "text",
          type: "content",
          channel: "message",
          content: { type: "text", text: "Structured answer" },
        },
        {
          id: "resource",
          type: "content",
          channel: "message",
          content: {
            type: "resource",
            resource: { uri: "file:///notes.txt", text: "Resource notes" },
          },
        },
        {
          id: "thought",
          type: "content",
          channel: "thought",
          content: { type: "text", text: "Private thought" },
        },
      ],
    } as StudioMessage

    expect(studioMessageTextForPrompt(message)).toBe(
      "Structured answer\nResource notes"
    )
  })
})
