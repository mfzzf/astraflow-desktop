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
  clearCompShareSelectedKey,
  getCompShareSelectedKeyStatus,
  selectCompShareKey,
} from "@/lib/compshare/packages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const querySchema = z.object({}).strict()
const selectionSchema = z.object({ keyCode: compShareCodeSchema }).strict()

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!query.success) return compShareValidationError(query.error)

  try {
    return NextResponse.json({
      ok: true,
      data: { selectedKey: getCompShareSelectedKeyStatus() },
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}

export async function PUT(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  const body = selectionSchema.safeParse(
    await request.json().catch(() => undefined)
  )
  if (!query.success) return compShareValidationError(query.error)
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: { selectedKey: await selectCompShareKey(body.data.keyCode) },
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}

export async function DELETE(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  const body = querySchema.safeParse(
    await readCompShareOptionalJsonBody(request)
  )
  if (!query.success) return compShareValidationError(query.error)
  if (!body.success) return compShareValidationError(body.error)

  try {
    return NextResponse.json({
      ok: true,
      data: { selectedKey: clearCompShareSelectedKey() },
    })
  } catch (error) {
    return compShareRouteError(error)
  }
}
