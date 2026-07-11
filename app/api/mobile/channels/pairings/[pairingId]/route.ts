import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { cancelMobileChannelPairing } from "@/lib/mobile-channels/pairing"
import { getMobileChannelPairing } from "@/lib/mobile-channels/store"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ pairingId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { pairingId } = await context.params
  const pairing = getMobileChannelPairing(pairingId)
  if (!pairing) {
    return NextResponse.json(
      { ok: false, error: "Mobile pairing not found." },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true, data: pairing })
}

export async function DELETE(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { pairingId } = await context.params
  const pairing = cancelMobileChannelPairing(pairingId)
  if (!pairing) {
    return NextResponse.json(
      { ok: false, error: "Mobile pairing not found." },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true, data: pairing })
}
