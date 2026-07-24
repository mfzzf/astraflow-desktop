import { randomBytes } from "node:crypto"
import { createServer, type Server } from "node:http"
import { Buffer } from "node:buffer"
import type { ServerResponse } from "node:http"

import {
  clearCompShareApiKeyState,
  clearStudioOAuthTokens,
  getStudioOAuthTokens,
  saveStudioOAuthTokens,
} from "@/lib/studio-db"
import type {
  StudioOAuthFlowSnapshot,
  StudioOAuthFlowStatus,
  StudioOAuthTokens,
} from "@/lib/studio-types"
import { getDistributionChannelSlug } from "@/lib/channel-config"
import {
  clearCompShareCliCredentials,
  ensureCompShareCliCredentials,
  syncCompShareCliCredentials,
} from "@/lib/compshare/cli-credentials"
import {
  channelServiceExchangeChannelOAuthCode,
  channelServiceRefreshChannelOAuthToken,
  channelServiceStartChannelOAuth,
} from "@/lib/generated/astraflow-api"

const UCLOUD_OAUTH_BASE_URL = "https://oauth2.ucloud.cn"
const UCLOUD_OAUTH_AUTHORIZE_PATH = "/authorize"
const UCLOUD_OAUTH_TOKEN_PATH = "/token"
const UCLOUD_OAUTH_SCOPE = "openid email offline_access full_access"
const COMPSHARE_OAUTH_BASE_URL =
  process.env.COMPSHARE_OAUTH_BASE_URL?.trim() ||
  "https://oauth2.compshare.cn"
// Bundled UCloud OAuth client: AstraFlow Agent.
// Environment overrides remain available for custom builds.
const UCLOUD_OAUTH_CLIENT_ID =
  process.env.UCLOUD_OAUTH_CLIENT_ID || "kGsiLX8UJCf34BPOXtzn"
const UCLOUD_OAUTH_CLIENT_SECRET =
  process.env.UCLOUD_OAUTH_CLIENT_SECRET ||
  "RJSTS3P6FkwQW5oCIP9QEtgetTWMrARYrESyAAZz"
const COMPSHARE_OAUTH_CLIENT_ID =
  process.env.COMPSHARE_OAUTH_CLIENT_ID || UCLOUD_OAUTH_CLIENT_ID
const COMPSHARE_OAUTH_CLIENT_SECRET =
  process.env.COMPSHARE_OAUTH_CLIENT_SECRET || UCLOUD_OAUTH_CLIENT_SECRET
const LOOPBACK_LISTEN_HOST = "127.0.0.1"
const LOOPBACK_REDIRECT_HOST = "localhost"
const LOOPBACK_REDIRECT_PATH = "/authorization"
const OAUTH_TIMEOUT_MS = 3 * 60_000
const OAUTH_REFRESH_SKEW_MS = 5 * 60_000
const FLOW_RETENTION_MS = 5 * 60_000

type OAuthTokenResponse = {
  access_token?: string
  refresh_token?: string
  token_type?: string
  expires_in?: number
  id_token?: string
  error?: string
  error_description?: string
}

type DirectOAuthConfig = {
  baseUrl: string
  clientId: string
  clientSecret: string
  providerName: string
  scope: string
}

type OAuthFlowRecord = {
  state: string
  status: StudioOAuthFlowStatus
  authorizationUrl: string
  redirectUri: string
  port: number
  message: string | null
  server: Server | null
  timeout: ReturnType<typeof setTimeout> | null
  cleanupTimer: ReturnType<typeof setTimeout> | null
  channelSlug: string | null
  directOAuth: DirectOAuthConfig | null
}

type OAuthCallbackResult = {
  status: number
  title: string
  description: string
}

declare global {
  var astraflowOAuthFlows: Map<string, OAuthFlowRecord> | undefined
  var astraflowOAuthRefreshPromise:
    Promise<StudioOAuthTokens | null> | undefined
}

function getOAuthFlows() {
  if (!globalThis.astraflowOAuthFlows) {
    globalThis.astraflowOAuthFlows = new Map()
  }

  return globalThis.astraflowOAuthFlows
}

