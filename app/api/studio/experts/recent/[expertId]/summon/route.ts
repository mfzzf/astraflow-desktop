import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  createStudioSession,
  getStudioLatestSessionExpertByExpertId,
  upsertStudioSessionExpert,
} from "@/lib/studio-db"

export const runtime = "nodejs"

const EXPERT_SESSION_TITLE = "新建专家会话"

const summonSchema = z.object({
  prompt: z.string().trim().max(2000).optional(),
})

type RouteContext = {
  params: Promise<{ expertId: string }>
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

function readDraftPrompt({
  prompt,
  snapshot,
}: {
  prompt?: string
  snapshot: unknown
}) {
  const runtime = getRuntimeSnapshot(snapshot)
  const expert = asRecord(runtime.expert)

  return (
    prompt?.trim() ||
    readLocalized(expert.defaultInitPrompt ?? expert.default_init_prompt)
  )
}

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = summonSchema.safeParse(await request.json().catch(() => ({})))

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { expertId } = await context.params
  const sessionExpert = getStudioLatestSessionExpertByExpertId(
    decodeURIComponent(expertId)
  )

  if (!sessionExpert) {
    return NextResponse.json(
      { ok: false, message: "Local expert was not found." },
      { status: 404 }
    )
  }

  const draftPrompt = readDraftPrompt({
    prompt: parsed.data.prompt,
    snapshot: sessionExpert.snapshot,
  })
  const session = createStudioSession({
    mode: "chat",
    title: EXPERT_SESSION_TITLE,
  })

  upsertStudioSessionExpert({
    sessionId: session.id,
    expertId: sessionExpert.expertId,
    expertType: sessionExpert.expertType,
    runtimeHash: sessionExpert.runtimeHash,
    snapshot: sessionExpert.snapshot,
  })

  return NextResponse.json(
    {
      ok: true,
      data: {
        sessionId: session.id,
        sessionPath: `/studio/chat/${encodeURIComponent(session.id)}`,
        runtimeHash: sessionExpert.runtimeHash,
        draftPrompt,
      },
    },
    { status: 201 }
  )
}
