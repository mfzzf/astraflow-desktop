import { NextResponse } from "next/server"

import { getAppAuthState } from "@/lib/app-auth"
import { isCompShareChannel } from "@/lib/compshare/config"
import {
  getStudioAstraFlowApiKeySessionStatus,
  getCompShareCredentialStatus,
  getStudioOAuthStatus,
} from "@/lib/studio-db"
import {
  ensureValidStudioOAuthTokens,
  getUCloudOAuthFlowSnapshot,
} from "@/lib/ucloud-oauth"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const compShareChannel = isCompShareChannel()
  if (!compShareChannel) {
    try {
      await ensureValidStudioOAuthTokens()
    } catch {
      // The route should still return local status even if refresh fails.
    }
  }

  const searchParams = new URL(request.url).searchParams
  const state = searchParams.get("state")?.trim() ?? ""
  const oauthStatus = compShareChannel
    ? {
        configured: false,
        email: null,
        expiresAt: null,
        updatedAt: getCompShareCredentialStatus().updatedAt,
      }
    : getStudioOAuthStatus()
  const apiKeySession = getStudioAstraFlowApiKeySessionStatus()
  const appAuth = await getAppAuthState()

  return NextResponse.json({
    ok: true,
    data: {
      auth: {
        ...oauthStatus,
        configured: appAuth.authenticated,
        updatedAt: oauthStatus.updatedAt ?? apiKeySession.updatedAt,
      },
      oauthConfigured: appAuth.oauthConfigured,
      flow: !compShareChannel && state ? getUCloudOAuthFlowSnapshot(state) : null,
    },
  })
}