function renderHtml(title: string, description: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f6f2;
        color: #1b1b18;
        font-family: Roboto, system-ui, sans-serif;
      }
      main {
        width: min(560px, calc(100vw - 32px));
        border: 1px solid rgba(27, 27, 24, 0.08);
        background: #fff;
        padding: 28px;
        box-shadow: 0 20px 60px rgba(27, 27, 24, 0.08);
      }
      h1 {
        margin: 0 0 12px;
        font: 600 28px/1.2 Lora, Georgia, serif;
      }
      p {
        margin: 0;
        font-size: 15px;
        line-height: 1.65;
        color: rgba(27, 27, 24, 0.72);
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${description}</p>
    </main>
  </body>
</html>`
}

function sendHtml(
  res: ServerResponse,
  status: number,
  title: string,
  description: string
) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  })
  res.end(renderHtml(title, description))
}

function generateOAuthState() {
  return randomBytes(32).toString("base64url")
}

function buildLoopbackRedirectUri(port: number) {
  return `http://${LOOPBACK_REDIRECT_HOST}:${port}${LOOPBACK_REDIRECT_PATH}`
}

function resolveDirectOAuthConfig(
  channelSlug: string | null
): DirectOAuthConfig | null {
  if (channelSlug === "compshare") {
    return {
      baseUrl: COMPSHARE_OAUTH_BASE_URL,
      clientId: COMPSHARE_OAUTH_CLIENT_ID,
      clientSecret: COMPSHARE_OAUTH_CLIENT_SECRET,
      providerName: "CompShare",
      scope: UCLOUD_OAUTH_SCOPE,
    }
  }

  if (!channelSlug) {
    return {
      baseUrl: UCLOUD_OAUTH_BASE_URL,
      clientId: UCLOUD_OAUTH_CLIENT_ID,
      clientSecret: UCLOUD_OAUTH_CLIENT_SECRET,
      providerName: "UCloud",
      scope: UCLOUD_OAUTH_SCOPE,
    }
  }

  return null
}

function buildAuthorizeUrl(
  config: DirectOAuthConfig,
  redirectUri: string,
  state: string
) {
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: config.scope,
    state,
  })

  return `${config.baseUrl}${UCLOUD_OAUTH_AUTHORIZE_PATH}?${query.toString()}`
}

function normalizeOAuthError(error: string, description: string) {
  if (error === "invalid_grant") {
    return "Authorization code or refresh token expired. Start the OAuth login flow again."
  }

  if (error === "access_denied") {
    return "Authorization was denied in the browser."
  }

  if (description) {
    return `${error}: ${description}`
  }

  return error || "OAuth request failed."
}

function parseIdTokenEmail(idToken?: string) {
  if (!idToken) {
    return null
  }

  const [, payload] = idToken.split(".")

  if (!payload) {
    return null
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { email?: string }

    return typeof decoded.email === "string" ? decoded.email : null
  } catch {
    return null
  }
}

