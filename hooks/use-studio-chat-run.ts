"use client"

import * as React from "react"

import type { StudioChatRunLiveSnapshot } from "@/lib/studio-types"

// Let the renderer settle for roughly two display frames between commits. The
// server publishes at up to 20 fps, while this latest-wins queue naturally
// coalesces more aggressively if Markdown work keeps the main thread busy.
const STUDIO_STREAM_MIN_FLUSH_INTERVAL_MS = 32

type StudioSnapshotSchedulerClock = {
  now: () => number
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (handle: number) => void
  setTimer: (callback: () => void, delay: number) => number
  clearTimer: (handle: number) => void
}

function getBrowserSchedulerClock(): StudioSnapshotSchedulerClock {
  return {
    now: () => performance.now(),
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (handle) => window.clearTimeout(handle),
  }
}

export function createStudioSnapshotScheduler<T>(
  onFlush: (snapshot: T) => void,
  {
    clock = getBrowserSchedulerClock(),
    minIntervalMs = STUDIO_STREAM_MIN_FLUSH_INTERVAL_MS,
  }: {
    clock?: StudioSnapshotSchedulerClock
    minIntervalMs?: number
  } = {}
) {
  let disposed = false
  let pendingSnapshot: T | null = null
  let pendingFrame: number | null = null
  let cooldownFrame: number | null = null
  let cooldownTimer: number | null = null
  let coolingDown = false

  const cancelScheduledFlush = () => {
    if (pendingFrame !== null) {
      clock.cancelFrame(pendingFrame)
      pendingFrame = null
    }

    if (cooldownFrame !== null) {
      clock.cancelFrame(cooldownFrame)
      cooldownFrame = null
    }

    if (cooldownTimer !== null) {
      clock.clearTimer(cooldownTimer)
      cooldownTimer = null
    }
  }

  const releaseCooldown = () => {
    cooldownTimer = null
    coolingDown = false
    schedule()
  }

  const beginCooldown = () => {
    coolingDown = true
    cooldownFrame = clock.requestFrame(() => {
      cooldownFrame = null
      cooldownTimer = clock.setTimer(releaseCooldown, minIntervalMs)
    })
  }

  const flush = () => {
    pendingFrame = null
    if (disposed || pendingSnapshot === null) {
      return
    }

    const snapshot = pendingSnapshot
    pendingSnapshot = null
    onFlush(snapshot)
    beginCooldown()
  }

  const requestFrame = () => {
    if (disposed || pendingFrame !== null) {
      return
    }

    pendingFrame = clock.requestFrame(flush)
  }

  const schedule = () => {
    if (
      disposed ||
      pendingSnapshot === null ||
      pendingFrame !== null ||
      coolingDown
    ) {
      return
    }

    requestFrame()
  }

  return {
    push(snapshot: T, force = false) {
      if (disposed) {
        return
      }

      pendingSnapshot = snapshot

      if (force) {
        cancelScheduledFlush()
        coolingDown = false
        flush()
        return
      }

      schedule()
    },
    dispose() {
      disposed = true
      coolingDown = false
      pendingSnapshot = null
      cancelScheduledFlush()
    },
  }
}

function parseLiveSnapshot(event: MessageEvent<string>) {
  try {
    return JSON.parse(event.data) as StudioChatRunLiveSnapshot
  } catch {
    return null
  }
}

function useLatestRef<T>(value: T) {
  const ref = React.useRef(value)

  React.useEffect(() => {
    ref.current = value
  }, [value])

  return ref
}

export function useStudioChatRunLiveStream({
  enabled,
  onConnectionChange,
  onDone,
  onError,
  onSnapshot,
  sessionId,
}: {
  enabled: boolean
  onConnectionChange: (connected: boolean) => void
  onDone: () => void
  onError: () => void
  onSnapshot: (snapshot: StudioChatRunLiveSnapshot) => void
  sessionId: string
}) {
  const onConnectionChangeRef = useLatestRef(onConnectionChange)
  const onDoneRef = useLatestRef(onDone)
  const onErrorRef = useLatestRef(onError)
  const onSnapshotRef = useLatestRef(onSnapshot)

  React.useEffect(() => {
    if (!sessionId || !enabled) {
      return
    }

    if (typeof window === "undefined" || !("EventSource" in window)) {
      return
    }

    const source = new EventSource(
      `/api/studio/chat/events?sessionId=${encodeURIComponent(sessionId)}`
    )
    let closed = false
    const snapshotScheduler =
      createStudioSnapshotScheduler<StudioChatRunLiveSnapshot>((snapshot) =>
        onSnapshotRef.current(snapshot)
      )

    let close = () => {}

    const handleOpen = () => {
      if (!closed) {
        onConnectionChangeRef.current(true)
      }
    }

    const handleSnapshot = (event: Event) => {
      const snapshot = parseLiveSnapshot(event as MessageEvent<string>)

      if (snapshot) {
        snapshotScheduler.push(snapshot)
      }
    }

    const handleDone = (event: Event) => {
      const snapshot = parseLiveSnapshot(event as MessageEvent<string>)

      if (snapshot) {
        snapshotScheduler.push(snapshot, true)
      }

      close()
      onDoneRef.current()
    }

    const handleError = () => {
      onConnectionChangeRef.current(false)
      close()
      onErrorRef.current()
    }

    close = () => {
      if (closed) {
        return
      }

      closed = true
      source.removeEventListener("open", handleOpen)
      source.removeEventListener("snapshot", handleSnapshot)
      source.removeEventListener("done", handleDone)
      snapshotScheduler.dispose()
      source.close()
    }

    source.addEventListener("open", handleOpen)
    source.addEventListener("snapshot", handleSnapshot)
    source.addEventListener("done", handleDone)
    source.onerror = handleError

    const handleCleanupConnectionChange = onConnectionChangeRef.current

    return () => {
      handleCleanupConnectionChange(false)
      close()
    }
  }, [
    enabled,
    onConnectionChangeRef,
    onDoneRef,
    onErrorRef,
    onSnapshotRef,
    sessionId,
  ])
}
