import { NextResponse } from "next/server"

import { isCompShareChannel } from "@/lib/compshare/config"
import { getStudioOAuthStatus } from "@/lib/studio-db"
import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"

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

  await ensureValidStudioOAuthTokens().catch(() => null)
  const status = getStudioOAuthStatus()
  return NextResponse.json({
    ok: true,
    data: {
      auth: status,
      oauthConfigured: status.configured,
    },
  })
}
