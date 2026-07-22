import { NextResponse } from "next/server"
import { z } from "zod"

import {
  compShareCodeSchema,
  compShareRouteError,
  compShareValidationError,
} from "@/app/api/compshare/_shared"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { listCompShareUsageRecords } from "@/lib/compshare/packages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const unixTimeSchema = z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const usageQuerySchema = z
  .object({
    keyCodes: z.array(compShareCodeSchema).max(100).optional(),
    beginTime: unixTimeSchema.optional(),
    endTime: unixTimeSchema.optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.beginTime !== undefined &&
      value.endTime !== undefined &&
      value.beginTime > value.endTime
    ) {
      context.addIssue({
        code: "custom",
        path: ["endTime"],
        message: "endTime must be greater than or equal to beginTime.",
      })
    }
  })

const ALLOWED_QUERY_KEYS: Record<string, true> = {
  keyCode: true,
  beginTime: true,
  endTime: true,
  page: true,
  pageSize: true,
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const searchParams = new URL(request.url).searchParams
  const unknownQueryKeys = [...searchParams.keys()].filter(
    (key) => !ALLOWED_QUERY_KEYS[key]
  )
  if (unknownQueryKeys.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "The request is invalid.",
          details: { unknownQueryKeys: [...new Set(unknownQueryKeys)] },
        },
      },
      { status: 400 }
    )
  }

  const keyCodes = searchParams.getAll("keyCode")
  const scalar = (name: string) => {
    const values = searchParams.getAll(name)
    return values.length <= 1 ? values[0] : values
  }
  const query = usageQuerySchema.safeParse({
    ...(keyCodes.length > 0 ? { keyCodes } : {}),
    ...(searchParams.has("beginTime")
      ? { beginTime: scalar("beginTime") }
      : {}),
    ...(searchParams.has("endTime") ? { endTime: scalar("endTime") } : {}),
    ...(searchParams.has("page") ? { page: scalar("page") } : {}),
    ...(searchParams.has("pageSize")
      ? { pageSize: scalar("pageSize") }
      : {}),
  })
  if (!query.success) return compShareValidationError(query.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await listCompShareUsageRecords(query.data),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}
