import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { AstraFlowExpertsApiError, getExpert } from "@/lib/experts-api"
import {
  getStudioExpertDetailCache,
  upsertStudioExpertDetailCache,
} from "@/lib/studio-db"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ expertId: string }>
}

function toExpertErrorResponse(error: unknown) {
  if (error instanceof AstraFlowExpertsApiError) {
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
    { ok: false, message: "Failed to load expert." },
    { status: 500 }
  )
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { expertId } = await context.params

  try {
    const searchParams = new URL(request.url).searchParams
    const locale = searchParams.get("locale") === "en" ? "en" : "zh"
    const payload = await getExpert(expertId, { locale })
    const expert = payload.expert

    if (!expert) {
      return NextResponse.json(
        { ok: false, message: "Expert not found." },
        { status: 404 }
      )
    }

    const runtimeHash = expert.summary?.runtimeHash
    if (runtimeHash) {
      upsertStudioExpertDetailCache({
        expertId,
        runtimeHash,
        detail: expert,
        updatedAt: expert.summary?.updatedAt ?? new Date().toISOString(),
      })
    }

    return NextResponse.json({ ok: true, data: { expert } })
  } catch (error) {
    const cached = getStudioExpertDetailCache(expertId)

    if (cached) {
      return NextResponse.json({
        ok: true,
        data: { expert: cached.detail, cached: true },
      })
    }

    return toExpertErrorResponse(error)
  }
}
