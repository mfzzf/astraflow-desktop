import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  return NextResponse.json(
    {
      ok: false,
      message:
        "Terminal SSE has been replaced by the Workspace Gateway WebSocket endpoint.",
    },
    { status: 410 }
  )
}
