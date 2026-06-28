import { NextResponse } from "next/server"

import { getStudioOAuthStatus } from "@/lib/studio-db"
import {
  ensureValidStudioOAuthTokens,
  getUCloudOAuthFlowSnapshot,
} from "@/lib/ucloud-oauth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    await ensureValidStudioOAuthTokens()
  } catch {
    // The route should still return local status even if refresh fails.
  }

  const searchParams = new URL(request.url).searchParams
  const state = searchParams.get("state")?.trim() ?? ""

  return NextResponse.json({
    ok: true,
    data: {
      auth: getStudioOAuthStatus(),
      flow: state ? getUCloudOAuthFlowSnapshot(state) : null,
    },
  })
}
