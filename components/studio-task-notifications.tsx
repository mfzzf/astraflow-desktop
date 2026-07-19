"use client"

import * as React from "react"

import { useI18n } from "@/components/i18n-provider"
import { useAppPreference } from "@/lib/app-preferences"
import { showDesktopNotification } from "@/lib/desktop-notifications"
import { STUDIO_SESSIONS_CHANGED_EVENT } from "@/lib/studio-session-events"
import type { StudioSession } from "@/lib/studio-types"

type SessionsResponse =
  | { ok: true; data: StudioSession[] }
  | { ok: false; error?: unknown }

function getSessionHref(session: StudioSession) {
  return `/studio/${session.mode}/${encodeURIComponent(session.id)}`
}

export function StudioTaskNotifications() {
  const { locale } = useI18n()
  const [enabled] = useAppPreference("desktopNotifications")
  const [sounds] = useAppPreference("notificationSounds")
  const previousRef = React.useRef<Map<string, boolean>>(new Map())
  const initializedRef = React.useRef(false)
  const refreshInFlightRef = React.useRef(false)
  const mountedRef = React.useRef(true)

  const notifyFinishedSession = React.useCallback(
    async (session: StudioSession) => {
      let status: "complete" | "error" | "cancelled" = "complete"

      try {
        const response = await fetch(
          `/api/studio/chat?sessionId=${encodeURIComponent(session.id)}`,
          { cache: "no-store" }
        )
        const payload = (await response.json()) as {
          ok?: boolean
          data?: { status?: string } | null
        }
        if (
          response.ok &&
          payload.ok &&
          (payload.data?.status === "error" ||
            payload.data?.status === "cancelled")
        ) {
          status = payload.data.status
        }
      } catch {
        // A completed session is still useful even if its run snapshot expired.
      }

      const title =
        locale === "zh"
          ? status === "error"
            ? "任务执行失败"
            : status === "cancelled"
              ? "任务已停止"
              : "任务已完成"
          : status === "error"
            ? "Task failed"
            : status === "cancelled"
              ? "Task stopped"
              : "Task completed"

      await showDesktopNotification({
        id: `task-finished:${session.id}`,
        title,
        body:
          session.title.trim() ||
          (locale === "zh" ? "未命名会话" : "Untitled conversation"),
        silent: !sounds,
        path: getSessionHref(session),
      })
    },
    [locale, sounds]
  )

  const refresh = React.useCallback(async () => {
    if (refreshInFlightRef.current) return
    refreshInFlightRef.current = true

    try {
      const response = await fetch("/api/studio/sessions", {
        cache: "no-store",
      })
      const payload = (await response.json()) as SessionsResponse

      if (!response.ok || !payload.ok || !mountedRef.current) return

      const previous = previousRef.current
      const next = new Map(
        payload.data.map((session) => [session.id, session.isRunning])
      )

      if (initializedRef.current && enabled) {
        for (const session of payload.data) {
          if (previous.get(session.id) !== true || session.isRunning) continue

          void notifyFinishedSession(session)
        }
      }

      previousRef.current = next
      initializedRef.current = true
    } catch {
      // Session loading already owns user-facing request errors.
    } finally {
      refreshInFlightRef.current = false
    }
  }, [enabled, notifyFinishedSession])

  React.useEffect(() => {
    mountedRef.current = true
    queueMicrotask(() => void refresh())

    const handleSessionsChanged = () => void refresh()
    const pollTimer = window.setInterval(() => void refresh(), 3000)
    window.addEventListener(
      STUDIO_SESSIONS_CHANGED_EVENT,
      handleSessionsChanged
    )

    return () => {
      mountedRef.current = false
      window.removeEventListener(
        STUDIO_SESSIONS_CHANGED_EVENT,
        handleSessionsChanged
      )
      window.clearInterval(pollTimer)
    }
  }, [refresh])

  return null
}
