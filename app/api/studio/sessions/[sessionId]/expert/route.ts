import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  deleteStudioSessionExpert,
  getStudioSession,
  getStudioSessionExpert,
  type StudioSessionExpert,
} from "@/lib/studio-db"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readLocalized(value: unknown) {
  const record = asRecord(value)
  return readString(record.zh) || readString(record.en) || readString(value)
}

function getRuntimeSnapshot(snapshot: unknown) {
  const record = asRecord(snapshot)
  return asRecord(record.runtime ?? snapshot)
}

function toSessionExpertPayload(sessionExpert: StudioSessionExpert) {
  const runtime = getRuntimeSnapshot(sessionExpert.snapshot)
  const expert = asRecord(runtime.expert)
  const displayName = readLocalized(
    expert.displayName ?? expert.display_name
  )
  const profession = readLocalized(expert.profession)
  const defaultInitPrompt = readLocalized(
    expert.defaultInitPrompt ?? expert.default_init_prompt
  )

  return {
    sessionId: sessionExpert.sessionId,
    expertId: sessionExpert.expertId,
    expertType: sessionExpert.expertType,
    runtimeHash: sessionExpert.runtimeHash,
    displayName: displayName || sessionExpert.expertId,
    profession,
    defaultInitPrompt,
    selectedAt: sessionExpert.selectedAt,
  }
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, message: "Session not found." },
      { status: 404 }
    )
  }

  const sessionExpert = getStudioSessionExpert(sessionId)

  return NextResponse.json({
    ok: true,
    data: sessionExpert ? toSessionExpertPayload(sessionExpert) : null,
  })
}

export async function DELETE(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, message: "Session not found." },
      { status: 404 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: { removed: deleteStudioSessionExpert(sessionId) },
  })
}
