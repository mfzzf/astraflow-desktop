"use client"

import * as React from "react"

const ANALYTICS_ENDPOINT = "/api/analytics/events"
const BATCH_SIZE = 20
const MAX_QUEUE_SIZE = 200
const FLUSH_INTERVAL_MS = 5_000
const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "summary",
  "input[type='button']",
  "input[type='submit']",
  "input[type='reset']",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='option']",
  "[data-analytics-event]",
].join(",")

type ClickAnalyticsEvent = {
  eventId: string
  sessionId: string
  anonymousId: string
  eventName: string
  eventType: "click"
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

function eventSlug(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 96)
}

function findTrackedElement(event: MouseEvent) {
  const path = event.composedPath()
  const elements = path.filter(
    (item): item is Element => item instanceof Element
  )
  return (
    elements.find((item) => item.matches(INTERACTIVE_SELECTOR)) ?? elements[0]
  )
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

  if (element.matches(INTERACTIVE_SELECTOR)) {
    return normalizeText(element.textContent, 240)
  }
  return ""
}

function getSafeLinkName(element: Element) {
  if (!(element instanceof HTMLAnchorElement) || !element.href) return ""
  try {
    const url = new URL(element.href, window.location.href)
    return url.origin === window.location.origin
      ? eventSlug(url.pathname) || "home"
      : "external"
  } catch {
    return ""
  }
}

function getEventName(element: Element, targetType: string, label: string) {
  const explicit = normalizeText(
    element.getAttribute("data-analytics-event"),
    160
  )
  if (explicit) return explicit

  const identifier = eventSlug(element.id)
  if (identifier) return `click.${identifier}`

  const linkName = getSafeLinkName(element)
  if (linkName) return `click.link.${linkName}`

  const labelName = eventSlug(label)
  if (labelName) return `click.${targetType}.${labelName}`.slice(0, 160)

  return `click.${targetType}`.slice(0, 160)
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    let queue: ClickAnalyticsEvent[] = []
    let sending = false
    let disposed = false
    const anonymousId = getOrCreateStorageId(
      "local",
      "astraflow.analytics.anonymous-id"
    )
    const sessionId = getOrCreateStorageId(
      "session",
      "astraflow.analytics.session-id"
    )

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
      const targetType = getTargetType(element)
      const targetLabel = getTargetLabel(element)
      queue.push({
        eventId: crypto.randomUUID(),
        sessionId,
        anonymousId,
        eventName: getEventName(element, targetType, targetLabel),
        eventType: "click",
        path: window.location.pathname.slice(0, 512) || "/",
        targetType,
        targetId: normalizeText(element.id, 160),
        targetLabel,
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
      if (document.visibilityState === "hidden") flushBeforeUnload()
    }

    document.addEventListener("click", handleClick, true)
    window.addEventListener("pagehide", flushBeforeUnload)
    document.addEventListener("visibilitychange", handleVisibilityChange)
    const timer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS)

    return () => {
      disposed = true
      document.removeEventListener("click", handleClick, true)
      window.removeEventListener("pagehide", flushBeforeUnload)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.clearInterval(timer)
    }
  }, [])

  return children
}
