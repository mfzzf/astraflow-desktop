// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  arrangeMessagePartsForDisplay,
  isCollapsibleActivityPart,
} from "@/components/studio-message-parts/render-order"
import type { StudioMessageActivity } from "@/lib/studio-types"
import type { RenderableStudioMessagePart } from "@/components/studio-message-parts/types"

function toolPart(id: string): RenderableStudioMessagePart {
  const activity: StudioMessageActivity = {
    id,
    toolName: id,
    status: "complete",
    input: "",
    output: "",
    error: null,
  }

  return { id, type: "tool", activity }
}

function reasoningPart(id: string): RenderableStudioMessagePart {
  return {
    id,
    type: "reasoning",
    content: id,
    durationMs: 1_000,
  }
}

function textPart(id: string): RenderableStudioMessagePart {
  return { id, type: "text", content: id }
}

function planPart(id: string): RenderableStudioMessagePart {
  return {
    id,
    type: "plan",
    content: "",
    todos: [{ text: id, status: "completed" }],
  }
}

function mediaPart(id: string): RenderableStudioMessagePart {
  return {
    id,
    type: "media_generation",
    kind: "image",
    generationId: id,
    status: "complete",
    modelName: "test-image-model",
    prompt: "test prompt",
    outputs: [],
    errorMessage: null,
  }
}

describe("studio message render order", () => {
  test("renders activity summaries before the model output they lead into", () => {
    const items = arrangeMessagePartsForDisplay(
      [
        reasoningPart("reasoning-before-first-output"),
        toolPart("tool-before-first-output"),
        textPart("first-output"),
        toolPart("tool-after-first-output"),
        textPart("second-output"),
        reasoningPart("reasoning-after-second-output"),
      ],
      isCollapsibleActivityPart
    )

    expect(
      items.map((item) =>
        item.type === "part" ? item.part.id : item.parts.map((part) => part.id)
      )
    ).toEqual([
      ["reasoning-before-first-output", "tool-before-first-output"],
      "first-output",
      ["tool-after-first-output", "reasoning-after-second-output"],
      "second-output",
    ])
  })

  test("keeps trailing activity above the final answer", () => {
    const items = arrangeMessagePartsForDisplay(
      [textPart("answer"), reasoningPart("late-reasoning")],
      isCollapsibleActivityPart
    )

    expect(
      items.map((item) =>
        item.type === "part" ? item.part.id : item.parts.map((part) => part.id)
      )
    ).toEqual([["late-reasoning"], "answer"])
  })

  test("renders the plan last in the final activity group", () => {
    const items = arrangeMessagePartsForDisplay(
      [
        reasoningPart("reasoning"),
        planPart("plan"),
        toolPart("tool"),
        textPart("answer"),
      ],
      isCollapsibleActivityPart
    )

    expect(
      items.map((item) =>
        item.type === "part" ? item.part.id : item.parts.map((part) => part.id)
      )
    ).toEqual([["reasoning", "tool", "plan"], "answer"])
  })

  test("keeps a single activity summary when no model output exists yet", () => {
    const items = arrangeMessagePartsForDisplay(
      [reasoningPart("reasoning"), toolPart("tool")],
      isCollapsibleActivityPart
    )

    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe("activity_group")
    expect(
      items[0]?.type === "activity_group"
        ? items[0].parts.map((part) => part.id)
        : []
    ).toEqual(["reasoning", "tool"])
  })

  test("keeps generated media inside the work summary", () => {
    const items = arrangeMessagePartsForDisplay(
      [reasoningPart("reasoning"), mediaPart("image"), textPart("answer")],
      isCollapsibleActivityPart
    )

    expect(
      items.map((item) =>
        item.type === "part" ? item.part.id : item.parts.map((part) => part.id)
      )
    ).toEqual([["reasoning", "image"], "answer"])
  })
})
