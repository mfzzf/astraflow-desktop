import assert from "node:assert/strict"
import test from "node:test"

import {
  mergeMobileChannelOutboxTarget,
  mobileChannelOutboxRetryDelayMs,
  storedMobileChannelOutboxTarget,
} from "../lib/mobile-channels/outbox"
import type { MobileChannelOutboundTarget } from "../lib/mobile-channels/types"

function telegramTarget(messageId: number): MobileChannelOutboundTarget {
  return {
    connectionId: "connection-1",
    provider: "telegram",
    externalUserId: "user-1",
    conversationId: "chat-1",
    replyContext: {
      provider: "telegram",
      messageId,
      messageThreadId: null,
    },
    runId: "run-1",
    durable: true,
  }
}

test("mobile channel outbox strips runtime flags and keeps fresh reply context", () => {
  const stored = storedMobileChannelOutboxTarget(telegramTarget(1))
  const refreshed = mergeMobileChannelOutboxTarget(
    stored,
    telegramTarget(2)
  )

  assert.equal("durable" in stored, false)
  assert.equal("durable" in refreshed, false)
  assert.equal(refreshed.runId, "run-1")
  assert.deepEqual(refreshed.replyContext, {
    provider: "telegram",
    messageId: 2,
    messageThreadId: null,
  })
})

test("mobile channel outbox retry delay uses bounded exponential backoff", () => {
  assert.equal(mobileChannelOutboxRetryDelayMs(1), 2_000)
  assert.equal(mobileChannelOutboxRetryDelayMs(5), 32_000)
  assert.equal(mobileChannelOutboxRetryDelayMs(100), 300_000)
})
