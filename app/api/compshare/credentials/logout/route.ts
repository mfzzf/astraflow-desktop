import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import { isCompShareChannel } from "@/lib/compshare/config"
import {
  clearCompShareCredentials,
  clearCompShareSelectedApiKey,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)
  if (originError) {
    return originError
  }
  if (!isCompShareChannel()) {
    return NextResponse.json(
      { ok: false, message: "CompShare logout is unavailable on this channel." },
      { status: 404 }
    )
  }

  clearCompShareSelectedApiKey()
  clearCompShareCredentials()
  return NextResponse.json({ ok: true })
}
