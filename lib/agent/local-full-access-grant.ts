import { createHmac, timingSafeEqual } from "node:crypto"

export const STUDIO_LOCAL_FULL_ACCESS_POLICY_VERSION = 2

const LOCAL_FULL_ACCESS_GRANT_VERSION = 1
const LOCAL_FULL_ACCESS_MAX_AGE_MS = 2 * 60 * 1000
const consumedNonces = new Map<string, number>()

type LocalFullAccessGrantPayload = {
  version: typeof LOCAL_FULL_ACCESS_GRANT_VERSION
  policyVersion: typeof STUDIO_LOCAL_FULL_ACCESS_POLICY_VERSION
  sessionId: string
  workspaceId: string | null
  environment: "local"
  deviceId: string
  nonce: string
  issuedAt: number
  expiresAt: number
}

function getSigningKey() {
  const value = process.env.ASTRAFLOW_SECRET_KEY?.trim()

  return value && /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : null
}

function decodePayload(value: string) {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<LocalFullAccessGrantPayload>

    return decoded
  } catch {
    return null
  }
}

function pruneConsumedNonces(now: number) {
  for (const [nonce, expiresAt] of consumedNonces) {
    if (expiresAt <= now) {
      consumedNonces.delete(nonce)
    }
  }
}

export function consumeLocalFullAccessGrant(
  token: string,
  expected: {
    sessionId: string
    workspaceId: string | null
    environment: "local"
    now?: number
  }
) {
  const signingKey = getSigningKey()
  const deviceId = process.env.ASTRAFLOW_DEVICE_ID?.trim()
  const [encodedPayload, encodedSignature, ...extra] = token.split(".")

  if (
    !signingKey ||
    !deviceId ||
    !encodedPayload ||
    !encodedSignature ||
    extra.length > 0
  ) {
    return false
  }

  let providedSignature: Buffer

  try {
    providedSignature = Buffer.from(encodedSignature, "base64url")
  } catch {
    return false
  }

  const expectedSignature = createHmac("sha256", signingKey)
    .update(encodedPayload)
    .digest()

  if (
    providedSignature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return false
  }

  const payload = decodePayload(encodedPayload)
  const now = expected.now ?? Date.now()

  if (
    !payload ||
    payload.version !== LOCAL_FULL_ACCESS_GRANT_VERSION ||
    payload.policyVersion !== STUDIO_LOCAL_FULL_ACCESS_POLICY_VERSION ||
    payload.sessionId !== expected.sessionId ||
    payload.workspaceId !== expected.workspaceId ||
    payload.environment !== expected.environment ||
    payload.deviceId !== deviceId ||
    typeof payload.nonce !== "string" ||
    !/^[a-f0-9]{64}$/i.test(payload.nonce) ||
    typeof payload.issuedAt !== "number" ||
    typeof payload.expiresAt !== "number" ||
    payload.issuedAt > now + 5_000 ||
    payload.expiresAt <= now ||
    payload.expiresAt - payload.issuedAt > LOCAL_FULL_ACCESS_MAX_AGE_MS
  ) {
    return false
  }

  pruneConsumedNonces(now)

  if (consumedNonces.has(payload.nonce)) {
    return false
  }

  consumedNonces.set(payload.nonce, payload.expiresAt)
  return true
}
