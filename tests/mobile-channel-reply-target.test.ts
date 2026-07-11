import assert from "node:assert/strict"
import test from "node:test"

import {
  refreshActiveMobileRunTarget,
  registerActiveMobileRunTarget,
} from "@/lib/mobile-channels/reply-target"
import type { MobileChannelOutboundTarget } from "@/lib/mobile-channels/types"

function wechatTarget(contextToken: string): MobileChannelOutboundTarget {
  return {
    connectionId: "connection-1",
    provider: "wechat",
    externalUserId: "user-1",
    conversationId: "conversation-1",
    replyContext: { provider: "wechat", contextToken },
  }
}

test("active mobile runs use the newest inbound reply context", () => {
  const active = registerActiveMobileRunTarget(
    "session-reply-refresh",
    wechatTarget("task-context"),
    "run-1"
  )

  assert.equal(
    refreshActiveMobileRunTarget(
      "session-reply-refresh",
      wechatTarget("approval-context")
    ),
    true
  )
  assert.deepEqual(active.current().replyContext, {
    provider: "wechat",
    contextToken: "approval-context",
  })
  assert.equal(active.current().runId, "run-1")

  active.release()
  assert.equal(
    refreshActiveMobileRunTarget(
      "session-reply-refresh",
      wechatTarget("late-context")
    ),
    false
  )
})
