import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AIMessage, HumanMessage } from "@langchain/core/messages"
import {
  ChatOpenAI,
  convertStandardContentMessageToResponsesInput,
} from "@langchain/openai"

import { CHAT_MODEL_OPTIONS } from "@/lib/chat-models"
import {
  createModelversePromptCacheKey,
  resolveModelversePromptCacheOptions,
} from "@/lib/modelverse-langchain"

describe("ModelVerse OpenAI Responses integration", () => {
  test("routes every built-in GPT model through the Responses API", () => {
    const gptModels = CHAT_MODEL_OPTIONS.filter(({ value }) =>
      value.startsWith("gpt-")
    )

    assert.ok(gptModels.length > 0)
    assert.ok(
      gptModels.every(({ protocol }) => protocol === "openai-responses")
    )
  })

  test("encodes replayed assistant text as output_text", () => {
    const assistantItems = convertStandardContentMessageToResponsesInput(
      new AIMessage({ contentBlocks: [{ type: "text", text: "hello" }] })
    )
    const userItems = convertStandardContentMessageToResponsesInput(
      new HumanMessage({ contentBlocks: [{ type: "text", text: "hello" }] })
    )

    assert.deepEqual(assistantItems, [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "hello", annotations: [] }],
      },
    ])
    assert.deepEqual(userItems, [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    ])
  })

  test("uses Responses request fields for function tools and reasoning", () => {
    const model = new ChatOpenAI({
      apiKey: "test",
      model: "gpt-5.6-sol",
      reasoning: { effort: "medium" },
      useResponsesApi: true,
      promptCacheKey: "astraflow:test",
      promptCacheRetention: "24h",
    })
    const params = model.invocationParams({
      tools: [
        {
          type: "function",
          function: {
            name: "lookup",
            description: "Look up a value",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        },
      ],
    })

    assert.ok("reasoning" in params)
    assert.deepEqual(params.reasoning, { effort: "medium" })
    assert.ok(!("reasoning_effort" in params))
    assert.equal(params.prompt_cache_key, "astraflow:test")
    assert.equal(params.prompt_cache_retention, "24h")
    assert.deepEqual(params.tools?.[0], {
      type: "function",
      name: "lookup",
      description: "Look up a value",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      strict: null,
    })
  })

  test("uses a stable, bounded session cache key for Responses routing", () => {
    const first = createModelversePromptCacheKey({
      model: "gpt-5.5",
      sessionId: "session-a",
    })
    const repeated = createModelversePromptCacheKey({
      model: "gpt-5.5",
      sessionId: "session-a",
    })
    const otherSession = createModelversePromptCacheKey({
      model: "gpt-5.5",
      sessionId: "session-b",
    })

    assert.equal(first, repeated)
    assert.notEqual(first, otherSession)
    assert.ok(first.length <= 64)
    assert.deepEqual(
      resolveModelversePromptCacheOptions("openai-responses", first),
      {
        promptCacheKey: first,
        promptCacheRetention: "24h",
      }
    )
    assert.deepEqual(
      resolveModelversePromptCacheOptions("openai-chat", first),
      {}
    )
    assert.deepEqual(
      resolveModelversePromptCacheOptions("anthropic-messages", first),
      {}
    )
  })
})
