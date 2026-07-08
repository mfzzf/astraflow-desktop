import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  listStudioRecentSessionExperts,
  type StudioSessionExpert,
} from "@/lib/studio-db"

export const runtime = "nodejs"

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

function readLimit(request: Request) {
  const raw = new URL(request.url).searchParams.get("limit")
  const parsed = Number.parseInt(raw ?? "", 10)

  return Number.isFinite(parsed) ? parsed : 8
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  return NextResponse.json({
    ok: true,
    data: listStudioRecentSessionExperts(readLimit(request)).map(
      toSessionExpertPayload
    ),
  })
}
