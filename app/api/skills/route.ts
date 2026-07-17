import { NextResponse } from "next/server"

import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import { marketplaceServiceListSkillMarket } from "@/lib/generated/astraflow-api"
import { toSkillMeta } from "@/lib/marketplace-mappers"
import { isSkillOrderBy } from "@/lib/skill-market"

export const runtime = "nodejs"

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

function readString(value: string | null) {
  return typeof value === "string" ? value.trim() : ""
}

function readInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.min(Math.max(parsed, 0), max)
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
    { ok: false, message: "Failed to load skills." },
    { status: 500 }
  )
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const keyword = readString(searchParams.get("keyword"))
    const category = readString(searchParams.get("category"))
    const requestedOrderBy = readString(searchParams.get("orderBy"))
    const orderBy = isSkillOrderBy(requestedOrderBy)
      ? requestedOrderBy
      : "recent"
    const offset = readInt(searchParams.get("offset"), 0, 100_000)
    const limit = readInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT)
    const result = await marketplaceServiceListSkillMarket({
      query: { keyword, category, orderBy, offset, limit },
    })
    const payload = unwrapAstraFlowApiResult(
      result,
      "Failed to load skills."
    )

    return NextResponse.json({
      ok: true,
      data: (payload.skills ?? []).map(toSkillMeta),
      totalCount: payload.totalCount ?? 0,
      allCategories: payload.allCategories ?? [],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
