import { NextResponse } from "next/server"
import { z } from "zod"

import {
  compShareCodeSchema,
  compShareRouteError,
  compShareValidationError,
  readCompShareOptionalJsonBody,
} from "@/app/api/compshare/_shared"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  getCompShareRechargeQuote,
  rechargeCompShareUserPlan,
} from "@/lib/compshare/packages"

export const runtime = "nodejs"

const emptySchema = z.object({}).strict()
const rechargeSchema = z
  .object({
    expectedPrice: z.number().finite().nonnegative(),
  })
  .strict()

type RechargeRouteContext = {
  params: Promise<{ userPlanCode: string }>
}

export async function GET(request: Request, context: RechargeRouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const { userPlanCode: rawUserPlanCode } = await context.params
  const userPlanCode = compShareCodeSchema.safeParse(rawUserPlanCode)
  const query = emptySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!userPlanCode.success)
    return compShareValidationError(userPlanCode.error)
  if (!query.success) return compShareValidationError(query.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await getCompShareRechargeQuote(userPlanCode.data),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}

export async function POST(request: Request, context: RechargeRouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const { userPlanCode: rawUserPlanCode } = await context.params
  const userPlanCode = compShareCodeSchema.safeParse(rawUserPlanCode)
  const query = emptySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  const body = rechargeSchema.safeParse(
    await readCompShareOptionalJsonBody(request)
  )
  if (!userPlanCode.success)
    return compShareValidationError(userPlanCode.error)
  if (!query.success) return compShareValidationError(query.error)
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await rechargeCompShareUserPlan({
        userPlanCode: userPlanCode.data,
        expectedPrice: body.data.expectedPrice,
      }),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}
