"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

const DRAIN_WINDOW_SECONDS = 0.16
const MAX_CHARS_PER_SECOND = 2_000
const VELOCITY_LERP = 0.15
const MAX_FRAME_SECONDS = 0.05
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function subscribeToReducedMotion(onStoreChange: () => void) {
  const media = window.matchMedia(REDUCED_MOTION_QUERY)
  media.addEventListener("change", onStoreChange)

  return () => media.removeEventListener("change", onStoreChange)
}

function getReducedMotionSnapshot() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

function getServerReducedMotionSnapshot() {
  return false
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    getServerReducedMotionSnapshot
  )
}

export function isSynaraAppendOnlyStreamUpdate(
  previousText: string,
  nextText: string
) {
  return (
    nextText.length >= previousText.length && nextText.startsWith(previousText)
  )
}

export function getSynaraStreamTargetVelocity(backlog: number) {
  return Math.min(
    MAX_CHARS_PER_SECOND,
    Math.max(0, backlog) / DRAIN_WINDOW_SECONDS
  )
}

export function smoothSynaraStreamVelocity(
  currentVelocity: number,
  backlog: number
) {
  const targetVelocity = getSynaraStreamTargetVelocity(backlog)

  return currentVelocity + (targetVelocity - currentVelocity) * VELOCITY_LERP
}

export function selectSynaraMarkdownText({
  normalizedText,
  deferredText,
  streaming,
}: {
  normalizedText: string
  deferredText: string
  streaming: boolean
}) {
  return streaming ? deferredText : normalizedText
}

/**
 * Synara's streamed-text cadence: reveal already-delivered text on rAF at an
 * adaptive velocity, sleep when caught up, and snap to the exact provider text
 * when streaming ends, motion is reduced, or a snapshot is not append-only.
 */
export function useSmoothStreamedText(text: string, isStreaming: boolean) {
  const reduceMotion = usePrefersReducedMotion()
  const animate = isStreaming && !reduceMotion
  const [revealed, setRevealed] = useState(text)
  const targetRef = useRef(text)
  const shownRef = useRef(text.length)
  const emittedRef = useRef(text.length)
  const velocityRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const tickRef = useRef<(now: number) => void>(() => undefined)
  const lastFrameRef = useRef(0)

  const cancelFrame = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const scheduleFrame = useCallback(() => {
    if (rafRef.current !== null) return

    rafRef.current = requestAnimationFrame((now) => {
      rafRef.current = null
      tickRef.current(now)
    })
  }, [])

  useEffect(() => {
    tickRef.current = (now: number) => {
      const previousFrame = lastFrameRef.current
      const frameSeconds = previousFrame
        ? Math.min((now - previousFrame) / 1_000, MAX_FRAME_SECONDS)
        : 0
      lastFrameRef.current = now
      const target = targetRef.current
      const targetLength = target.length

      if (shownRef.current > targetLength) shownRef.current = targetLength

      const backlog = targetLength - shownRef.current

      if (backlog <= 0) {
        velocityRef.current = 0
        lastFrameRef.current = 0
        return
      }

      velocityRef.current = smoothSynaraStreamVelocity(
        velocityRef.current,
        backlog
      )
      shownRef.current = Math.min(
        targetLength,
        shownRef.current + velocityRef.current * frameSeconds
      )

      const nextCount = Math.floor(shownRef.current)

      if (nextCount !== emittedRef.current) {
        emittedRef.current = nextCount
        setRevealed(
          nextCount >= targetLength ? target : target.slice(0, nextCount)
        )
      }

      if (targetLength - shownRef.current > 0) {
        scheduleFrame()
      } else {
        velocityRef.current = 0
        lastFrameRef.current = 0
      }
    }

    return () => {
      tickRef.current = () => undefined
    }
  }, [scheduleFrame])

  useEffect(() => {
    let active = true
    const previousTarget = targetRef.current
    const appendOnly = isSynaraAppendOnlyStreamUpdate(previousTarget, text)
    targetRef.current = text

    if (!animate || !appendOnly) {
      cancelFrame()
      shownRef.current = text.length
      emittedRef.current = text.length
      velocityRef.current = 0
      lastFrameRef.current = 0

      queueMicrotask(() => {
        if (active) setRevealed(text)
      })

      return () => {
        active = false
      }
    }

    if (text.length > shownRef.current) scheduleFrame()

    return () => {
      active = false
    }
  }, [animate, cancelFrame, scheduleFrame, text])

  useEffect(() => cancelFrame, [cancelFrame])

  return animate ? revealed : text
}
