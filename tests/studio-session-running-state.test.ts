// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { findFinishedStudioSessions } from "@/lib/studio-session-running-state"
import type { StudioSession } from "@/lib/studio-types"

function session(id: string, isRunning: boolean) {
  return { id, isRunning } as StudioSession
}

describe("Studio session running state", () => {
  test("finds only sessions that transitioned from running to stopped", () => {
    const previous = new Map([
      ["finished", true],
      ["running", true],
      ["idle", false],
    ])
    const sessions = [
      session("finished", false),
      session("running", true),
      session("idle", false),
      session("new", false),
    ]

    expect(findFinishedStudioSessions(previous, sessions)).toEqual([
      sessions[0],
    ])
  })
})
