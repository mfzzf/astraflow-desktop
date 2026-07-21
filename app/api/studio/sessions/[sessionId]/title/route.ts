import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import { speechServiceGenerateTitle } from "@/lib/generated/astraflow-api"
import { getStudioSession, updateStudioSessionTitle } from "@/lib/studio-db"
import {
  isRuntimePreambleSessionTitle,
  recoverSessionTitleFromUserPrompt,
} from "@/lib/studio-session-title"

export const runtime = "nodejs"

const TITLE_MAX_CHARACTERS = 24

const titleRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(8_000),
})

type RouteContext = {
  params: Promise<{ sessionId: string }>
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

  const parsed = titleRequestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const startedAt = Date.now()
  console.info("[session-title] request_started", {
    sessionId,
    promptLength: parsed.data.prompt.length,
  })

  try {
    const result = await speechServiceGenerateTitle({
      body: {
        transcript: parsed.data.prompt,
        maxCharacters: TITLE_MAX_CHARACTERS,
      },
    })
    const payload = unwrapAstraFlowApiResult(result, "Title generation failed.")
    const generatedTitle = (payload.title ?? "").trim()
    const recoveredFromPreamble = isRuntimePreambleSessionTitle(generatedTitle)
    const title = recoveredFromPreamble
      ? recoverSessionTitleFromUserPrompt(parsed.data.prompt)
      : generatedTitle

    if (!title) {
      console.error("[session-title] empty_title", {
        sessionId,
        elapsedMs: Date.now() - startedAt,
      })
      return NextResponse.json(
        { ok: false, error: "Empty title generated." },
        { status: 502 }
      )
    }

    const session = updateStudioSessionTitle(sessionId, title)

    console.info("[session-title] request_completed", {
      sessionId,
      elapsedMs: Date.now() - startedAt,
      recoveredFromPreamble,
      title,
      model: payload.model,
    })

    return NextResponse.json({ ok: true, data: session })
  } catch (error) {
    if (error instanceof AstraFlowApiError) {
      console.error("[session-title] request_failed", {
        sessionId,
        status: error.status,
        error: error.message,
        elapsedMs: Date.now() - startedAt,
      })
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status }
      )
    }

    console.error("[session-title] request_error", {
      sessionId,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Title generation failed.",
      },
      { status: 500 }
    )
  }
}
