import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  deleteMobileChannelConnection,
  getMobileChannelConnection,
  updateMobileChannelConnectionSettings,
} from "@/lib/mobile-channels/store"
import { disconnectMobileChannel } from "@/lib/mobile-channels/runtime"
import { purgeMobileChannelOutbox } from "@/lib/mobile-channels/outbox"
import { syncMobileChannelConnectionToBoundSessions } from "@/lib/mobile-channels/preferences"
import { updateMobileChannelConnectionSchema } from "@/lib/schemas/mobile-channels"
import { getStudioLocalProject } from "@/lib/studio-db"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ connectionId: string }> }

export async function PATCH(request: Request, context: RouteContext) {
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

  const parsed = updateMobileChannelConnectionSchema.safeParse(
    await request.json()
  )
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (
    parsed.data.defaultProjectId &&
    !getStudioLocalProject(parsed.data.defaultProjectId)
  ) {
    return NextResponse.json(
      { ok: false, error: "Local project not found." },
      { status: 404 }
    )
  }

  const connection = updateMobileChannelConnectionSettings(
    connectionId,
    parsed.data
  )
  if (!connection) {
    return NextResponse.json(
      { ok: false, error: "Mobile connection not found." },
      { status: 404 }
    )
  }
  syncMobileChannelConnectionToBoundSessions(connectionId, connection)
  if (parsed.data.enabled === false) {
    await disconnectMobileChannel(connectionId)
  }

  return NextResponse.json({ ok: true, data: connection })
}

export async function DELETE(request: Request, context: RouteContext) {
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

  await disconnectMobileChannel(connectionId)
  await purgeMobileChannelOutbox(connectionId)
  deleteMobileChannelConnection(connectionId)
  return NextResponse.json({ ok: true })
}
