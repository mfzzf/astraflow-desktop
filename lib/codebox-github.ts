import { randomUUID } from "node:crypto"

import {
  clearCodeBoxGithubTokens,
  saveCodeBoxGithubTokens,
} from "@/lib/studio-db"

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
const GITHUB_API_URL = "https://api.github.com"
const GITHUB_SCOPE = "repo read:user user:email"

type GitHubDeviceFlow = {
  flowId: string
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresAt: number
  interval: number
}

type GitHubTokenResponse =
  | {
      access_token: string
      token_type: string
      scope: string
    }
  | {
      error: string
      error_description?: string
      interval?: number
    }

type GitHubUser = {
  login?: string
  name?: string | null
  email?: string | null
}

type GitHubEmail = {
  email?: string
  primary?: boolean
  verified?: boolean
}

declare global {
  var astraflowCodeBoxGithubFlows: Map<string, GitHubDeviceFlow> | undefined
}

function getFlows() {
  globalThis.astraflowCodeBoxGithubFlows ??= new Map()
  return globalThis.astraflowCodeBoxGithubFlows
}

function getClientId() {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID?.trim()

  if (!clientId) {
    throw new Error("GITHUB_OAUTH_CLIENT_ID is not configured.")
  }

  return clientId
}

async function readJson<T>(response: Response) {
  let payload: T

  try {
    payload = (await response.json()) as T
  } catch {
    throw new Error("GitHub returned an invalid response.")
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error_description" in payload
        ? String(payload.error_description)
        : "GitHub request failed."
    throw new Error(message)
  }

  return payload
}

export async function startCodeBoxGithubDeviceFlow() {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: getClientId(),
      scope: GITHUB_SCOPE,
    }),
    cache: "no-store",
  })
  const payload = await readJson<{
    device_code?: string
    user_code?: string
    verification_uri?: string
    expires_in?: number
    interval?: number
  }>(response)

  if (!payload.device_code || !payload.user_code || !payload.verification_uri) {
    throw new Error("GitHub device authorization did not return a code.")
  }

  const flow: GitHubDeviceFlow = {
    flowId: randomUUID(),
    deviceCode: payload.device_code,
    userCode: payload.user_code,
    verificationUri: payload.verification_uri,
    expiresAt: Date.now() + (payload.expires_in ?? 900) * 1000,
    interval: payload.interval ?? 5,
  }

  getFlows().set(flow.flowId, flow)

  return {
    flowId: flow.flowId,
    userCode: flow.userCode,
    verificationUri: flow.verificationUri,
    expiresAt: new Date(flow.expiresAt).toISOString(),
    interval: flow.interval,
  }
}

async function fetchGithubProfile(accessToken: string) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${accessToken}`,
    "X-GitHub-Api-Version": "2022-11-28",
  }
  const user = await readJson<GitHubUser>(
    await fetch(`${GITHUB_API_URL}/user`, {
      headers,
      cache: "no-store",
    })
  )
  const emails = await readJson<GitHubEmail[]>(
    await fetch(`${GITHUB_API_URL}/user/emails`, {
      headers,
      cache: "no-store",
    })
  ).catch(() => [])
  const primaryEmail =
    emails.find((item) => item.primary && item.verified)?.email ??
    emails.find((item) => item.verified)?.email ??
    user.email ??
    null

  return {
    login: user.login ?? null,
    name: user.name ?? null,
    email: primaryEmail,
  }
}

export async function pollCodeBoxGithubDeviceFlow(flowId: string) {
  const flow = getFlows().get(flowId)

  if (!flow) {
    throw new Error("GitHub authorization flow was not found.")
  }

  if (Date.now() > flow.expiresAt) {
    getFlows().delete(flowId)
    return {
      status: "expired" as const,
      message: "GitHub authorization expired.",
    }
  }

  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: getClientId(),
      device_code: flow.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
    cache: "no-store",
  })
  const payload = await readJson<GitHubTokenResponse>(response)

  if ("error" in payload) {
    if (payload.error === "authorization_pending") {
      return { status: "pending" as const, interval: flow.interval }
    }

    if (payload.error === "slow_down") {
      flow.interval = payload.interval ?? flow.interval + 5
      return { status: "pending" as const, interval: flow.interval }
    }

    getFlows().delete(flowId)
    return {
      status: "error" as const,
      message: payload.error_description ?? payload.error,
    }
  }

  const profile = await fetchGithubProfile(payload.access_token)
  const status = saveCodeBoxGithubTokens({
    accessToken: payload.access_token,
    ...profile,
  })

  getFlows().delete(flowId)

  return {
    status: "complete" as const,
    github: status,
  }
}

export function logoutCodeBoxGithub() {
  clearCodeBoxGithubTokens()
}