async function requestOAuthToken(
  config: DirectOAuthConfig,
  form: URLSearchParams
) {
  const response = await fetch(
    `${config.baseUrl}${UCLOUD_OAUTH_TOKEN_PATH}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    }
  )

  let payload: OAuthTokenResponse

  try {
    payload = (await response.json()) as OAuthTokenResponse
  } catch {
    throw new Error(`${config.providerName} OAuth returned an invalid response.`)
  }

  if (!response.ok || payload.error || !payload.access_token) {
    throw new Error(
      normalizeOAuthError(
        payload.error ?? `HTTP ${response.status}`,
        payload.error_description ?? ""
      )
    )
  }

  return payload
}

async function exchangeDirectOAuthCode(
  config: DirectOAuthConfig,
  code: string,
  redirectUri: string
) {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: redirectUri,
  })

  return requestOAuthToken(config, form)
}

async function refreshDirectOAuthToken(
  config: DirectOAuthConfig,
  refreshToken: string
) {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })

  return requestOAuthToken(config, form)
}

function toOAuthTokenResponse(payload: {
  accessToken?: string
  refreshToken?: string
  tokenType?: string
  expiresIn?: number | string
  idToken?: string
}): OAuthTokenResponse {
  return {
    access_token: payload.accessToken,
    refresh_token: payload.refreshToken,
    token_type: payload.tokenType,
    expires_in:
      payload.expiresIn === undefined ? undefined : Number(payload.expiresIn),
    id_token: payload.idToken,
  }
}

async function exchangeManagedOAuthCode(
  channelSlug: string,
  state: string,
  code: string,
  redirectUri: string
) {
  const result = await channelServiceExchangeChannelOAuthCode({
    path: { slug: channelSlug },
    body: { slug: channelSlug, state, code, redirectUri },
    signal: AbortSignal.timeout(30_000),
  })

  if (!result.data?.accessToken) {
    throw new Error("Channel OAuth code exchange failed.")
  }

  return toOAuthTokenResponse(result.data)
}

async function refreshManagedOAuthToken(
  channelSlug: string,
  refreshToken: string
) {
  const result = await channelServiceRefreshChannelOAuthToken({
    path: { slug: channelSlug },
    body: { slug: channelSlug, refreshToken },
    signal: AbortSignal.timeout(30_000),
  })

  if (!result.data?.accessToken) {
    throw new Error("Channel OAuth token refresh failed.")
  }

  return toOAuthTokenResponse(result.data)
}

function applyOAuthTokenResponse(
  current: StudioOAuthTokens | null,
  payload: OAuthTokenResponse,
  channelSlug: string | null
) {
  const expiresAt =
    typeof payload.expires_in === "number"
      ? Date.now() + payload.expires_in * 1000
      : (current?.expiresAt ?? null)

  const email = parseIdTokenEmail(payload.id_token) ?? current?.email ?? null

  if (
    channelSlug === "compshare" &&
    current?.channelSlug === "compshare" &&
    current.email &&
    email &&
    current.email !== email
  ) {
    clearCompShareApiKeyState()
    clearCompShareCliCredentials()
  }

  saveStudioOAuthTokens({
    accessToken: payload.access_token!,
    refreshToken: payload.refresh_token ?? current?.refreshToken ?? null,
    tokenType: payload.token_type ?? current?.tokenType ?? "Bearer",
    expiresAt,
    email,
    channelSlug,
  })

  return getStudioOAuthTokens()
}

async function updateCompShareCliCredentials(
  tokens: StudioOAuthTokens | null,
  force: boolean
) {
  if (tokens?.channelSlug !== "compshare" || !tokens.accessToken) {
    return
  }

  try {
    if (force) {
      await syncCompShareCliCredentials(tokens.accessToken)
    } else {
      await ensureCompShareCliCredentials(tokens.accessToken)
    }
  } catch {
    console.warn(
      "[compshare-cli] Unable to provision CLI credentials from OAuth."
    )
  }
}

function finishFlow(flow: OAuthFlowRecord) {
  if (flow.timeout) {
    clearTimeout(flow.timeout)
    flow.timeout = null
  }

  if (flow.cleanupTimer) {
    clearTimeout(flow.cleanupTimer)
  }

  if (flow.server) {
    flow.server.close()
    flow.server = null
  }

  flow.cleanupTimer = setTimeout(() => {
    getOAuthFlows().delete(flow.state)
  }, FLOW_RETENTION_MS)
}

function getFlowSnapshot(flow: OAuthFlowRecord): StudioOAuthFlowSnapshot {
  return {
    state: flow.state,
    status: flow.status,
    authorizationUrl: flow.authorizationUrl,
    redirectUri: flow.redirectUri,
    port: flow.port,
    message: flow.message,
  }
}

export function getUCloudOAuthFlowSnapshot(state: string) {
  const flow = getOAuthFlows().get(state)

  return flow ? getFlowSnapshot(flow) : null
}

function getCompletedCallbackResult(
  flow: OAuthFlowRecord
): OAuthCallbackResult {
  const isComplete = flow.status === "complete"

  return {
    status: isComplete ? 200 : 400,
    title: isComplete ? "Login successful" : "Authorization failed",
    description:
      flow.message ??
      (isComplete
        ? "OAuth login succeeded. You can close this tab now."
        : "OAuth authorization failed. Start the login flow again."),
  }
}

async function completeFlowFromCallback(
  flow: OAuthFlowRecord,
  requestUrl: URL
): Promise<OAuthCallbackResult> {
  if (flow.status !== "pending") {
    return getCompletedCallbackResult(flow)
  }

  const callbackState = requestUrl.searchParams.get("state")?.trim() ?? ""
  const callbackError = requestUrl.searchParams.get("error")?.trim() ?? ""
  const callbackDescription =
    requestUrl.searchParams.get("error_description")?.trim() ?? ""
  const code = requestUrl.searchParams.get("code")?.trim() ?? ""

  if (callbackError) {
    flow.status = "error"
    flow.message = normalizeOAuthError(callbackError, callbackDescription)
    finishFlow(flow)
    return {
      status: 400,
      title: "Authorization failed",
      description: flow.message,
    }
  }

  if (!callbackState || callbackState !== flow.state) {
    return {
      status: 400,
      title: "State mismatch",
      description:
        "This callback does not match the active AstraFlow authorization request.",
    }
  }

  if (!code) {
    return {
      status: 400,
      title: "Missing code",
      description:
        "The OAuth provider did not return an authorization code. Start the login flow again.",
    }
  }

  try {
    const payload = flow.directOAuth
      ? await exchangeDirectOAuthCode(
          flow.directOAuth,
          code,
          flow.redirectUri
        )
      : flow.channelSlug
        ? await exchangeManagedOAuthCode(
          flow.channelSlug,
          flow.state,
          code,
          flow.redirectUri
        )
        : await exchangeDirectOAuthCode(
            resolveDirectOAuthConfig(null)!,
            code,
            flow.redirectUri
          )
    const savedTokens = applyOAuthTokenResponse(
      getStudioOAuthTokens(),
      payload,
      flow.channelSlug
    )
    await updateCompShareCliCredentials(savedTokens, true)

    flow.status = "complete"
    flow.message = savedTokens?.email
      ? `Connected as ${savedTokens.email}. You can close this tab now.`
      : "OAuth login succeeded. You can close this tab now."
    finishFlow(flow)

    return { status: 200, title: "Login successful", description: flow.message }
  } catch (error) {
    flow.status = "error"
    flow.message =
      error instanceof Error ? error.message : "OAuth login failed."
    finishFlow(flow)

    return { status: 500, title: "Login failed", description: flow.message }
  }
}

function registerOAuthFlow(flow: OAuthFlowRecord) {
  flow.timeout = setTimeout(() => {
    if (flow.status !== "pending") {
      return
    }

    flow.status = "error"
    flow.message = "Authorization timed out. Start the OAuth login flow again."
    finishFlow(flow)
  }, OAUTH_TIMEOUT_MS)

  getOAuthFlows().set(flow.state, flow)

  return getFlowSnapshot(flow)
}

async function startLoopbackOAuthFlow(
  createAuthorization: (redirectUri: string) => Promise<{
    state: string
    authorizationUrl: string
    channelSlug: string | null
    directOAuth: DirectOAuthConfig | null
  }>
) {
  let flow: OAuthFlowRecord | null = null
  const server = createServer(async (req, res) => {
    if (!flow) {
      sendHtml(
        res,
        503,
        "Starting login",
        "The local callback server is still initializing. Refresh the page and try again."
      )
      return
    }

    const requestUrl = new URL(
      req.url ?? "/",
      `http://${LOOPBACK_REDIRECT_HOST}:${flow.port}`
    )

    if (requestUrl.pathname !== LOOPBACK_REDIRECT_PATH) {
      sendHtml(
        res,
        404,
        "Not found",
        "This local callback path is not available."
      )
      return
    }

    const result = await completeFlowFromCallback(flow, requestUrl)

    sendHtml(res, result.status, result.title, result.description)
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, LOOPBACK_LISTEN_HOST, () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()

  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Unable to allocate a local callback port.")
  }

  const redirectUri = buildLoopbackRedirectUri(address.port)
  let authorization: Awaited<ReturnType<typeof createAuthorization>>

  try {
    authorization = await createAuthorization(redirectUri)
  } catch (error) {
    server.close()
    throw error
  }

  flow = {
    state: authorization.state,
    status: "pending",
    authorizationUrl: authorization.authorizationUrl,
    redirectUri,
    port: address.port,
    message: null,
    server,
    timeout: null,
    cleanupTimer: null,
    channelSlug: authorization.channelSlug,
    directOAuth: authorization.directOAuth,
  }

  return registerOAuthFlow(flow)
}

