import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { connectMobileChannel } from "@/lib/mobile-channels/runtime"
import {
  getMobileChannelConnection,
  updateMobileChannelConnectionSettings,
} from "@/lib/mobile-channels/store"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ connectionId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { connectionId } = await context.params
  if (!getMobileChannelConnection(connectionId)) {
    return NextResponse.json(
      { ok: false, error: "Mobile connection not found." },
      { status: 404 }
    )
  }

  updateMobileChannelConnectionSettings(connectionId, { enabled: true })

  try {
    const connection = await connectMobileChannel(connectionId)
    return NextResponse.json({ ok: true, data: connection })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unable to connect channel.",
      },
      { status: 502 }
    )
  }
}
