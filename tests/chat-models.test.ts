import assert from "node:assert/strict"
import { test } from "node:test"

import { getChatModelContextWindow } from "@/lib/chat-models"

test("uses Codex subscription context windows for GPT-5.5 and GPT-5.6", () => {
  assert.equal(getChatModelContextWindow("gpt-5.5"), 258_400)
  assert.equal(getChatModelContextWindow("gpt-5.6-sol"), 258_400)
  assert.equal(getChatModelContextWindow("gpt-5.6-terra"), 258_400)
  assert.equal(getChatModelContextWindow("gpt-5.6-luna"), 258_400)
})

test("keeps Claude model context windows distinct across ACP and OpenCode", () => {
  assert.equal(
    getChatModelContextWindow("claude-haiku-4-5-20251001"),
    200_000
  )
  assert.equal(
    getChatModelContextWindow("claude-sonnet-4-6"),
    1_000_000
  )
  assert.equal(
    getChatModelContextWindow("claude-opus-4-8"),
    1_000_000
  )
  assert.equal(
    getChatModelContextWindow("claude-fable-5"),
    1_000_000
  )
})
