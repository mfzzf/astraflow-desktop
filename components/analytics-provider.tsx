"use client"

import * as React from "react"

import {
  CLIENT_ANALYTICS_EVENT,
  type ClientAnalyticsEventInput,
} from "@/lib/client-analytics"

const ANALYTICS_ENDPOINT = "/api/analytics/events"
const BATCH_SIZE = 20
const MAX_QUEUE_SIZE = 2_000
const FLUSH_INTERVAL_MS = 5_000
const TRACKED_ELEMENT_SELECTOR = "[data-analytics-event]"

type AnalyticsEventType = "active" | "agent" | "click" | "session"

type ClientAnalyticsEvent = {
  eventId: string
  sessionId: string
  anonymousId: string
  eventName: string
  eventType: AnalyticsEventType
  path: string
  targetType: string
  targetId: string
  targetLabel: string
  platform: string
  locale: string
  screenWidth: number
  screenHeight: number
  occurredAt: string
}

function getOrCreateStorageId(kind: "local" | "session", key: string) {
  try {
    const storage =
      kind === "local" ? window.localStorage : window.sessionStorage
    const current = storage.getItem(key)
    if (current) return current
    const next = crypto.randomUUID()
    storage.setItem(key, next)
    return next
  } catch {
    return crypto.randomUUID()
  }
}

function normalizeText(value: string | null | undefined, maxLength: number) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength)
}

function findTrackedElement(event: MouseEvent) {
  const path = event.composedPath()
  const elements = path.filter(
    (item): item is Element => item instanceof Element
  )
  return elements.find((item) => item.matches(TRACKED_ELEMENT_SELECTOR))
}

function getTargetType(element: Element) {
  return normalizeText(
    element.getAttribute("role") || element.tagName.toLocaleLowerCase(),
    64
  )
}

function getTargetLabel(element: Element) {
  const explicit =
    element.getAttribute("data-analytics-label") ||
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.getAttribute("alt")
  if (explicit) return normalizeText(explicit, 240)

  if (element.matches(TRACKED_ELEMENT_SELECTOR)) {
    return normalizeText(element.textContent, 240)
  }
  return ""
}

function getEventName(element: Element) {
  return normalizeText(element.getAttribute("data-analytics-event"), 160)
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    let queue: ClientAnalyticsEvent[] = []
    let sending = false
    let disposed = false
    let activeDate = ""
    const anonymousId = getOrCreateStorageId(
      "local",
      "astraflow.analytics.anonymous-id"
    )
    const sessionId = getOrCreateStorageId(
      "session",
      "astraflow.analytics.session-id"
    )

    function enqueue(
      input: Pick<
        ClientAnalyticsEvent,
        "eventName" | "eventType" | "targetId" | "targetLabel" | "targetType"
      > & { eventId?: string }
    ) {
      const eventName = normalizeText(input.eventName, 160)
      if (!eventName) return

      queue.push({
        eventId: normalizeText(input.eventId, 120) || crypto.randomUUID(),
        sessionId,
        anonymousId,
        eventName,
        eventType: input.eventType,
        path: window.location.pathname.slice(0, 512) || "/",
        targetType: normalizeText(input.targetType, 64),
        targetId: normalizeText(input.targetId, 160),
        targetLabel: normalizeText(input.targetLabel, 240),
        platform: normalizeText(
          document.documentElement.dataset.astraflowPlatform ||
            navigator.platform,
          64
        ),
        locale: normalizeText(
          document.documentElement.lang || navigator.language,
          32
        ),
        screenWidth: Math.max(0, Math.round(window.innerWidth)),
        screenHeight: Math.max(0, Math.round(window.innerHeight)),
        occurredAt: new Date().toISOString(),
      })
      if (queue.length > MAX_QUEUE_SIZE) queue.shift()
      if (queue.length >= BATCH_SIZE) void flush()
    }

    function enqueueDailyActive() {
      const today = new Date().toISOString().slice(0, 10)
      if (activeDate === today) return
      activeDate = today
      enqueue({
        eventName: "app.active",
        eventType: "active",
        targetType: "application",
        targetId: "",
        targetLabel: "AstraFlow Desktop",
      })
    }

    async function flush() {
      if (sending || queue.length === 0 || disposed) return
      sending = true
      const events = queue.splice(0, BATCH_SIZE)
      try {
        const response = await fetch(ANALYTICS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events }),
          keepalive: true,
        })
        if (!response.ok && response.status >= 500) {
          queue = [...events, ...queue].slice(0, MAX_QUEUE_SIZE)
        }
      } catch {
        queue = [...events, ...queue].slice(0, MAX_QUEUE_SIZE)
      } finally {
        sending = false
        if (queue.length >= BATCH_SIZE) void flush()
      }
    }

    function handleClick(event: MouseEvent) {
      if (!event.isTrusted) return
      const element = findTrackedElement(event)
      if (!element) return
      const eventName = getEventName(element)
      if (!eventName) return
      const targetType = getTargetType(element)
      const targetLabel = getTargetLabel(element)
      enqueue({
        eventName,
        eventType: "click",
        targetType,
        targetId:
          element.getAttribute("data-analytics-target-id") || element.id,
        targetLabel,
      })
    }

    function handleSemanticEvent(event: Event) {
      const detail = (event as CustomEvent<ClientAnalyticsEventInput>).detail
      if (!detail) return
      enqueue({
        eventId: detail.eventId,
        eventName: detail.eventName,
        eventType: detail.eventType,
        targetType: detail.eventType,
        targetId: detail.targetId ?? "",
        targetLabel: detail.targetLabel ?? "",
      })
    }

    function flushBeforeUnload() {
      if (queue.length === 0) return
      const events = queue.splice(0, Math.min(queue.length, 100))
      const payload = new Blob([JSON.stringify({ events })], {
        type: "application/json",
      })
      if (!navigator.sendBeacon(ANALYTICS_ENDPOINT, payload)) {
        queue = [...events, ...queue].slice(0, MAX_QUEUE_SIZE)
        void flush()
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        flushBeforeUnload()
      } else {
        enqueueDailyActive()
      }
    }

    enqueueDailyActive()
    document.addEventListener("click", handleClick, true)
    window.addEventListener(CLIENT_ANALYTICS_EVENT, handleSemanticEvent)
    window.addEventListener("pagehide", flushBeforeUnload)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    const timer = window.setInterval(() => {
      enqueueDailyActive()
      void flush()
    }, FLUSH_INTERVAL_MS)

    return () => {
      disposed = true
      document.removeEventListener("click", handleClick, true)
      window.removeEventListener(CLIENT_ANALYTICS_EVENT, handleSemanticEvent)
      window.removeEventListener("pagehide", flushBeforeUnload)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.clearInterval(timer)
    }
  }, [])

  return children
}
