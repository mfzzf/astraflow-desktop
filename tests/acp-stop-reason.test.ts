import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { getAcpStopReasonErrorMessage } from "@/lib/agent/acp/stop-reason"

describe("ACP stop reasons", () => {
  test("surfaces provider limits and unexpected cancellation", () => {
    assert.match(
      getAcpStopReasonErrorMessage({
        displayName: "AstraFlow Agent",
        signalAborted: false,
        stopReason: "max_tokens",
      }) || "",
      /output limit/
    )
    assert.match(
      getAcpStopReasonErrorMessage({
        displayName: "AstraFlow Agent",
        signalAborted: false,
        stopReason: "cancelled",
      }) || "",
      /stopped unexpectedly/
    )
  })

  test("keeps explicit user cancellation non-erroring", () => {
    assert.equal(
      getAcpStopReasonErrorMessage({
        displayName: "AstraFlow Agent",
        signalAborted: true,
        stopReason: "cancelled",
      }),
      null
    )
    assert.equal(
      getAcpStopReasonErrorMessage({
        displayName: "AstraFlow Agent",
        signalAborted: false,
        stopReason: "end_turn",
      }),
      null
    )
  })
})
