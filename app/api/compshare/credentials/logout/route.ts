import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import { clearCompShareCliCredentials } from "@/lib/compshare/cli-credentials"
import { isCompShareChannel } from "@/lib/compshare/config"
import {
  clearCompShareApiKeyState,
  clearCompShareCredentials,
  clearStudioOAuthTokens,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)
  if (originError) {
    return originError
  }
  if (!isCompShareChannel()) {
    return NextResponse.json(
      {
        ok: false,
        message: "CompShare logout is unavailable on this channel.",
      },
      { status: 404 }
    )
  }

  clearStudioOAuthTokens()
  clearCompShareCliCredentials()
  clearCompShareCredentials()
  clearCompShareApiKeyState()
  return NextResponse.json({ ok: true })
}
