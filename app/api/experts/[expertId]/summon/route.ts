import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import { expertServiceGetExpertRuntime } from "@/lib/generated/astraflow-api"
import { createStudioSession, upsertStudioSessionExpert } from "@/lib/studio-db"

export const runtime = "nodejs"

const summonSchema = z.object({
  prompt: z.string().trim().max(2000).optional(),
})

const EXPERT_SESSION_TITLE = "新建专家会话"

type RouteContext = {
  params: Promise<{ expertId: string }>
}

function toExpertErrorResponse(error: unknown) {
  if (error instanceof AstraFlowApiError) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: error.status }
    )
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Failed to summon expert." },
    { status: 500 }
  )
}

function readLocalizedText(
  value: { zh?: string; en?: string } | undefined,
  fallback: string
) {
  return value?.zh?.trim() || value?.en?.trim() || fallback
}

function readDraftPrompt({
  fallback,
  prompt,
}: {
  fallback: { zh?: string; en?: string } | undefined
  prompt: string | undefined
}) {
  return prompt?.trim() || readLocalizedText(fallback, "")
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

  try {
    const payload = unwrapAstraFlowApiResult(
      await expertServiceGetExpertRuntime({
        path: { expertId },
      }),
      "Failed to load expert runtime."
    )
    const runtime = payload.runtime
    const summary = runtime?.expert
    const runtimeHash = summary?.runtimeHash?.trim()

    if (!runtime || !summary || !runtimeHash) {
      return NextResponse.json(
        { ok: false, message: "Expert runtime is not available." },
        { status: 409 }
      )
    }

    const draftPrompt = readDraftPrompt({
      fallback: summary.defaultInitPrompt,
      prompt: parsed.data.prompt,
    })
    const session = createStudioSession({
      mode: "chat",
      title: EXPERT_SESSION_TITLE,
    })

    upsertStudioSessionExpert({
      sessionId: session.id,
      expertId,
      expertType: summary.type || "agent",
      runtimeHash,
      snapshot: runtime,
    })

    return NextResponse.json(
      {
        ok: true,
        data: {
          sessionId: session.id,
          sessionPath: `/studio/chat/${encodeURIComponent(session.id)}`,
          runtimeHash,
          draftPrompt,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    return toExpertErrorResponse(error)
  }
}
