import { NextResponse } from "next/server"
import { z } from "zod"

import {
  compShareCodeSchema,
  compShareRouteError,
  compShareValidationError,
} from "@/app/api/compshare/_shared"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getCompSharePlanUpgradeQuote } from "@/lib/compshare/packages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const querySchema = z.object({ newPlanCode: compShareCodeSchema }).strict()

type UpgradeQuoteRouteContext = {
  params: Promise<{ userPlanCode: string }>
}

export async function GET(
  request: Request,
  context: UpgradeQuoteRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const { userPlanCode: rawUserPlanCode } = await context.params
  const userPlanCode = compShareCodeSchema.safeParse(rawUserPlanCode)
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!userPlanCode.success)
    return compShareValidationError(userPlanCode.error)
  if (!query.success) return compShareValidationError(query.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await getCompSharePlanUpgradeQuote({
        userPlanCode: userPlanCode.data,
        newPlanCode: query.data.newPlanCode,
      }),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}
