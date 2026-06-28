import { NextResponse } from "next/server"

import {
  clearStudioModelverseApiKey,
  clearStudioOAuthTokens,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST() {
  clearStudioModelverseApiKey()
  clearStudioOAuthTokens()

  return NextResponse.json({
    ok: true,
  })
}
