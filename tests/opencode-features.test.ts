// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  OPENCODE_BUILD_MODE,
  OPENCODE_PLAN_MODE,
  getOpenCodePlanMode,
  getOpenCodeSelectOptions,
} from "@/lib/agent/acp/opencode-features"

describe("OpenCode ACP feature projection", () => {
  test("reads Build and Plan from the live mode config", () => {
    const configOptions = [
      {
        id: "mode",
        name: "Session Mode",
        category: "mode",
        type: "select" as const,
        currentValue: OPENCODE_PLAN_MODE,
        options: [
          { value: OPENCODE_BUILD_MODE, name: "build" },
          { value: OPENCODE_PLAN_MODE, name: "plan" },
        ],
      },
    ]

    expect(getOpenCodePlanMode(configOptions)).toEqual({
      active: true,
      available: true,
      currentMode: OPENCODE_PLAN_MODE,
      defaultMode: OPENCODE_BUILD_MODE,
    })
  })

  test("flattens grouped model options without losing group labels", () => {
    const options = getOpenCodeSelectOptions({
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: "provider/model",
      options: [
        {
          group: "provider",
          name: "Provider",
          options: [{ value: "provider/model", name: "Model" }],
        },
      ],
    })

    expect(options).toEqual([
      {
        value: "provider/model",
        name: "Model",
        groupId: "provider",
        groupName: "Provider",
      },
    ])
  })
})
