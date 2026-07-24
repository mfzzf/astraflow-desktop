import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import {
  expertServiceListExpertCategories,
  expertServiceListExperts,
} from "@/lib/generated/astraflow-api"
import {
  getStudioExpertCatalogCache,
  upsertStudioExpertCatalogCache,
} from "@/lib/studio-db"

export const runtime = "nodejs"

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 50

function readString(value: string | null) {
  return typeof value === "string" ? value.trim() : ""
}

function readPageSize(value: string | null) {
  const parsed = Number.parseInt(value ?? "", 10)

  if (!Number.isFinite(parsed)) {
    return DEFAULT_PAGE_SIZE
  }

  return Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE)
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
    { ok: false, message: "Failed to load experts." },
    { status: 500 }
  )
}

function buildCatalogCacheKey(request: Request) {
  const searchParams = new URL(request.url).searchParams
  const stable = new URLSearchParams()

  for (const key of [
    "pageSize",
    "pageToken",
    "categoryId",
    "type",
    "query",
    "locale",
  ]) {
    const value = readString(searchParams.get(key))
    if (value) {
      stable.set(key, value)
    }
  }

  return stable.toString() || "default"
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const cacheKey = buildCatalogCacheKey(request)

  try {
    const searchParams = new URL(request.url).searchParams
    const locale = readString(searchParams.get("locale")) === "en" ? "en" : "zh"
    const [expertsResult, categoriesResult] = await Promise.all([
      expertServiceListExperts({
        query: {
          pageSize: readPageSize(searchParams.get("pageSize")),
          pageToken: readString(searchParams.get("pageToken")),
          categoryId: readString(searchParams.get("categoryId")),
          type: readString(searchParams.get("type")),
          query: readString(searchParams.get("query")),
          locale,
        },
      }),
      expertServiceListExpertCategories({
        query: { locale },
      }),
    ])
    const expertsPayload = unwrapAstraFlowApiResult(
      expertsResult,
      "Failed to load experts."
    )
    const categoriesPayload = unwrapAstraFlowApiResult(
      categoriesResult,
      "Failed to load expert categories."
    )
    const data = {
      experts: expertsPayload.experts ?? [],
      categories: categoriesPayload.categories ?? [],
      totalSize: expertsPayload.totalSize ?? 0,
      nextPageToken: expertsPayload.nextPageToken ?? "",
      catalogVersion:
        expertsPayload.catalogVersion ?? categoriesPayload.catalogVersion ?? "",
      catalogHash:
        expertsPayload.catalogHash ?? categoriesPayload.catalogHash ?? "",
      updatedAt: expertsPayload.updatedAt ?? categoriesPayload.updatedAt ?? "",
    }

    if (data.catalogHash) {
      upsertStudioExpertCatalogCache({
        key: cacheKey,
        catalogHash: data.catalogHash,
        catalogVersion: data.catalogVersion,
        updatedAt: data.updatedAt,
        categories: data.categories,
        experts: data.experts,
      })
    }

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    const cached = getStudioExpertCatalogCache(cacheKey)

    if (cached) {
      return NextResponse.json({
        ok: true,
        data: {
          experts: cached.experts,
          categories: cached.categories,
          totalSize: cached.experts.length,
          nextPageToken: "",
          catalogVersion: cached.catalogVersion,
          catalogHash: cached.catalogHash,
          updatedAt: cached.updatedAt,
          cached: true,
        },
      })
    }

    return toExpertErrorResponse(error)
  }
}
