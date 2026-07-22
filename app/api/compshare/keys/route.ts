import { NextResponse } from "next/server"
import { z } from "zod"

import {
  compShareCodeSchema,
  compShareNameSchema,
  compShareRouteError,
  compShareValidationError,
} from "@/app/api/compshare/_shared"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  createCompShareKey,
  listCompShareKeys,
} from "@/lib/compshare/packages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const listKeysQuerySchema = z
  .object({
    isTeam: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .strict()
const mutationQuerySchema = z.object({}).strict()
const createKeySchema = z
  .object({
    userPlanCode: compShareCodeSchema,
    keyName: compShareNameSchema.optional(),
  })
  .strict()

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const query = listKeysQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!query.success) return compShareValidationError(query.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await listCompShareKeys({ isTeam: query.data.isTeam }),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const query = mutationQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!query.success) return compShareValidationError(query.error)

  const body = createKeySchema.safeParse(
    await request.json().catch(() => undefined)
  )
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await createCompShareKey(body.data),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}
