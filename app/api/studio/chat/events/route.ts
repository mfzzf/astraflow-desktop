import { NextResponse } from "next/server"

import { getAppAuthState } from "@/lib/app-auth"
import { getStudioSession } from "@/lib/studio-db"
import {
  getStudioChatRunLiveSnapshot,
  subscribeStudioChatRun,
} from "@/lib/studio-chat-runner"
import type { StudioChatRunLiveSnapshot } from "@/lib/studio-types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isTerminalSnapshot(snapshot: StudioChatRunLiveSnapshot) {
  return (
    snapshot.status === "complete" ||
    snapshot.status === "error" ||
    snapshot.status === "cancelled"
  )
}

function encodeSseEvent(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

async function requireAuthenticatedRequest() {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  return null
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim()

  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "sessionId is required." },
      { status: 400 }
    )
  }

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let closeTimer: ReturnType<typeof setTimeout> | null = null
  let abortHandler: (() => void) | null = null
  let closed = false

  const cleanup = () => {
    unsubscribe?.()
    unsubscribe = null

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }

    if (closeTimer) {
      clearTimeout(closeTimer)
      closeTimer = null
    }

    if (abortHandler) {
      request.signal.removeEventListener("abort", abortHandler)
      abortHandler = null
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) {
          return
        }

        closed = true
        cleanup()

        try {
          controller.close()
        } catch {
          // The browser may already have closed the EventSource.
        }
      }

      const enqueue = (chunk: string) => {
        if (closed) {
          return
        }

        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          close()
        }
      }

      const sendSnapshot = (snapshot: StudioChatRunLiveSnapshot) => {
        const event = isTerminalSnapshot(snapshot) ? "done" : "snapshot"
        enqueue(encodeSseEvent(event, snapshot))

        if (event === "done") {
          closeTimer = setTimeout(close, 250)
        }
      }

      const currentSnapshot = getStudioChatRunLiveSnapshot(sessionId)

      if (currentSnapshot) {
        sendSnapshot(currentSnapshot)
      } else {
        enqueue(encodeSseEvent("idle", { sessionId }))
      }

      unsubscribe = subscribeStudioChatRun(sessionId, sendSnapshot)
      heartbeatTimer = setInterval(() => {
        enqueue(": keep-alive\n\n")
      }, 15_000)
      abortHandler = close
      request.signal.addEventListener("abort", abortHandler, { once: true })
    },
    cancel() {
      closed = true
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  })
}
