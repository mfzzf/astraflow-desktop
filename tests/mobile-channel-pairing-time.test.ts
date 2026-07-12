import assert from "node:assert/strict"
import test from "node:test"

import { calculateServerRemainingSeconds } from "../lib/mobile-channels/pairing-time"

test("pairing countdown follows server time when the browser clock is fast", () => {
  assert.equal(
    calculateServerRemainingSeconds({
      serverTime: "2026-07-12T10:00:00.000Z",
      expiresAt: "2026-07-12T10:05:00.000Z",
      clientReceivedAtMs: Date.parse("2026-07-12T10:10:00.000Z"),
      clientNowMs: Date.parse("2026-07-12T10:10:05.000Z"),
    }),
    295
  )
})

test("pairing countdown follows server time when the browser clock is slow", () => {
  assert.equal(
    calculateServerRemainingSeconds({
      serverTime: "2026-07-12T10:00:00.000Z",
      expiresAt: "2026-07-12T10:05:00.000Z",
      clientReceivedAtMs: Date.parse("2026-07-12T09:50:00.000Z"),
      clientNowMs: Date.parse("2026-07-12T09:50:05.000Z"),
    }),
    295
  )
})

test("pairing countdown stops at zero and rejects invalid timestamps", () => {
  assert.equal(
    calculateServerRemainingSeconds({
      serverTime: "2026-07-12T10:00:00.000Z",
      expiresAt: "2026-07-12T10:00:01.000Z",
      clientReceivedAtMs: 1_000,
      clientNowMs: 3_000,
    }),
    0
  )
  assert.equal(
    calculateServerRemainingSeconds({
      serverTime: "invalid",
      expiresAt: "invalid",
      clientReceivedAtMs: 1_000,
      clientNowMs: 2_000,
    }),
    null
  )
})
