import assert from "node:assert/strict"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

// Bun cannot load better-sqlite3 yet. These integration tests run under Node
// (for example: `bunx tsx --test tests/mobile-channel-pairing-store.test.ts`).
const sqliteTest = process.versions.bun ? test.skip : test

const databaseDirectory = mkdtempSync(join(tmpdir(), "astraflow-pairing-test-"))
process.env.ASTRAFLOW_SQLITE_PATH = join(databaseDirectory, "pairing.sqlite")

const {
  createMobileChannelPairing,
  finalizeMobileChannelBinding,
  finalizeOwnedMobileChannelPairing,
  getMobileChannelConnectionByProvider,
  getMobileChannelPairing,
  listMobileChannelBindingsForConnection,
  resolveMobileChannelBindCode,
  saveMobileChannelBinding,
  saveMobileChannelConnection,
  stageMobileChannelPairingReplacement,
  updateMobileChannelConnectionMetadata,
  updateMobileChannelPairing,
} = await import("../lib/mobile-channels/store")

function futureIso(seconds: number) {
  return new Date(Date.now() + seconds * 1_000).toISOString()
}

sqliteTest("terminal pairing states cannot be revived by late success", () => {
  const issuedAt = new Date().toISOString()
  const stepExpiresAt = futureIso(300)
  const pairing = createMobileChannelPairing({
    provider: "wechat",
    status: "waiting_scan",
    issuedAt,
    stepExpiresAt,
    expiresAt: futureIso(1_200),
    expirySource: "provider_policy",
    remoteStatus: "wait",
  })

  const expired = updateMobileChannelPairing(pairing.id, {
    status: "expired",
    failureCode: "provider_qr_expired",
    message: "二维码已过期。",
  })
  const lateSuccess = updateMobileChannelPairing(pairing.id, {
    status: "connected",
    remoteStatus: "confirmed",
    message: "迟到的成功。",
  })

  assert.equal(expired?.status, "expired")
  assert.equal(lateSuccess?.status, "expired")
  assert.equal(lateSuccess?.failureCode, "provider_qr_expired")
  assert.equal(lateSuccess?.issuedAt, issuedAt)
  assert.equal(lateSuccess?.stepExpiresAt, stepExpiresAt)
  assert.equal(lateSuccess?.expirySource, "provider_policy")
  assert.ok(Date.parse(lateSuccess?.serverTime ?? "") > 0)
})

sqliteTest(
  "changing Telegram bots clears the previous bot update offset",
  () => {
    saveMobileChannelConnection({
      provider: "telegram",
      displayName: "Telegram",
      credentials: {
        provider: "telegram",
        botToken: "123:first-token",
        botUsername: "first_bot",
        ownerUserId: null,
      },
      accountId: "123",
      metadata: { telegramUpdateOffset: 9_999, chatModel: "gpt-test" },
      ownerExternalUserId: null,
      defaultProjectId: null,
    })
    saveMobileChannelConnection({
      provider: "telegram",
      displayName: "Telegram",
      credentials: {
        provider: "telegram",
        botToken: "456:second-token",
        botUsername: "second_bot",
        ownerUserId: null,
      },
      accountId: "456",
      ownerExternalUserId: null,
      defaultProjectId: null,
    })

    const connection = getMobileChannelConnectionByProvider("telegram")
    assert.equal(connection?.metadata.telegramUpdateOffset, undefined)
    assert.equal(connection?.metadata.chatModel, "gpt-test")

    updateMobileChannelConnectionMetadata(connection!.id, {
      telegramUpdateOffset: 123,
    })
    saveMobileChannelConnection({
      provider: "telegram",
      displayName: "Telegram",
      credentials: {
        provider: "telegram",
        botToken: "456:rotated-second-token",
        botUsername: "second_bot",
        ownerUserId: null,
      },
      accountId: "456",
      ownerExternalUserId: null,
      defaultProjectId: null,
    })
    assert.equal(
      getMobileChannelConnectionByProvider("telegram")?.metadata
        .telegramUpdateOffset,
      123
    )
  }
)

sqliteTest(
  "owned-channel readiness and pairing success finalize atomically",
  () => {
    const connection = getMobileChannelConnectionByProvider("telegram")
    assert.ok(connection)
    updateMobileChannelConnectionMetadata(connection!.id, {
      bindingPending: false,
      pendingPairingAttemptId: "owned-attempt",
    })
    const pairing = createMobileChannelPairing({
      provider: "telegram",
      status: "validating",
      issuedAt: new Date().toISOString(),
      stepExpiresAt: futureIso(120),
      expiresAt: futureIso(120),
      expirySource: "local_validation",
      remoteStatus: "validating_runtime",
    })
    updateMobileChannelPairing(pairing.id, {
      connectionId: connection!.id,
    })

    const rejected = finalizeOwnedMobileChannelPairing({
      pairingId: pairing.id,
      connectionId: connection!.id,
      pairingAttemptId: "stale-attempt",
    })
    assert.equal(rejected, null)
    assert.equal(
      getMobileChannelConnectionByProvider("telegram")?.metadata
        .pendingPairingAttemptId,
      "owned-attempt"
    )

    const finalized = finalizeOwnedMobileChannelPairing({
      pairingId: pairing.id,
      connectionId: connection!.id,
      pairingAttemptId: "owned-attempt",
    })

    assert.equal(finalized?.pairing.status, "connected")
    assert.equal(finalized?.pairing.remoteStatus, "outbound_verified")
    assert.equal(finalized?.pairing.expirySource, null)
    assert.equal(finalized?.connection.bindingPending, false)
    assert.equal(finalized?.connection.metadata.pendingPairingAttemptId, null)
  }
)

