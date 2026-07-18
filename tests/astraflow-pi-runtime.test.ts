import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  createModelverseOpenAICompat,
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

  test("uses PPIO-compatible Chat Completions fields for Kimi K3", () => {
    assert.deepEqual(
      createModelverseOpenAICompat("openai_reasoning_effort", "kimi-k3"),
      {
        thinkingFormat: "openai",
        maxTokensField: "max_tokens",
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsStore: false,
        supportsStrictMode: false,
        supportsUsageInStreaming: true,
      }
    )
  })
})
