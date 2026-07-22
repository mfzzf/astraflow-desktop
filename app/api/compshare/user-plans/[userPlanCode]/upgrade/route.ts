import { NextResponse } from "next/server"
import { z } from "zod"

import {
  compShareCodeSchema,
  compShareRouteError,
  compShareValidationError,
} from "@/app/api/compshare/_shared"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { upgradeCompShareUserPlan } from "@/lib/compshare/packages"

export const runtime = "nodejs"

const upgradeSchema = z.object({ newPlanCode: compShareCodeSchema }).strict()
const querySchema = z.object({}).strict()

type UpgradeRouteContext = {
  params: Promise<{ userPlanCode: string }>
}

export async function POST(request: Request, context: UpgradeRouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const { userPlanCode: rawUserPlanCode } = await context.params
  const userPlanCode = compShareCodeSchema.safeParse(rawUserPlanCode)
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  const body = upgradeSchema.safeParse(
    await request.json().catch(() => undefined)
  )
  if (!userPlanCode.success)
    return compShareValidationError(userPlanCode.error)
  if (!query.success) return compShareValidationError(query.error)
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await upgradeCompShareUserPlan({
        userPlanCode: userPlanCode.data,
        newPlanCode: body.data.newPlanCode,
      }),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}
