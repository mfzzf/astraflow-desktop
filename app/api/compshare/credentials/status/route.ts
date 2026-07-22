import { NextResponse } from "next/server"

import { isCompShareChannel } from "@/lib/compshare/config"
import { getCompShareCredentialStatus } from "@/lib/studio-db"

export const runtime = "nodejs"

export async function GET() {
  if (!isCompShareChannel()) {
    return NextResponse.json(
      {
        ok: false,
        message: "CompShare credential status is unavailable on this channel.",
      },
      { status: 404 }
    )
  }

  const status = getCompShareCredentialStatus()
  return NextResponse.json({
    ok: true,
    data: {
      auth: status,
      oauthConfigured: false,
    },
  })
}
