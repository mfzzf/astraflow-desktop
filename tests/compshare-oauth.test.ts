import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterAll, expect, mock, test } from "bun:test"

import type { StudioOAuthTokens } from "@/lib/studio-types"

const ISOLATED_RUN_ENV = "COMPSHARE_OAUTH_ISOLATED"

if (process.env[ISOLATED_RUN_ENV] === "1") {
  mock.module("server-only", () => ({}))
  mock.module("@/lib/channel-config", () => ({
    getDistributionChannelSlug: () => "compshare",
  }))
  mock.module("@/lib/generated/astraflow-api", () => ({
    channelServiceExchangeChannelOAuthCode: async () => {
      throw new Error("CompShare OAuth must exchange directly.")
    },
    channelServiceRefreshChannelOAuthToken: async () => {
      throw new Error("CompShare OAuth must refresh directly.")
    },
    channelServiceStartChannelOAuth: async () => {
      throw new Error("CompShare OAuth must start directly.")
    },
  }))

  let clearedCompShareCliCredentials = 0
  let syncedCompShareCliAccessToken: string | null = null
  mock.module("@/lib/compshare/cli-credentials", () => ({
    clearCompShareCliCredentials: () => {
      clearedCompShareCliCredentials += 1
    },
    ensureCompShareCliCredentials: async (accessToken: string) => {
      syncedCompShareCliAccessToken = accessToken
      return true
    },
    syncCompShareCliCredentials: async (accessToken: string) => {
      syncedCompShareCliAccessToken = accessToken
      return true
    },
  }))

  let storedTokens: StudioOAuthTokens | null = null
  let clearedCompShareApiKeyState = false
  mock.module("@/lib/studio-db", () => ({
    clearCompShareApiKeyState: () => {
      clearedCompShareApiKeyState = true
    },
    clearStudioOAuthTokens: () => {
      storedTokens = null
    },
    getStudioOAuthTokens: () => storedTokens,
    saveStudioOAuthTokens: (
      input: Omit<StudioOAuthTokens, "updatedAt">
    ) => {
      storedTokens = {
        ...input,
        updatedAt: "2026-07-24T00:00:00.000Z",
      }
    },
  }))

  const originalFetch = globalThis.fetch
  const oauth = await import("@/lib/ucloud-oauth")

  afterAll(() => {
    globalThis.fetch = originalFetch
  })

  test("CompShare OAuth uses oauth2.compshare.cn and stores channel-scoped bearer tokens", async () => {
    let tokenRequestUrl = ""
    let tokenRequestInit: RequestInit | undefined
    const idTokenPayload = Buffer.from(
      JSON.stringify({ email: "oauth-user@compshare.cn" })
    ).toString("base64url")

    globalThis.fetch = async (input, init) => {
      tokenRequestUrl = String(input)
      tokenRequestInit = init
      return new Response(
        JSON.stringify({
          access_token: "comp-access-token",
          refresh_token: "comp-refresh-token",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: `header.${idTokenPayload}.signature`,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }

    const flow = await oauth.startUCloudOAuthFlow()
    const authorizationUrl = new URL(flow.authorizationUrl)

    expect(authorizationUrl.origin).toBe("https://oauth2.compshare.cn")
    expect(authorizationUrl.pathname).toBe("/authorize")
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code")
    expect(authorizationUrl.searchParams.get("state")).toBe(flow.state)
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      flow.redirectUri
    )

    const callbackUrl = new URL(flow.redirectUri)
    callbackUrl.searchParams.set("state", flow.state)
    callbackUrl.searchParams.set("code", "authorization-code")
    const completion =
      await oauth.completeUCloudOAuthFlowFromCallbackUrl(
        callbackUrl.toString()
      )

    expect(completion.ok).toBe(true)
    expect(tokenRequestUrl).toBe("https://oauth2.compshare.cn/token")
    expect(tokenRequestInit?.method).toBe("POST")
    const tokenBody = new URLSearchParams(String(tokenRequestInit?.body))
    expect(tokenBody.get("grant_type")).toBe("authorization_code")
    expect(tokenBody.get("code")).toBe("authorization-code")
    expect(tokenBody.get("redirect_uri")).toBe(flow.redirectUri)
    expect(tokenBody.get("client_id")).toBeTruthy()
    expect(tokenBody.get("client_secret")).toBeTruthy()
    expect(storedTokens).toMatchObject({
      accessToken: "comp-access-token",
      refreshToken: "comp-refresh-token",
      tokenType: "Bearer",
      email: "oauth-user@compshare.cn",
      channelSlug: "compshare",
    })
    expect(clearedCompShareApiKeyState).toBe(false)
    expect(syncedCompShareCliAccessToken).toBe("comp-access-token")
  })

  test("refreshes CompShare tokens directly and clears keys when the OAuth account changes", async () => {
    storedTokens = {
      accessToken: "expired-access-token",
      refreshToken: "comp-refresh-token",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1,
      email: "old-user@compshare.cn",
      channelSlug: "compshare",
      updatedAt: "2026-07-24T00:00:00.000Z",
    }
    clearedCompShareApiKeyState = false
    clearedCompShareCliCredentials = 0
    syncedCompShareCliAccessToken = null
    let tokenRequestUrl = ""
    let tokenRequestInit: RequestInit | undefined
    const idTokenPayload = Buffer.from(
      JSON.stringify({ email: "new-user@compshare.cn" })
    ).toString("base64url")

    globalThis.fetch = async (input, init) => {
      tokenRequestUrl = String(input)
      tokenRequestInit = init
      return new Response(
        JSON.stringify({
          access_token: "refreshed-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: `header.${idTokenPayload}.signature`,
        }),
        { headers: { "Content-Type": "application/json" } }
      )
    }

    const refreshed = await oauth.ensureValidStudioOAuthTokens()

    expect(tokenRequestUrl).toBe("https://oauth2.compshare.cn/token")
    const tokenBody = new URLSearchParams(String(tokenRequestInit?.body))
    expect(tokenBody.get("grant_type")).toBe("refresh_token")
    expect(tokenBody.get("refresh_token")).toBe("comp-refresh-token")
    expect(refreshed).toMatchObject({
      accessToken: "refreshed-access-token",
      refreshToken: "comp-refresh-token",
      email: "new-user@compshare.cn",
      channelSlug: "compshare",
    })
    expect(clearedCompShareApiKeyState).toBe(true)
    expect(clearedCompShareCliCredentials).toBe(1)
    expect(syncedCompShareCliAccessToken).toBe("refreshed-access-token")
  })
} else {
  test("passes the isolated CompShare OAuth contract suite", () => {
    const result = spawnSync(
      process.execPath,
      ["test", fileURLToPath(import.meta.url)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          [ISOLATED_RUN_ENV]: "1",
        },
      }
    )

    assert.equal(result.status, 0, result.stderr || result.stdout)
  })
}
