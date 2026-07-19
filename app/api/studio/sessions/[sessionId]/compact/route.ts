import { randomUUID } from "node:crypto"

import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { compactCodexDirectThread } from "@/lib/agent/adapters/codex-direct-runtime"
import {
  getStudioSession,
  listStudioAgentProviderEvents,
  recordStudioModelUsageRun,
  updateStudioSessionLatestRunUsage,
} from "@/lib/studio-db"
import { compactStudioAstraFlowSession } from "@/lib/studio-chat-runner"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

function getString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

async function getCustomInstructions(request: Request) {
  try {
    const body = getRecord(await request.json())
    return getString(body?.instructions)?.slice(0, 4_000)
  } catch {
    return null
  }
}

function getLatestCodexThreadId(sessionId: string) {
  const events = listStudioAgentProviderEvents({
    sessionId,
    runtimeId: "codex-direct",
    limit: 5000,
  })

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    const payload = getRecord(event.payload)
    const threadId =
      getString(event.threadId) ??
      getString(event.providerSessionId) ??
      getString(payload?.sessionRef)

    if (threadId) {
      return threadId
    }
  }

  return null
}

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params

  const session = getStudioSession(sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  const runtimeId = session.chatRuntimeId ?? "astraflow"

  if (runtimeId === "astraflow") {
    try {
      const compaction = await compactStudioAstraFlowSession(
        sessionId,
        (await getCustomInstructions(request)) ?? undefined
      )

      return NextResponse.json({
        ok: true,
        data: { usage: null, compaction },
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to compact conversation context."

      return NextResponse.json(
        { ok: false, error: message },
        {
          status:
            /nothing to compact|session too small|already compacted/i.test(
              message
            )
              ? 409
              : 500,
        }
      )
    }
  }

  if (runtimeId !== "codex-direct") {
    return NextResponse.json(
      {
        ok: false,
        error: `${runtimeId} does not support manual compaction.`,
      },
      { status: 409 }
    )
  }

  const threadId = getLatestCodexThreadId(sessionId)

  if (!threadId) {
    return NextResponse.json(
      { ok: false, error: "No Codex thread is available to compact." },
      { status: 409 }
    )
  }

  try {
    const usage = await compactCodexDirectThread(threadId)

    if (usage) {
      updateStudioSessionLatestRunUsage(sessionId, usage)
      recordStudioModelUsageRun({
        runId: `compact:${randomUUID()}`,
        sessionId,
        model: session.chatModel ?? "unknown",
        runtimeId,
        usage,
        startedAt: new Date().toISOString(),
      })
    }

    return NextResponse.json({ ok: true, data: { usage } })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to compact conversation context.",
      },
      { status: 500 }
    )
  }
}
