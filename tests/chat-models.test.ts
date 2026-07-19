import assert from "node:assert/strict"
import { test } from "node:test"

import { getChatModelConfig } from "@/lib/chat-models"

test("uses Codex's effective GPT-5.6 Sol context window", () => {
  assert.equal(getChatModelConfig("gpt-5.6-sol").contextWindow, 258_400)
})
