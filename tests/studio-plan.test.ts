// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  getAssistantPlanPriorityLabel,
  getAssistantPlanProgress,
} from "@/components/studio-message-parts/plan-todo"
import type { StudioMessageTodo } from "@/lib/studio-types"

function todos(statuses: StudioMessageTodo["status"][]): StudioMessageTodo[] {
  return statuses.map((status, index) => ({
    text: `Step ${index + 1}`,
    status,
  }))
}

describe("assistant plan progress", () => {
  test("uses the explicit in-progress item as the current step", () => {
    expect(
      getAssistantPlanProgress(
        todos(["completed", "in_progress", "pending"])
      )
    ).toEqual({
      currentIndex: 1,
      currentStep: 2,
      completedCount: 1,
      complete: false,
    })
  })

  test("falls forward to the first pending item between active steps", () => {
    expect(
      getAssistantPlanProgress(todos(["completed", "pending", "pending"]))
        .currentStep
    ).toBe(2)
  })

  test("finishes on the final step when every item is complete", () => {
    expect(
      getAssistantPlanProgress(
        todos(["completed", "completed", "completed"])
      )
    ).toEqual({
      currentIndex: 2,
      currentStep: 3,
      completedCount: 3,
      complete: true,
    })
  })

  test("renders every ACP plan priority as an explicit badge label", () => {
    expect(getAssistantPlanPriorityLabel("high")).toBe("HIGH")
    expect(getAssistantPlanPriorityLabel("medium")).toBe("MEDIUM")
    expect(getAssistantPlanPriorityLabel("low")).toBe("LOW")
    expect(getAssistantPlanPriorityLabel(null)).toBe(null)
  })
})
