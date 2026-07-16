import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  createModelversePiPayloadTransform,
  mapAstraFlowReasoningEffortToPi,
  mapModelverseProtocolToPiApi,
} from "@/lib/modelverse-pi"

describe("AstraFlow shared Pi model configuration", () => {
  test("maps ModelVerse protocols and reasoning levels", () => {
    assert.equal(mapModelverseProtocolToPiApi("openai-chat"), "openai-completions")
    assert.equal(
      mapModelverseProtocolToPiApi("openai-responses"),
      "openai-responses"
    )
    assert.equal(
      mapModelverseProtocolToPiApi("anthropic-messages"),
      "anthropic-messages"
    )
    assert.equal(mapAstraFlowReasoningEffortToPi("none"), "off")
    assert.equal(mapAstraFlowReasoningEffortToPi("enabled"), "medium")
    assert.equal(mapAstraFlowReasoningEffortToPi("max"), "max")
  })

  test("preserves ModelVerse DeepSeek's high/max payload contract", () => {
    const high = createModelversePiPayloadTransform(
      "deepseek_reasoning_effort",
      "high"
    )
    const max = createModelversePiPayloadTransform(
      "deepseek_reasoning_effort",
      "max"
    )

    assert.deepEqual(high?.({ enable_thinking: true }), {
      enable_thinking: true,
      reasoning_effort: "high",
    })
    assert.deepEqual(max?.({ enable_thinking: true }), {
      enable_thinking: true,
      reasoning_effort: "max",
    })
    assert.equal(
      createModelversePiPayloadTransform(
        "deepseek_reasoning_effort",
        "none"
      ),
      undefined
    )
  })
})
