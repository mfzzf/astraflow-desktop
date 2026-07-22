import { NextResponse } from "next/server"
import { z } from "zod"

import { compShareRouteError, compShareValidationError } from "@/app/api/compshare/_shared"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { listCompSharePlans } from "@/lib/compshare/packages"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const querySchema = z.object({}).strict()

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!query.success) return compShareValidationError(query.error)

  try {
    return NextResponse.json({ ok: true, data: await listCompSharePlans() })
  } catch (error) {
    return compShareRouteError(error)
  }
}
