import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import { isCompShareChannel } from "@/lib/compshare/config"
import {
  clearCompShareApiKeyState,
  clearCompShareCredentials,
  clearStudioAstraFlowApiKeySession,
  clearStudioExaApiKey,
  clearStudioModelverseApiKey,
  clearStudioOAuthTokens,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)

  if (isCompShareChannel()) {
    if (originError) {
      return originError
    }

    clearStudioOAuthTokens()
    clearCompShareCredentials()
    clearCompShareApiKeyState()
    return NextResponse.json({ ok: true })
  }

  clearStudioExaApiKey()
  clearStudioModelverseApiKey()
  clearStudioOAuthTokens()
  clearStudioAstraFlowApiKeySession()

  if (originError) {
    return NextResponse.json({
      ok: true,
      warning: "Invalid request origin was ignored for local logout.",
    })
  }

  return NextResponse.json({
    ok: true,
  })
}
