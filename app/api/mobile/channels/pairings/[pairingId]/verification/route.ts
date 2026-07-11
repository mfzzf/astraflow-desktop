import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { submitMobileChannelPairingVerification } from "@/lib/mobile-channels/pairing"
import { mobileChannelVerificationSchema } from "@/lib/schemas/mobile-channels"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ pairingId: string }> }

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const parsed = mobileChannelVerificationSchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { pairingId } = await context.params
  const pairing = submitMobileChannelPairingVerification({
    pairingId,
    code: parsed.data.code,
  })

  if (!pairing) {
    return NextResponse.json(
      { ok: false, error: "Active WeChat pairing not found." },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true, data: pairing })
}
