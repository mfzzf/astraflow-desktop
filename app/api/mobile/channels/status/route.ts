import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { ensureMobileChannelRuntimeStarted } from "@/lib/mobile-channels/runtime"
import { listMobileChannelConnections } from "@/lib/mobile-channels/store"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  void ensureMobileChannelRuntimeStarted()

  return NextResponse.json(
    {
      ok: true,
      data: {
        connections: listMobileChannelConnections(),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
