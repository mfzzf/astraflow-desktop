import assert from "node:assert/strict"
import test from "node:test"

import type { MobileChannelConnectionRecord } from "../lib/mobile-channels/types"
import {
  collectWechatLocalBotTokens,
  fingerprintWechatQr,
  nextWechatQrRefreshAttempt,
  WECHAT_QR_MAX_REFRESH_ATTEMPTS,
  WECHAT_QR_STATUSES,
} from "../lib/mobile-channels/wechat-pairing-policy"

function connection({
  id,
  provider = "wechat",
  token,
  updatedAt,
}: {
  id: string
  provider?: "wechat" | "wecom"
  token: string
  updatedAt: string
}): MobileChannelConnectionRecord {
  return {
    id,
    provider,
    displayName: provider,
    status: "connected",
    enabled: true,
    configured: true,
    accountId: id,
    ownerExternalUserId: null,
    credentials:
      provider === "wechat"
        ? {
            provider,
            accountId: id,
            token,
            baseUrl: "https://ilinkai.weixin.qq.com/",
            userId: null,
          }
        : { provider, botId: id, secret: token },
    metadata: {},
    defaultProjectId: null,
    replyGranularity: "standard",
    agentRuntimeId: null,
    chatModel: null,
    reasoningEffort: null,
    permissionMode: "auto",
    bindingPending: false,
    lastError: null,
    connectedAt: null,
    lastEventAt: null,
    createdAt: updatedAt,
    updatedAt,
  }
}

test("WeChat QR requests include the newest unique local bot tokens only", () => {
  const connections = [
    connection({
      id: "old",
      token: "old-token",
      updatedAt: "2026-07-10T00:00:00.000Z",
    }),
    connection({
      id: "new",
      token: "new-token",
      updatedAt: "2026-07-12T00:00:00.000Z",
    }),
    connection({
      id: "duplicate",
      token: "new-token",
      updatedAt: "2026-07-11T00:00:00.000Z",
    }),
    connection({
      id: "wecom",
      provider: "wecom",
      token: "wecom-secret",
      updatedAt: "2026-07-13T00:00:00.000Z",
    }),
  ]

  assert.deepEqual(collectWechatLocalBotTokens(connections), [
    "new-token",
    "old-token",
  ])
  assert.deepEqual(collectWechatLocalBotTokens(connections, 1), ["new-token"])
})

test("WeChat QR refreshes stop at the configured retry limit", () => {
  assert.equal(nextWechatQrRefreshAttempt(0), 1)
  assert.equal(
    nextWechatQrRefreshAttempt(WECHAT_QR_MAX_REFRESH_ATTEMPTS - 1),
    WECHAT_QR_MAX_REFRESH_ATTEMPTS
  )
  assert.equal(nextWechatQrRefreshAttempt(WECHAT_QR_MAX_REFRESH_ATTEMPTS), null)
})

test("WeChat pairing recognizes every documented QR status", () => {
  assert.deepEqual(WECHAT_QR_STATUSES, [
    "wait",
    "scaned",
    "confirmed",
    "expired",
    "scaned_but_redirect",
    "need_verifycode",
    "verify_code_blocked",
    "binded_redirect",
  ])
})

test("WeChat QR logs use a stable fingerprint instead of the raw ticket", () => {
  const fingerprint = fingerprintWechatQr("sensitive-qr-ticket")

  assert.equal(fingerprint.length, 12)
  assert.equal(fingerprint, fingerprintWechatQr("sensitive-qr-ticket"))
  assert.notEqual(fingerprint, "sensitive-qr-ticket")
})
