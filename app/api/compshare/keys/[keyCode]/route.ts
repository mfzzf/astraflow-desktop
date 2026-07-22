import { NextResponse } from "next/server"
import { z } from "zod"

import {
  compShareCodeSchema,
  compShareNameSchema,
  compShareRouteError,
  compShareValidationError,
  readCompShareOptionalJsonBody,
} from "@/app/api/compshare/_shared"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  deleteCompShareKey,
  renameCompShareKey,
} from "@/lib/compshare/packages"

export const runtime = "nodejs"

const renameKeySchema = z.object({ keyName: compShareNameSchema }).strict()
const querySchema = z.object({}).strict()
const emptyBodySchema = z.object({}).strict()

type KeyRouteContext = {
  params: Promise<{ keyCode: string }>
}

async function parseKeyCode(context: KeyRouteContext) {
  const { keyCode } = await context.params
  return compShareCodeSchema.safeParse(keyCode)
}

export async function PATCH(request: Request, context: KeyRouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const keyCode = await parseKeyCode(context)
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  const body = renameKeySchema.safeParse(
    await request.json().catch(() => undefined)
  )
  if (!keyCode.success) return compShareValidationError(keyCode.error)
  if (!query.success) return compShareValidationError(query.error)
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await renameCompShareKey(keyCode.data, body.data.keyName),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}

export async function DELETE(request: Request, context: KeyRouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const keyCode = await parseKeyCode(context)
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  const body = emptyBodySchema.safeParse(
    await readCompShareOptionalJsonBody(request)
  )
  if (!keyCode.success) return compShareValidationError(keyCode.error)
  if (!query.success) return compShareValidationError(query.error)
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: await deleteCompShareKey(keyCode.data),
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}
