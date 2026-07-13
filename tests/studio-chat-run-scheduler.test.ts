// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, it } from "bun:test"

import { createStudioSnapshotScheduler } from "@/hooks/use-studio-chat-run"

function createManualClock() {
  let now = 0
  let nextHandle = 1
  const frames = new Map<number, FrameRequestCallback>()
  const timers = new Map<number, { callback: () => void; dueAt: number }>()

  return {
    clock: {
      now: () => now,
      requestFrame(callback: FrameRequestCallback) {
        const handle = nextHandle++
        frames.set(handle, callback)
        return handle
      },
      cancelFrame(handle: number) {
        frames.delete(handle)
      },
      setTimer(callback: () => void, delay: number) {
        const handle = nextHandle++
        timers.set(handle, { callback, dueAt: now + delay })
        return handle
      },
      clearTimer(handle: number) {
        timers.delete(handle)
      },
    },
    advance(milliseconds: number) {
      now += milliseconds

      for (const [handle, timer] of timers) {
        if (timer.dueAt <= now) {
          timers.delete(handle)
          timer.callback()
        }
      }
    },
    flushFrame() {
      const pending = Array.from(frames.entries())
      frames.clear()

      for (const [, callback] of pending) {
        callback(now)
      }
    },
  }
}

describe("studio snapshot scheduler", () => {
  it("keeps the latest snapshot and limits normal flush frequency", () => {
    const manual = createManualClock()
    const flushed: number[] = []
    const scheduler = createStudioSnapshotScheduler(
      (snapshot: number) => flushed.push(snapshot),
      { clock: manual.clock, minIntervalMs: 32 }
    )

    scheduler.push(1)
    scheduler.push(2)
    manual.flushFrame()
    expect(flushed).toEqual([2])

    manual.advance(10)
    scheduler.push(3)
    manual.flushFrame()
    expect(flushed).toEqual([2])

    manual.advance(32)
    manual.flushFrame()
    expect(flushed).toEqual([2, 3])
  })

  it("flushes completion snapshots immediately", () => {
    const manual = createManualClock()
    const flushed: string[] = []
    const scheduler = createStudioSnapshotScheduler(
      (snapshot: string) => flushed.push(snapshot),
      { clock: manual.clock, minIntervalMs: 32 }
    )

    scheduler.push("streaming")
    scheduler.push("complete", true)
    manual.flushFrame()

    expect(flushed).toEqual(["complete"])
  })
})