sqliteTest(
  "binding, connection readiness, and pairing completion finalize atomically",
  () => {
    const connection = getMobileChannelConnectionByProvider("telegram")
    assert.ok(connection)
    updateMobileChannelConnectionMetadata(connection!.id, {
      bindingPending: true,
      pendingPairingAttemptId: "attempt-1",
    })
    const pairing = createMobileChannelPairing({
      provider: "telegram",
      status: "awaiting_bind",
      issuedAt: new Date().toISOString(),
      stepExpiresAt: futureIso(600),
      expiresAt: futureIso(600),
      expirySource: "local_binding",
    })
    updateMobileChannelPairing(pairing.id, {
      connectionId: connection!.id,
      bindCode: "ABC234",
    })

    const resolved = resolveMobileChannelBindCode({
      connectionId: connection!.id,
      code: "ABC234",
    })
    assert.equal(resolved?.status, "awaiting_bind")
    assert.equal(resolved?.bindCommand, "/bind ABC234")

    const rejected = finalizeMobileChannelBinding({
      pairingId: pairing.id,
      connectionId: connection!.id,
      code: "WRONG2",
      externalUserId: "telegram-user",
      conversationId: "telegram-chat",
    })
    assert.equal(rejected, null)
    assert.equal(
      getMobileChannelConnectionByProvider("telegram")?.bindingPending,
      true
    )

    const finalized = finalizeMobileChannelBinding({
      pairingId: pairing.id,
      connectionId: connection!.id,
      code: "ABC234",
      externalUserId: "telegram-user",
      conversationId: "telegram-chat",
    })
    assert.equal(finalized?.pairing.status, "connected")
    assert.equal(finalized?.pairing.bindCommand, null)
    assert.equal(finalized?.pairing.retryable, false)
    assert.equal(finalized?.pairing.issuedAt, null)
    assert.equal(finalized?.pairing.stepExpiresAt, null)
    assert.equal(finalized?.pairing.expirySource, null)
    assert.equal(finalized?.connection.bindingPending, false)
    assert.equal(finalized?.connection.metadata.pendingPairingAttemptId, null)
    assert.equal(finalized?.binding.externalUserId, "telegram-user")
  }
)

sqliteTest(
  "replacement bindings stay intact until the new bind finalizes",
  () => {
    const previous = saveMobileChannelConnection({
      provider: "wecom",
      displayName: "WeCom",
      credentials: {
        provider: "wecom",
        botId: "old-bot",
        secret: "old-secret",
      },
      accountId: "old-bot",
      ownerExternalUserId: null,
      metadata: { updatesBuffer: "old-cursor" },
      defaultProjectId: null,
    })
    assert.ok(previous)
    saveMobileChannelBinding({
      connectionId: previous!.id,
      externalUserId: "old-user",
      conversationId: "old-chat",
    })

    const pairing = createMobileChannelPairing({
      provider: "wecom",
      status: "validating",
      expiresAt: futureIso(600),
    })
    const replacement = saveMobileChannelConnection({
      provider: "wecom",
      displayName: "WeCom",
      credentials: {
        provider: "wecom",
        botId: "new-bot",
        secret: "new-secret",
      },
      accountId: "new-bot",
      ownerExternalUserId: null,
      metadata: {
        bindingPending: true,
        pendingBindingReset: true,
        pendingPairingAttemptId: "replacement-attempt",
      },
      defaultProjectId: null,
    })
    assert.ok(replacement)
    assert.equal(
      stageMobileChannelPairingReplacement({
        pairingId: pairing.id,
        attemptId: "replacement-attempt",
        replacementConnectionId: replacement!.id,
        previous,
      }),
      true
    )
    updateMobileChannelPairing(pairing.id, {
      status: "awaiting_bind",
      bindCode: "NEW234",
    })

    assert.deepEqual(
      listMobileChannelBindingsForConnection(replacement!.id).map(
        (binding) => binding.externalUserId
      ),
      ["old-user"]
    )

    const finalized = finalizeMobileChannelBinding({
      pairingId: pairing.id,
      connectionId: replacement!.id,
      code: "NEW234",
      externalUserId: "new-user",
      conversationId: "new-chat",
    })
    assert.equal(finalized?.pairing.status, "connected")
    assert.deepEqual(
      listMobileChannelBindingsForConnection(replacement!.id).map(
        (binding) => binding.externalUserId
      ),
      ["new-user"]
    )
    assert.equal(finalized?.connection.metadata.pendingBindingReset, null)
  }
)

