import { NextResponse } from "next/server"

import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import { marketplaceServiceListMcpMarket } from "@/lib/generated/astraflow-api"
import { toMcpRegistryServer } from "@/lib/marketplace-mappers"

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
    { ok: false, message: "Failed to load MCP market." },
    { status: 500 }
  )
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const keyword = readString(searchParams.get("keyword"))
    const offset = readInt(searchParams.get("cursor"), 0, 100_000)
    const limit = readInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT)
    const result = await marketplaceServiceListMcpMarket({
      query: {
        keyword,
        orderBy: "recent",
        offset,
        limit,
      },
    })
    const payload = unwrapAstraFlowApiResult(
      result,
      "Failed to load MCP market."
    )
    const rawMcps = payload.mcps ?? []
    const data = rawMcps
      .map(toMcpRegistryServer)
      .filter((item) => item !== null)
    const totalCount = payload.totalCount ?? 0
    const nextOffset = offset + rawMcps.length

    return NextResponse.json({
      ok: true,
      data,
      totalCount,
      nextCursor:
        rawMcps.length > 0 && nextOffset < totalCount
          ? String(nextOffset)
          : null,
      allRegistryTypes: payload.allRegistryTypes ?? [],
      allTransports: payload.allTransports ?? [],
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
