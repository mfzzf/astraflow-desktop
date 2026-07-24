import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import { isCompShareChannel } from "@/lib/compshare/config"
import { getCompShareCredentialStatus } from "@/lib/studio-db"

export const runtime = "nodejs"

function unavailableResponse() {
  return NextResponse.json(
    {
      ok: false,
      message: "CompShare credentials are unavailable on this channel.",
    },
    { status: 404 }
  )
}

export async function GET() {
  if (!isCompShareChannel()) {
    return unavailableResponse()
  }

  return NextResponse.json({
    ok: true,
    data: getCompShareCredentialStatus(),
  })
}

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)
  if (originError) {
    return originError
  }
  if (!isCompShareChannel()) {
    return unavailableResponse()
  }

  return NextResponse.json(
    {
      ok: false,
      message:
        "PublicKey/PrivateKey login has been replaced by CompShare OAuth.",
    },
    { status: 410 }
  )
}