export async function startUCloudOAuthFlow() {
  const channelSlug = getDistributionChannelSlug()

  return startLoopbackOAuthFlow(async (redirectUri) => {
    const directOAuth = resolveDirectOAuthConfig(channelSlug || null)

    if (directOAuth) {
      const state = generateOAuthState()
      return {
        state,
        authorizationUrl: buildAuthorizeUrl(
          directOAuth,
          redirectUri,
          state
        ),
        channelSlug: channelSlug || null,
        directOAuth,
      }
    }

    const result = await channelServiceStartChannelOAuth({
      path: { slug: channelSlug },
      body: { slug: channelSlug, redirectUri },
      signal: AbortSignal.timeout(15_000),
    })

    if (!result.data?.state || !result.data.authorizationUrl) {
      throw new Error("Channel OAuth configuration is unavailable.")
    }

    return {
      state: result.data.state,
      authorizationUrl: result.data.authorizationUrl,
      channelSlug,
      directOAuth: null,
    }
  })
}

export async function completeUCloudOAuthFlowFromCallbackUrl(
  callbackUrl: string
) {
  let requestUrl: URL

  try {
    requestUrl = new URL(callbackUrl.trim())
  } catch {
    throw new Error("Paste the full browser callback URL.")
  }

  if (
    [UCLOUD_OAUTH_BASE_URL, COMPSHARE_OAUTH_BASE_URL].includes(
      requestUrl.origin
    ) &&
    requestUrl.pathname === UCLOUD_OAUTH_AUTHORIZE_PATH
  ) {
    throw new Error(
      "Paste the URL after the OAuth provider redirects back to localhost, not the authorize URL."
    )
  }

  const callbackState = requestUrl.searchParams.get("state")?.trim() ?? ""
  const flow = callbackState ? getOAuthFlows().get(callbackState) : null

  if (!flow) {
    throw new Error(
      "This authorization request is no longer active. Start the OAuth login flow again."
    )
  }

  const result = await completeFlowFromCallback(flow, requestUrl)

  return {
    flow: getFlowSnapshot(flow),
    message: result.description,
    ok: result.status < 400,
    status: result.status,
  }
}

