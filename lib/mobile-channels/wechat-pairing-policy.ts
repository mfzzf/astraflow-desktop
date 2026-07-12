import { createHash } from "node:crypto"

import type { MobileChannelConnectionRecord } from "./types"

export const WECHAT_QR_STATUSES = [
  "wait",
  "scaned",
  "confirmed",
  "expired",
  "scaned_but_redirect",
  "need_verifycode",
  "verify_code_blocked",
  "binded_redirect",
] as const

export const WECHAT_QR_LIFETIME_SECONDS = 5 * 60
export const WECHAT_QR_LOCAL_EXPIRY_GRACE_SECONDS = 60
export const WECHAT_QR_MAX_REFRESH_ATTEMPTS = 3
export const WECHAT_PAIRING_MAX_LIFETIME_SECONDS =
  WECHAT_QR_LIFETIME_SECONDS * (WECHAT_QR_MAX_REFRESH_ATTEMPTS + 1) +
  WECHAT_QR_LOCAL_EXPIRY_GRACE_SECONDS

export function collectWechatLocalBotTokens(
  connections: readonly MobileChannelConnectionRecord[],
  limit = 10
) {
  const normalizedLimit = Math.max(0, Math.floor(limit))
  if (normalizedLimit === 0) {
    return []
  }

  const tokens: string[] = []
  const seen = new Set<string>()

  for (const connection of [...connections].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  )) {
    if (connection.credentials?.provider !== "wechat") {
      continue
    }

    const token = connection.credentials.token.trim()
    if (!token || seen.has(token)) {
      continue
    }

    seen.add(token)
    tokens.push(token)
    if (tokens.length >= normalizedLimit) {
      break
    }
  }

  return tokens
}

export function nextWechatQrRefreshAttempt(completedRefreshes: number) {
  return completedRefreshes < WECHAT_QR_MAX_REFRESH_ATTEMPTS
    ? completedRefreshes + 1
    : null
}

export function fingerprintWechatQr(qrcode: string) {
  return createHash("sha256").update(qrcode).digest("hex").slice(0, 12)
}
