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
  deleteCompShareUserPlan,
  renameCompShareUserPlan,
} from "@/lib/compshare/packages"

export const runtime = "nodejs"

const renamePlanSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1)
      .refine((value) => Array.from(value).length <= 128, {
        message: "displayName must contain at most 128 characters.",
      }),
  })
  .strict()
const querySchema = z.object({}).strict()
const emptyBodySchema = z.object({}).strict()

type UserPlanRouteContext = {
  params: Promise<{ userPlanCode: string }>
}

async function parseUserPlanCode(context: UserPlanRouteContext) {
  const { userPlanCode } = await context.params
  return compShareCodeSchema.safeParse(userPlanCode)
}

export async function PATCH(request: Request, context: UserPlanRouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const userPlanCode = await parseUserPlanCode(context)
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  const body = renamePlanSchema.safeParse(
    await request.json().catch(() => undefined)
  )
  if (!userPlanCode.success)
    return compShareValidationError(userPlanCode.error)
  if (!query.success) return compShareValidationError(query.error)
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await renameCompShareUserPlan(
        userPlanCode.data,
        body.data.displayName
      ),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}

export async function DELETE(request: Request, context: UserPlanRouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const userPlanCode = await parseUserPlanCode(context)
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  const body = emptyBodySchema.safeParse(
    await readCompShareOptionalJsonBody(request)
  )
  if (!userPlanCode.success)
    return compShareValidationError(userPlanCode.error)
  if (!query.success) return compShareValidationError(query.error)
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await deleteCompShareUserPlan(userPlanCode.data),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}
