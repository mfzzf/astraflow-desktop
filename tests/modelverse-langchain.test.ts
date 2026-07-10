import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AIMessage, HumanMessage } from "@langchain/core/messages"
import {
  ChatOpenAI,
  convertStandardContentMessageToResponsesInput,
} from "@langchain/openai"

import { CHAT_MODEL_OPTIONS } from "@/lib/chat-models"

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
        content: [
          { type: "output_text", text: "hello", annotations: [] },
        ],
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
})
