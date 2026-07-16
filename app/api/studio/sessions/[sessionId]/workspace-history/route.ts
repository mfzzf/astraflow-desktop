import { NextResponse } from "next/server"
import { z } from "zod"

import { getAgentRun } from "@/lib/agent/run-orchestrator"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getStudioSession } from "@/lib/studio-db"
import { withStudioSessionLock } from "@/lib/studio-session-lock"
import {
  executeStudioWorkspaceHistoryAction,
  getStudioWorkspaceHistoryState,
} from "@/lib/studio-workspace-history"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

const actionSchema = z.object({
  action: z.enum(["undo", "redo", "checkpoint", "rewind"]),
  assistantMessageId: z.string().trim().min(1).optional(),
})

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: getStudioWorkspaceHistoryState(sessionId),
  })
}

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  const parsed = actionSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const run = getAgentRun(sessionId)

  if (run?.status === "queued" || run?.status === "running") {
    return NextResponse.json(
      { ok: false, error: "Stop the active Agent run before rewinding." },
      { status: 409 }
    )
  }

  try {
    const data = await withStudioSessionLock(sessionId, async () => {
      const currentRun = getAgentRun(sessionId)
      const currentSession = getStudioSession(sessionId)

      if (
        currentSession?.isRunning ||
        currentRun?.status === "queued" ||
        currentRun?.status === "running"
      ) {
        throw new Error("Stop the active Agent run before rewinding.")
      }

      return executeStudioWorkspaceHistoryAction({
        action: parsed.data.action,
        assistantMessageId: parsed.data.assistantMessageId,
        sessionId,
      })
    })

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to restore workspace history.",
      },
      { status: 409 }
    )
  }
}
