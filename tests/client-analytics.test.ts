import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"

import {
  CLIENT_ANALYTICS_EVENT,
  trackClientAnalyticsEvent,
  type ClientAnalyticsEventInput,
} from "@/lib/client-analytics"

const originalWindow = Reflect.get(globalThis, "window")

afterEach(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window")
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    })
  }
})

describe("client analytics", () => {
  test("dispatches semantic Agent and session events to the provider", () => {
    const eventTarget = new EventTarget()
    let received: ClientAnalyticsEventInput | null = null
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: eventTarget,
    })
    eventTarget.addEventListener(CLIENT_ANALYTICS_EVENT, (event) => {
      received = (event as CustomEvent<ClientAnalyticsEventInput>).detail
    })

    trackClientAnalyticsEvent({
      eventId: "agent-run-1",
      eventName: "agent.run",
      eventType: "agent",
      targetId: "codex",
      targetLabel: "Codex",
    })

    assert.deepEqual(received, {
      eventId: "agent-run-1",
      eventName: "agent.run",
      eventType: "agent",
      targetId: "codex",
      targetLabel: "Codex",
    })
  })

  test("is a no-op during server rendering", () => {
    Reflect.deleteProperty(globalThis, "window")

    assert.doesNotThrow(() =>
      trackClientAnalyticsEvent({
        eventName: "studio.session.active",
        eventType: "session",
      })
    )
  })
})