export async function ensureValidStudioOAuthTokens() {
  const current = getStudioOAuthTokens()

  if (!current?.accessToken) {
    return null
  }

  const activeChannelSlug = getDistributionChannelSlug()
  if ((current.channelSlug ?? "") !== activeChannelSlug) {
    clearStudioOAuthTokens()
    clearCompShareCliCredentials()
    return null
  }

  if (
    current.expiresAt &&
    current.expiresAt > Date.now() + OAUTH_REFRESH_SKEW_MS
  ) {
    await updateCompShareCliCredentials(current, false)
    return current
  }

  if (!current.refreshToken) {
    if (current.expiresAt && current.expiresAt <= Date.now()) {
      clearStudioOAuthTokens()
      clearCompShareCliCredentials()
      return null
    }

    await updateCompShareCliCredentials(current, false)
    return current
  }

  if (globalThis.astraflowOAuthRefreshPromise) {
    return globalThis.astraflowOAuthRefreshPromise
  }

  globalThis.astraflowOAuthRefreshPromise = (async () => {
    try {
      const directOAuth = resolveDirectOAuthConfig(activeChannelSlug || null)
      const payload = directOAuth
        ? await refreshDirectOAuthToken(directOAuth, current.refreshToken!)
        : activeChannelSlug
          ? await refreshManagedOAuthToken(
            activeChannelSlug,
            current.refreshToken!
          )
          : await refreshDirectOAuthToken(
              resolveDirectOAuthConfig(null)!,
              current.refreshToken!
            )
      const refreshed = applyOAuthTokenResponse(
        current,
        payload,
        activeChannelSlug || null
      )
      await updateCompShareCliCredentials(refreshed, true)
      return refreshed
    } catch {
      clearStudioOAuthTokens()
      clearCompShareCliCredentials()
      return null
    } finally {
      globalThis.astraflowOAuthRefreshPromise = undefined
    }
  })()

  return globalThis.astraflowOAuthRefreshPromise
}
