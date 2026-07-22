import { NextResponse } from "next/server"
import { z } from "zod"

import { CompSharePackageError } from "@/lib/compshare/packages"

export const compShareCodeSchema = z.string().trim().min(1).max(128)
export const compShareNameSchema = z.string().trim().max(128)

export async function readCompShareOptionalJsonBody(request: Request) {
  const text = await request.text()
  if (!text.trim()) return {}

  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export function compShareValidationError(error: z.ZodError) {
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "INVALID_REQUEST",
        message: "The request is invalid.",
        details: error.flatten(),
      },
    },
    { status: 400 }
  )
}

export function compShareRouteError(error: unknown) {
  if (error instanceof CompSharePackageError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.retCode === undefined ? {} : { retCode: error.retCode }),
          ...(error.requestId ? { requestId: error.requestId } : {}),
        },
      },
      { status: error.status }
    )
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "COMPSHARE_INTERNAL_ERROR",
        message: "The CompShare request could not be completed.",
      },
    },
    { status: 500 }
  )
}
