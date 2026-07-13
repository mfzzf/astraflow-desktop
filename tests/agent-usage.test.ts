import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { normalizeAgentUsage } from "@/lib/agent/usage"

describe("agent usage normalization", () => {
  test("reads Responses cache and reasoning details from LangChain metadata", () => {
    const usage = normalizeAgentUsage({
      input_tokens: 2_000,
      output_tokens: 100,
      total_tokens: 2_100,
      input_token_details: { cache_read: 1_536 },
      output_token_details: { reasoning: 40 },
    })

    assert.ok(usage)
    assert.equal(usage.inputTokens, 2_000)
    assert.equal(usage.cachedInputTokens, 1_536)
    assert.equal(usage.cacheWriteInputTokens, 0)
    assert.equal(usage.reasoningOutputTokens, 40)
  })

  test("keeps Anthropic cache reads and writes separate", () => {
    const usage = normalizeAgentUsage({
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 1_800,
      cache_creation_input_tokens: 200,
    })

    assert.ok(usage)
    assert.equal(usage.inputTokens, 2_100)
    assert.equal(usage.outputTokens, 50)
    assert.equal(usage.totalTokens, 2_150)
    assert.equal(usage.cachedInputTokens, 1_800)
    assert.equal(usage.cacheWriteInputTokens, 200)
  })

  test("aggregates every model call in an agent run", () => {
    const usage = normalizeAgentUsage({
      modelUsage: {
        call_0: {
          input_tokens: 2_000,
          output_tokens: 100,
          total_tokens: 2_100,
          input_token_details: { cache_read: 1_024 },
        },
        call_1: {
          input_tokens: 2_400,
          output_tokens: 120,
          total_tokens: 2_520,
          input_token_details: { cache_read: 2_048 },
        },
      },
    })

    assert.ok(usage)
    assert.equal(usage.inputTokens, 4_400)
    assert.equal(usage.outputTokens, 220)
    assert.equal(usage.totalTokens, 4_620)
    assert.equal(usage.cachedInputTokens, 3_072)
    assert.equal(usage.cacheWriteInputTokens, 0)
  })
})
