import { NextResponse } from "next/server"
import { z } from "zod"

import {
  compShareCodeSchema,
  compShareNameSchema,
  compShareRouteError,
  compShareValidationError,
} from "@/app/api/compshare/_shared"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { buyCompSharePlan } from "@/lib/compshare/packages"

export const runtime = "nodejs"

const purchaseSchema = z
  .object({
    planCode: compShareCodeSchema,
    keyName: compShareNameSchema.optional(),
    isTeam: z.boolean().optional().default(false),
    count: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.isTeam && value.count !== undefined && value.count !== 1) {
      context.addIssue({
        code: "custom",
        path: ["count"],
        message: "count is only available for team purchases.",
      })
    }
  })

const querySchema = z.object({}).strict()

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!query.success) return compShareValidationError(query.error)

  const body = purchaseSchema.safeParse(
    await request.json().catch(() => undefined)
  )
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await buyCompSharePlan(body.data),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}
