import { NextResponse } from "next/server"

import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import { marketplaceServiceGetSkillDetail } from "@/lib/generated/astraflow-api"
import { toSkillMeta } from "@/lib/marketplace-mappers"

export const runtime = "nodejs"

type SkillDetailRouteContext = {
  params: Promise<{ slug: string }>
}

function toErrorResponse(error: unknown) {
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
    { ok: false, message: "Failed to load skill detail." },
    { status: 500 }
  )
}

export async function GET(request: Request, context: SkillDetailRouteContext) {
  try {
    const { slug } = await context.params
    const normalizedSlug = slug.trim()
    if (!normalizedSlug) {
      return NextResponse.json(
        { ok: false, message: "Skill slug is required." },
        { status: 400 }
      )
    }
    const version = new URL(request.url).searchParams.get("version")?.trim()
    const result = await marketplaceServiceGetSkillDetail({
      path: { slug: normalizedSlug },
      query: { version },
    })
    const payload = unwrapAstraFlowApiResult(
      result,
      "Failed to load skill detail."
    )

    return NextResponse.json({
      ok: true,
      data: {
        skill: toSkillMeta(payload.skill ?? {}),
        skillMd: payload.skillMd ?? "",
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
