import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  formatUsageCost,
  resolveContextUsage,
} from "@/components/studio-chat/context-usage"
import {
  mergeAgentUsageSnapshots,
  normalizeAgentUsage,
} from "@/lib/agent/usage"
import type { StudioTokenUsage } from "@/lib/studio-types"

describe("agent usage normalization", () => {
  test("reads Responses cache and reasoning token details", () => {
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

  test("reads provider model context windows", () => {
    const usage = normalizeAgentUsage({
      inputTokens: 2_000,
      outputTokens: 100,
      contextWindow: 200_000,
    })

    assert.ok(usage)
    assert.equal(usage.modelContextWindow, 200_000)
  })

  test("reads Pi usage with separate cache and reasoning counters", () => {
    const usage = normalizeAgentUsage({
      input: 1_000,
      output: 200,
      cacheRead: 300,
      cacheWrite: 50,
      reasoning: 80,
      totalTokens: 1_550,
    })

    assert.ok(usage)
    assert.equal(usage.inputTokens, 1_350)
    assert.equal(usage.outputTokens, 200)
    assert.equal(usage.totalTokens, 1_550)
    assert.equal(usage.cachedInputTokens, 300)
    assert.equal(usage.cacheWriteInputTokens, 50)
    assert.equal(usage.reasoningOutputTokens, 80)
  })

  test("reads ACP prompt usage aliases without double-counting cache tokens", () => {
    const usage = normalizeAgentUsage({
      inputTokens: 1_000,
      outputTokens: 200,
      totalTokens: 1_200,
      thoughtTokens: 80,
      cachedReadTokens: 300,
      cachedWriteTokens: 50,
    })

    assert.ok(usage)
    assert.equal(usage.inputTokens, 1_000)
    assert.equal(usage.outputTokens, 200)
    assert.equal(usage.totalTokens, 1_200)
    assert.equal(usage.cachedInputTokens, 300)
    assert.equal(usage.cacheWriteInputTokens, 50)
    assert.equal(usage.reasoningOutputTokens, 80)
  })

  test("normalizes ACP context usage and cumulative cost updates", () => {
    const update = {
      used: 12_345,
      size: 128_000,
      cost: {
        amount: 1.2345,
        currency: "USD",
        _meta: { billingScope: "session" },
      },
    }
    const usage = normalizeAgentUsage(update)

    assert.ok(usage)
    assert.equal(usage.inputTokens, 0)
    assert.equal(usage.outputTokens, 0)
    assert.equal(usage.totalTokens, 0)
    assert.equal(usage.contextTokensUsed, 12_345)
    assert.equal(usage.contextWindowSize, 128_000)
    assert.deepEqual(usage.cost, {
      amount: 1.2345,
      currency: "USD",
      _meta: { billingScope: "session" },
    })
    assert.equal(usage.raw, update)
  })

  test("keeps a zero-valued ACP context update", () => {
    const usage = normalizeAgentUsage({ used: 0, size: 128_000 })

    assert.ok(usage)
    assert.equal(usage.contextTokensUsed, 0)
    assert.equal(usage.contextWindowSize, 128_000)
  })

  test("merges ACP context updates with final prompt token usage", () => {
    const context = normalizeAgentUsage({
      used: 12_345,
      size: 128_000,
      cost: { amount: 0.5, currency: "USD" },
    })
    const tokens = normalizeAgentUsage({
      inputTokens: 10_000,
      outputTokens: 500,
      totalTokens: 10_500,
      thoughtTokens: 120,
    })

    assert.ok(context)
    assert.ok(tokens)
    assert.deepEqual(mergeAgentUsageSnapshots(context, tokens), {
      inputTokens: 10_000,
      outputTokens: 500,
      totalTokens: 10_500,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      reasoningOutputTokens: 120,
      modelContextWindow: null,
      contextTokensUsed: 12_345,
      contextWindowSize: 128_000,
      cost: { amount: 0.5, currency: "USD" },
      raw: tokens.raw,
    })
  })
})

describe("context usage indicator values", () => {
  const legacyUsage: StudioTokenUsage = {
    inputTokens: 32_000,
    outputTokens: 1_000,
    totalTokens: 33_000,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningOutputTokens: 0,
    modelContextWindow: 200_000,
  }

  test("prefers the selected built-in model window over an ACP fallback", () => {
    assert.deepEqual(
      resolveContextUsage(100_000, {
        ...legacyUsage,
        contextTokensUsed: 8_000,
        contextWindowSize: 64_000,
      }),
      { used: 8_000, total: 100_000, percent: 8 }
    )
  })

  test("uses ACP context size for a custom model without configured metadata", () => {
    assert.deepEqual(
      resolveContextUsage(0, {
        ...legacyUsage,
        contextTokensUsed: 8_000,
        contextWindowSize: 64_000,
      }),
      { used: 8_000, total: 64_000, percent: 13 }
    )
  })

  test("does not treat cumulative input tokens as current context usage", () => {
    assert.equal(resolveContextUsage(100_000, legacyUsage), null)
  })

  test("requires an explicit ACP current-context usage value", () => {
    assert.equal(
      resolveContextUsage(100_000, {
        ...legacyUsage,
        modelContextWindow: null,
      }),
      null
    )
  })

  test("formats ACP cumulative cost with its currency", () => {
    const formatted = formatUsageCost({ amount: 1.2345, currency: "USD" })

    assert.match(formatted, /USD/)
    assert.match(formatted, /1[.,]2345/)
  })
})