sqliteTest(
  "an expired bind restores the previous connection and runtime cursors",
  () => {
    const previous = saveMobileChannelConnection({
      provider: "discord",
      displayName: "Discord",
      credentials: {
        provider: "discord",
        applicationId: "123456789012345678",
        botToken: "old-token-that-is-long-enough-for-validation",
        ownerUserId: null,
      },
      accountId: "123456789012345678",
      ownerExternalUserId: null,
      metadata: {
        telegramUpdateOffset: 778,
        updatesBuffer: "old-sync-cursor",
        usageGuideSentAt: "2026-07-12T00:00:00.000Z",
      },
      defaultProjectId: null,
    })
    assert.ok(previous)

    const pairing = createMobileChannelPairing({
      provider: "discord",
      status: "validating",
      expiresAt: futureIso(600),
    })
    const replacement = saveMobileChannelConnection({
      provider: "discord",
      displayName: "Discord",
      credentials: {
        provider: "discord",
        applicationId: "987654321098765432",
        botToken: "new-token-that-is-long-enough-for-validation",
        ownerUserId: null,
      },
      accountId: "987654321098765432",
      ownerExternalUserId: null,
      metadata: {
        ...previous!.metadata,
        bindingPending: true,
        pendingBindingReset: true,
        pendingPairingAttemptId: "expiring-attempt",
      },
      defaultProjectId: null,
    })
    assert.ok(replacement)
    assert.equal(
      replacement!.metadata.telegramUpdateOffset,
      undefined,
      "the replacement must not inherit the old bot cursor"
    )
    assert.equal(
      stageMobileChannelPairingReplacement({
        pairingId: pairing.id,
        attemptId: "expiring-attempt",
        replacementConnectionId: replacement!.id,
        previous,
      }),
      true
    )
    const recoveryCalls: [string, string][] = []
    const previousRecoveryHook =
      globalThis.astraflowMobileChannelRuntimeRecoveryHook
    globalThis.astraflowMobileChannelRuntimeRecoveryHook = (
      connectionId,
      reason
    ) => recoveryCalls.push([connectionId, reason])
    try {
      updateMobileChannelPairing(pairing.id, {
        status: "awaiting_bind",
        bindCode: "OLD234",
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      })
      const expired = getMobileChannelPairing(pairing.id)
      const restored = getMobileChannelConnectionByProvider("discord")
      assert.equal(expired?.status, "expired")
      assert.equal(restored?.accountId, "123456789012345678")
      assert.equal(restored?.metadata.telegramUpdateOffset, 778)
      assert.equal(restored?.metadata.updatesBuffer, "old-sync-cursor")
      assert.equal(
        restored?.metadata.usageGuideSentAt,
        "2026-07-12T00:00:00.000Z"
      )
      assert.equal(restored?.bindingPending, false)
      assert.deepEqual(recoveryCalls, [
        [replacement!.id, "pairing-replacement-rollback"],
      ])
    } finally {
      globalThis.astraflowMobileChannelRuntimeRecoveryHook =
        previousRecoveryHook
    }
  }
)

sqliteTest("an expired first-time bind removes the unbound replacement", () => {
  const pairing = createMobileChannelPairing({
    provider: "dingtalk",
    status: "validating",
    expiresAt: futureIso(600),
  })
  const replacement = saveMobileChannelConnection({
    provider: "dingtalk",
    displayName: "DingTalk",
    credentials: {
      provider: "dingtalk",
      clientId: "first-client",
      clientSecret: "first-secret",
    },
    accountId: "first-client",
    ownerExternalUserId: null,
    metadata: {
      bindingPending: true,
      pendingBindingReset: false,
      pendingPairingAttemptId: "first-attempt",
    },
    defaultProjectId: null,
  })
  assert.ok(replacement)
  assert.equal(
    stageMobileChannelPairingReplacement({
      pairingId: pairing.id,
      attemptId: "first-attempt",
      replacementConnectionId: replacement!.id,
      previous: null,
    }),
    true
  )
  const recoveryCalls: [string, string][] = []
  const previousRecoveryHook =
    globalThis.astraflowMobileChannelRuntimeRecoveryHook
  globalThis.astraflowMobileChannelRuntimeRecoveryHook = (
    connectionId,
    reason
  ) => recoveryCalls.push([connectionId, reason])
  try {
    updateMobileChannelPairing(pairing.id, {
      status: "awaiting_bind",
      bindCode: "NEW567",
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
    })
    const expired = getMobileChannelPairing(pairing.id)
    assert.equal(expired?.status, "expired")
    assert.equal(expired?.connectionId, null)
    assert.equal(getMobileChannelConnectionByProvider("dingtalk"), null)
    assert.deepEqual(recoveryCalls, [
      [replacement!.id, "pairing-replacement-rollback"],
    ])
  } finally {
    globalThis.astraflowMobileChannelRuntimeRecoveryHook = previousRecoveryHook
  }
})
