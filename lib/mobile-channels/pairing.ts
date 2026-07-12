import "server-only"

import { randomBytes } from "node:crypto"
import { registerApp } from "@larksuiteoapi/node-sdk"
import QRCode from "qrcode"
import { z } from "zod"

import { delay, errorMessage, fetchJson, postJson } from "./http"
import { discordBotInstallUrl } from "./providers/discord-protocol"
import { telegramBotDeepLink } from "./providers/telegram-protocol"
import {
  cancelActiveMobileChannelPairings,
  clearMobileChannelPairingReplacement,
  createMobileChannelPairing,
  deleteMobileChannelConnection,
  finalizeOwnedMobileChannelPairing,
  getMobileChannelConnectionByProvider,
  getMobileChannelPairing,
  getLatestMobileChannelPairing,
  isActiveMobileChannelPairingStatus,
  listMobileChannelBindingsForConnection,
  listMobileChannelConnectionRecords,
  restoreMobileChannelPairingReplacement,
  saveMobileChannelConnection,
  stageMobileChannelPairingReplacement,
  updateMobileChannelConnectionMetadata,
  updateMobileChannelConnectionSettings,
  updateMobileChannelConnectionState,
  updateMobileChannelPairing,
} from "./store"
import {
  mobileChannelProviderLabels,
  mobileChannelProviders,
  type DingtalkMobileChannelCredentials,
  type DiscordMobileChannelCredentials,
  type FeishuMobileChannelCredentials,
  type LarkMobileChannelCredentials,
  type MobileChannelCredentials,
  type MobileChannelConnectionRecord,
  type MobileChannelPairing,
  type MobileChannelProvider,
  type MobileChannelOutboundTarget,
  type TelegramMobileChannelCredentials,
  type WechatMobileChannelCredentials,
  type WecomMobileChannelCredentials,
} from "./types"
import {
  getMobileChannelUsageGuide,
  MOBILE_CHANNEL_USAGE_GUIDE_SENT_AT_METADATA_KEY,
} from "./usage-guide"
import {
  collectWechatLocalBotTokens,
  fingerprintWechatQr,
  nextWechatQrRefreshAttempt,
  WECHAT_PAIRING_MAX_LIFETIME_SECONDS,
  WECHAT_QR_LIFETIME_SECONDS,
  WECHAT_QR_MAX_REFRESH_ATTEMPTS,
  WECHAT_QR_STATUSES,
} from "./wechat-pairing-policy"

type PairingProcess = {
  attemptId: string
  controller: AbortController
  lastWechatStatus: string | null
  networkFailureCount: number
  networkFailureStartedAt: number | null
  verificationCode: string | null
}

class PairingFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = true,
    readonly status: "error" | "expired" | "cancelled" = "error"
  ) {
    super(message)
    this.name = "PairingFailure"
  }
}

function pairingFailure(
  code: string,
  message: string,
  options: {
    retryable?: boolean
    status?: "error" | "expired" | "cancelled"
  } = {}
) {
  return new PairingFailure(
    code,
    message,
    options.retryable ?? true,
    options.status ?? "error"
  )
}

function pairingFailureFromUnknown(error: unknown) {
  if (error instanceof PairingFailure) {
    return error
  }

  const record =
    typeof error === "object" && error !== null
      ? (error as Record<string, unknown>)
      : null
  const platformCode =
    typeof record?.code === "string" ? record.code.toLowerCase() : null
  const message = errorMessage(error)

  switch (platformCode) {
    case "access_denied":
      return pairingFailure("user_denied", "用户已取消或拒绝平台授权。", {
        status: "cancelled",
      })
    case "expired_token":
      return pairingFailure("provider_qr_expired", "平台授权二维码已过期。", {
        status: "expired",
      })
    case "abort":
    case "cancelled":
      return pairingFailure("user_cancelled", "本次平台授权已取消。", {
        status: "cancelled",
      })
    default:
      break
  }

  if (error instanceof z.ZodError) {
    return pairingFailure(
      "invalid_platform_response",
      "平台返回了无法识别的数据，请更新客户端后重试。",
      { retryable: false }
    )
  }
  if (/timed?\s*out|超时/i.test(message)) {
    return pairingFailure("connection_timeout", message)
  }
  if (/401|unauth|invalid.+token|credential|secret/i.test(message)) {
    return pairingFailure("credential_rejected", message, {
      retryable: false,
    })
  }
  if (/403|access denied|permission|权限/i.test(message)) {
    return pairingFailure("permission_denied", message, { retryable: false })
  }
  if (
    /network|fetch failed|socket|econn|enotfound|gateway|5\d\d/i.test(message)
  ) {
    return pairingFailure("network_error", message)
  }

  return pairingFailure(platformCode || "pairing_failed", message)
}

function isTransientPairingError(error: unknown) {
  if (isAbortError(error)) {
    return true
  }
  if (error instanceof z.ZodError) {
    return false
  }

  const message = errorMessage(error)
  const httpStatus = /Remote service returned (\d{3})/.exec(message)?.[1]
  if (httpStatus) {
    const status = Number(httpStatus)
    return [408, 425, 429].includes(status) || status >= 500
  }

  return /network|fetch failed|socket|econn|enotfound|gateway|temporar/i.test(
    message
  )
}

declare global {
  var astraflowMobileChannelPairingProcesses:
    Map<string, PairingProcess> | undefined
}

const WECHAT_BASE_URL = "https://ilinkai.weixin.qq.com"
const WECOM_QR_BASE_URL = "https://work.weixin.qq.com/ai/qc"
const DINGTALK_REGISTRATION_BASE_URL =
  process.env.ASTRAFLOW_DINGTALK_REGISTRATION_BASE_URL?.trim() ||
  "https://oapi.dingtalk.com"
const LARK_ACCOUNTS_DOMAIN = "accounts.larksuite.com"
const LOCAL_VALIDATION_TTL_SECONDS = 2 * 60
const LOCAL_BINDING_TTL_SECONDS = 10 * 60
const WECOM_QR_TTL_SECONDS = 5 * 60
const PAIRING_NETWORK_RETRY_LIMIT_MS = 2 * 60 * 1_000

const wechatQrSchema = z.object({
  qrcode: z.string().min(1),
  qrcode_img_content: z.string().url(),
})

const wechatQrStatusSchema = z.object({
  status: z.enum(WECHAT_QR_STATUSES),
  bot_token: z.string().optional(),
  ilink_bot_id: z.string().optional(),
  baseurl: z.string().optional(),
  ilink_user_id: z.string().optional(),
  redirect_host: z.string().optional(),
})

const wecomQrSchema = z.object({
  data: z.object({
    scode: z.string().min(1),
    auth_url: z.string().url(),
  }),
})

const wecomQrStatusSchema = z.object({
  data: z
    .object({
      status: z.string().max(100).optional(),
      message: z.string().max(500).optional(),
      error: z.string().max(500).optional(),
      bot_info: z
        .object({
          botid: z.string().min(1),
          secret: z.string().min(1),
        })
        .optional(),
    })
    .optional(),
})

const dingtalkApiBaseSchema = z.object({
  errcode: z.number(),
  errmsg: z.string().optional(),
})

const dingtalkInitSchema = dingtalkApiBaseSchema.extend({
  nonce: z.string().optional(),
  expires_in: z.number().optional(),
})

const dingtalkBeginSchema = dingtalkApiBaseSchema.extend({
  device_code: z.string().optional(),
  verification_uri_complete: z.string().url().optional(),
  expires_in: z.number().optional(),
  interval: z.number().optional(),
})

const dingtalkPollSchema = dingtalkApiBaseSchema.extend({
  status: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  fail_reason: z.string().optional(),
})

const telegramGetMeSchema = z.object({
  ok: z.boolean(),
  description: z.string().optional(),
  result: z
    .object({
      id: z.number(),
      is_bot: z.boolean(),
      username: z.string().optional(),
    })
    .optional(),
})

const discordApplicationSchema = z.object({
  id: z.string().regex(/^\d{16,22}$/),
  name: z.string().optional(),
})

function getPairingProcesses() {
  if (!globalThis.astraflowMobileChannelPairingProcesses) {
    globalThis.astraflowMobileChannelPairingProcesses = new Map()
  }

  return globalThis.astraflowMobileChannelPairingProcesses
}

function isCurrentPairingProcess(
  pairingId: string,
  pairingProcess: PairingProcess
) {
  return (
    !pairingProcess.controller.signal.aborted &&
    getPairingProcesses().get(pairingId) === pairingProcess
  )
}

function getActivePairingForProcess(
  pairingId: string,
  pairingProcess: PairingProcess
) {
  if (!isCurrentPairingProcess(pairingId, pairingProcess)) {
    return null
  }
  const pairing = getMobileChannelPairing(pairingId)
  return pairing && isActiveMobileChannelPairingStatus(pairing.status)
    ? pairing
    : null
}

function releasePairingProcess(
  pairingId: string,
  pairingProcess: PairingProcess
) {
  if (getPairingProcesses().get(pairingId) === pairingProcess) {
    getPairingProcesses().delete(pairingId)
  }
}

function stopPairingProcess(pairingId: string, pairingProcess: PairingProcess) {
  pairingProcess.controller.abort()
  releasePairingProcess(pairingId, pairingProcess)
}

const pairingStatusesRequiringLiveProcess = new Set([
  "preparing",
  "refreshing",
  "waiting_scan",
  "scanned",
  "verification_required",
  "waiting_confirmation",
  "validating",
])

function reconcileOrphanedPairing(pairing: MobileChannelPairing | null) {
  const process = pairing ? getPairingProcesses().get(pairing.id) : null
  if (
    pairing &&
    !isActiveMobileChannelPairingStatus(pairing.status) &&
    process
  ) {
    process.controller.abort()
    releasePairingProcess(pairing.id, process)
    return pairing
  }
  if (
    !pairing ||
    !pairingStatusesRequiringLiveProcess.has(pairing.status) ||
    getPairingProcesses().has(pairing.id)
  ) {
    return pairing
  }

  const failedPairing = updateMobileChannelPairing(pairing.id, {
    status: "error",
    qrPayload: null,
    qrCodeDataUrl: null,
    stepExpiresAt: null,
    remoteStatus: "process_lost",
    failureCode: "desktop_process_restarted",
    retryable: true,
    error: "桌面服务已重启，本次二维码已失效。",
    message: "桌面服务已重启，请重新生成二维码。",
  })
  if (failedPairing) {
    restoreMobileChannelPairingReplacement(pairing.id)
  }
  return getMobileChannelPairing(pairing.id)
}

export function getManagedMobileChannelPairing(pairingId: string) {
  return reconcileOrphanedPairing(getMobileChannelPairing(pairingId))
}

export function reconcileOrphanedMobileChannelPairings() {
  return mobileChannelProviders.map((provider) =>
    reconcileOrphanedPairing(getLatestMobileChannelPairing(provider))
  )
}

function safeUrlHost(value: string) {
  try {
    return new URL(value).host
  } catch {
    return "invalid"
  }
}

function logWechatPairingEvent({
  event,
  pairingId,
  pairingProcess,
  qrcode,
  details,
}: {
  event: string
  pairingId: string
  pairingProcess: PairingProcess
  qrcode?: string
  details?: Record<string, unknown>
}) {
  console.info("[mobile-channels] wechat_pairing", {
    at: new Date().toISOString(),
    event,
    pairingId,
    attemptId: pairingProcess.attemptId,
    ...(qrcode ? { qrFingerprint: fingerprintWechatQr(qrcode) } : {}),
    ...details,
  })
}

function qrDataUrl(payload: string) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 560,
    color: { dark: "#101312", light: "#FFFFFF" },
  })
}

function expiresAt(seconds: number, issuedAtMs = Date.now()) {
  return new Date(issuedAtMs + Math.max(0, seconds) * 1_000).toISOString()
}

function pairingStepTiming(seconds: number) {
  const issuedAtMs = Date.now()
  return {
    issuedAt: new Date(issuedAtMs).toISOString(),
    stepExpiresAt: expiresAt(seconds, issuedAtMs),
  }
}

function generateBindCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  const bytes = randomBytes(6)

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")
}

function ownerUsageGuideTarget({
  connectionId,
  provider,
  ownerExternalUserId,
}: {
  connectionId: string
  provider: MobileChannelProvider
  ownerExternalUserId: string
}): MobileChannelOutboundTarget | null {
  const base = {
    connectionId,
    provider,
    externalUserId: ownerExternalUserId,
    conversationId: ownerExternalUserId,
  }

  switch (provider) {
    case "wechat":
      return {
        ...base,
        provider,
        replyContext: { provider, contextToken: null },
      }
    case "feishu":
    case "lark":
      return {
        ...base,
        provider,
        replyContext: { provider, replyToMessageId: null },
      }
    default:
      return null
  }
}

function isAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      error.message.toLowerCase().includes("abort"))
  )
}

function normalizeBaseUrl(value: string | undefined) {
  const candidate = value?.trim() || WECHAT_BASE_URL
  const withProtocol = /^https?:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`

  const normalized = new URL(withProtocol).toString()
  return normalized.endsWith("/") ? normalized : `${normalized}/`
}

function wechatHeaders(token?: string) {
  const uin = randomBytes(4).readUInt32BE(0)
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    AuthorizationType: "ilink_bot_token",
    "X-WECHAT-UIN": Buffer.from(String(uin), "utf8").toString("base64"),
    "iLink-App-Id": "bot",
    "iLink-App-ClientVersion": "65796",
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  return headers
}

async function restorePreviousMobileConnection({
  previous,
  pairingId,
  replacementAttemptId,
  replacementProvider,
  replacementConnectionId,
  replacementAccountId,
}: {
  previous: MobileChannelConnectionRecord | null
  pairingId: string
  replacementAttemptId: string
  replacementProvider: MobileChannelProvider
  replacementConnectionId: string
  replacementAccountId: string | null
}) {
  const isOwnedReplacement = () => {
    const current = getMobileChannelConnectionByProvider(replacementProvider)
    return Boolean(
      current &&
      current.id === replacementConnectionId &&
      current.accountId === replacementAccountId &&
      current.metadata.pendingPairingAttemptId === replacementAttemptId
    )
  }
  if (!isOwnedReplacement()) return

  const { connectMobileChannel, disconnectMobileChannel } =
    await import("./runtime")

  // A newer pairing may have replaced the credentials while the runtime
  // module was loading. Never let an older attempt roll it back.
  if (!isOwnedReplacement()) return
  await disconnectMobileChannel(replacementConnectionId).catch(() => undefined)
  if (!isOwnedReplacement()) return
  if (!previous?.credentials) {
    updateMobileChannelPairing(pairingId, { connectionId: null })
    deleteMobileChannelConnection(replacementConnectionId)
    clearMobileChannelPairingReplacement(pairingId)
    return
  }

  const restored = saveMobileChannelConnection({
    provider: previous.provider,
    displayName: previous.displayName,
    credentials: previous.credentials,
    accountId: previous.accountId,
    ownerExternalUserId: previous.ownerExternalUserId,
    metadata: previous.metadata,
    defaultProjectId: previous.defaultProjectId,
    preserveAccountRuntimeMetadata: true,
  })
  if (!restored) {
    throw new Error("旧机器人配置恢复失败。")
  }

  updateMobileChannelConnectionSettings(restored.id, {
    enabled: previous.enabled,
    defaultProjectId: previous.defaultProjectId,
    replyGranularity: previous.replyGranularity,
    agentRuntimeId: previous.agentRuntimeId,
    chatModel: previous.chatModel,
    reasoningEffort: previous.reasoningEffort,
    permissionMode: previous.permissionMode,
  })
  clearMobileChannelPairingReplacement(pairingId)
  if (previous.enabled) {
    await connectMobileChannel(restored.id)
  } else {
    updateMobileChannelConnectionState(restored.id, {
      status: "disconnected",
      lastError: previous.lastError,
      connectedAt: previous.connectedAt,
      lastEventAt: previous.lastEventAt,
    })
  }
}

async function completePairing({
  pairingId,
  pairingProcess,
  credentials,
  accountId,
  ownerExternalUserId,
  defaultProjectId,
  bindingQrPayload,
  bindingMessage,
}: {
  pairingId: string
  pairingProcess: PairingProcess
  credentials: MobileChannelCredentials
  accountId: string | null
  ownerExternalUserId: string | null
  defaultProjectId: string | null
  bindingQrPayload?: (bindCode: string) => string
  bindingMessage?: string
}) {
  if (!getActivePairingForProcess(pairingId, pairingProcess)) {
    stopPairingProcess(pairingId, pairingProcess)
    return
  }

  const provider = credentials.provider
  const previousConnection = getMobileChannelConnectionByProvider(provider)
  const requiresBotBinding = !ownerExternalUserId
  const accountChanged = Boolean(
    previousConnection && previousConnection.accountId !== accountId
  )
  const hasUsableExistingBinding = Boolean(
    requiresBotBinding &&
    previousConnection &&
    !previousConnection.bindingPending &&
    !accountChanged &&
    listMobileChannelBindingsForConnection(previousConnection.id).length > 0
  )
  const bindingPending = requiresBotBinding && !hasUsableExistingBinding
  const bindCode = requiresBotBinding ? generateBindCode() : null
  const qrPayload =
    bindCode && bindingQrPayload ? bindingQrPayload(bindCode) : null
  const qrCodeDataUrl = qrPayload ? await qrDataUrl(qrPayload) : null

  if (!getActivePairingForProcess(pairingId, pairingProcess)) {
    stopPairingProcess(pairingId, pairingProcess)
    return
  }

  const validationTiming = pairingStepTiming(LOCAL_VALIDATION_TTL_SECONDS)
  const validatingPairing = updateMobileChannelPairing(pairingId, {
    status: "validating",
    issuedAt: validationTiming.issuedAt,
    stepExpiresAt: validationTiming.stepExpiresAt,
    expiresAt: validationTiming.stepExpiresAt,
    expirySource: "local_validation",
    remoteStatus: "credentials_received",
    failureCode: null,
    retryable: true,
    message: "平台授权已完成，正在验证机器人凭据和连接能力…",
    error: null,
  })
  if (
    validatingPairing?.status !== "validating" ||
    !isCurrentPairingProcess(pairingId, pairingProcess)
  ) {
    pairingProcess.controller.abort()
    releasePairingProcess(pairingId, pairingProcess)
    return
  }

  let connection: MobileChannelConnectionRecord | null = null
  let runtime: typeof import("./runtime") | null = null
  let previousDisconnected = false
  let completed = false
  try {
    runtime = await import("./runtime")
    if (previousConnection?.enabled) {
      // The connection row is unique per provider. Stop any in-flight adapter
      // before replacing its credentials so a stale connect promise cannot be
      // mistaken for validation of the new credentials.
      previousDisconnected = true
      await runtime.disconnectMobileChannel(previousConnection.id)
      if (!getActivePairingForProcess(pairingId, pairingProcess)) {
        throw pairingFailure(
          "pairing_superseded",
          "本次绑定已被新的请求替代。",
          { status: "cancelled" }
        )
      }
    }

    connection = saveMobileChannelConnection({
      provider,
      displayName: mobileChannelProviderLabels[provider],
      credentials,
      accountId,
      ownerExternalUserId,
      metadata: {
        ...(previousConnection?.metadata ?? {}),
        bindingPending,
        pendingBindingReset: accountChanged,
        pendingPairingAttemptId: pairingProcess.attemptId,
      },
      defaultProjectId,
    })
    if (!connection) {
      throw new Error("Unable to save the mobile connection.")
    }
    if (
      !stageMobileChannelPairingReplacement({
        pairingId,
        attemptId: pairingProcess.attemptId,
        replacementConnectionId: connection.id,
        previous: previousConnection,
      })
    ) {
      throw pairingFailure(
        "pairing_not_active",
        "绑定流程已结束，未启用新的机器人。"
      )
    }

    updateMobileChannelPairing(pairingId, {
      connectionId: connection.id,
      status: "validating",
      remoteStatus: "validating_runtime",
      message: "机器人凭据已保存，正在验证平台连接…",
    })
    if (!getActivePairingForProcess(pairingId, pairingProcess)) {
      throw pairingFailure("pairing_superseded", "本次绑定已被新的请求替代。", {
        status: "cancelled",
      })
    }

    await runtime.connectMobileChannel(connection.id)

    if (!getActivePairingForProcess(pairingId, pairingProcess)) {
      throw pairingFailure("pairing_superseded", "本次绑定已被新的请求替代。", {
        status: "cancelled",
      })
    }

    if (requiresBotBinding) {
      const pendingConnection = updateMobileChannelConnectionMetadata(
        connection.id,
        {
          bindingPending,
          pendingBindingReset: accountChanged,
          pendingPairingAttemptId: pairingProcess.attemptId,
        }
      )
      if (!pendingConnection) {
        throw pairingFailure(
          "connection_state_missing",
          "机器人已连接，但无法保存待绑定状态。"
        )
      }
      const bindingTiming = pairingStepTiming(LOCAL_BINDING_TTL_SECONDS)
      const awaitingBinding = updateMobileChannelPairing(pairingId, {
        connectionId: connection.id,
        status: "awaiting_bind",
        bindCode,
        qrPayload,
        qrCodeDataUrl,
        issuedAt: bindingTiming.issuedAt,
        stepExpiresAt: bindingTiming.stepExpiresAt,
        expiresAt: bindingTiming.stepExpiresAt,
        expirySource: "local_binding",
        remoteStatus: "runtime_ready",
        failureCode: null,
        retryable: true,
        message:
          bindingMessage ||
          `机器人已创建并连接。请在手机中向机器人发送 /bind ${bindCode} 完成设备绑定。`,
        error: null,
      })
      if (awaitingBinding?.status !== "awaiting_bind") {
        throw pairingFailure(
          "pairing_not_active",
          "绑定流程已结束，未启用新的机器人。"
        )
      }
    } else if (ownerExternalUserId) {
      const target = ownerUsageGuideTarget({
        connectionId: connection.id,
        provider,
        ownerExternalUserId,
      })
      if (!target) {
        throw pairingFailure(
          "outbound_target_missing",
          "平台已授权，但无法确定首次验证消息的接收用户。",
          { retryable: false }
        )
      }

      try {
        await runtime.sendMobileChannelText(
          target,
          "平台授权已完成，正在验证机器人消息发送并保存本机绑定…"
        )
      } catch (error) {
        throw pairingFailure(
          "outbound_health_check_failed",
          `机器人连接成功，但发送验证消息失败：${errorMessage(error)}`
        )
      }

      const finalized = finalizeOwnedMobileChannelPairing({
        pairingId,
        connectionId: connection.id,
        pairingAttemptId: pairingProcess.attemptId,
      })
      if (!finalized) {
        throw pairingFailure(
          "pairing_finalize_failed",
          "机器人验证成功，但绑定状态已过期或被其他请求替代。"
        )
      }
      completed = true

      try {
        await runtime.sendMobileChannelText(
          { ...target, durable: true },
          getMobileChannelUsageGuide({
            provider,
            connectionJustCompleted: true,
          })
        )
        updateMobileChannelConnectionMetadata(connection.id, {
          [MOBILE_CHANNEL_USAGE_GUIDE_SENT_AT_METADATA_KEY]:
            new Date().toISOString(),
        })
      } catch (guideError) {
        updateMobileChannelPairing(pairingId, {
          status: "connected",
          remoteStatus: "outbound_verified_guide_pending",
          failureCode: "usage_guide_delivery_pending",
          retryable: true,
          message:
            "绑定已完成且消息发送验证通过，但详细使用说明暂未送达；系统会自动重试。",
          error: null,
        })
        console.warn("[mobile-channels] pairing_usage_guide_pending", {
          provider,
          pairingId,
          connectionId: connection.id,
          error: errorMessage(guideError),
        })
      }
    }
    completed = true
  } catch (error) {
    let reportedError = error
    if (connection) {
      try {
        await restorePreviousMobileConnection({
          previous: previousConnection,
          pairingId,
          replacementAttemptId: pairingProcess.attemptId,
          replacementProvider: provider,
          replacementConnectionId: connection.id,
          replacementAccountId: accountId,
        })
      } catch (rollbackError) {
        reportedError = pairingFailure(
          "pairing_rollback_failed",
          `新机器人验证失败，且旧配置恢复失败：${errorMessage(rollbackError)}`,
          { retryable: false }
        )
        console.error("[mobile-channels] pairing_rollback_failed", {
          provider,
          pairingId,
          connectionId: connection.id,
          error: errorMessage(rollbackError),
        })
      }
    } else if (
      previousDisconnected &&
      previousConnection?.enabled &&
      previousConnection.credentials &&
      runtime
    ) {
      try {
        await runtime.connectMobileChannel(previousConnection.id)
      } catch (rollbackError) {
        reportedError = pairingFailure(
          "pairing_rollback_failed",
          `新机器人替换已取消，但旧连接恢复失败：${errorMessage(rollbackError)}`,
          { retryable: false }
        )
      }
    }
    throw reportedError
  } finally {
    if (completed) {
      releasePairingProcess(pairingId, pairingProcess)
    }
  }
}

function handleLarkRegistrationStatus({
  pairing,
  pairingProcess,
  platformLabel,
  info,
}: {
  pairing: MobileChannelPairing
  pairingProcess: PairingProcess
  platformLabel: string
  info: {
    status: "polling" | "slow_down" | "domain_switched"
    interval?: number
  }
}) {
  const currentPairing = getActivePairingForProcess(pairing.id, pairingProcess)
  if (
    !currentPairing ||
    !["preparing", "waiting_scan", "waiting_confirmation"].includes(
      currentPairing.status
    )
  ) {
    if (!currentPairing) {
      stopPairingProcess(pairing.id, pairingProcess)
    }
    return
  }

  switch (info.status) {
    case "polling":
      updateMobileChannelPairing(pairing.id, {
        remoteStatus: "polling",
        failureCode: null,
        message: `正在等待${platformLabel}授权确认。`,
        error: null,
      })
      return
    case "slow_down":
      updateMobileChannelPairing(pairing.id, {
        remoteStatus: "slow_down",
        failureCode: null,
        message: `${platformLabel}要求降低查询频率，已调整为约 ${Math.max(1, Math.round(info.interval ?? 5))} 秒一次并继续等待。`,
        error: null,
      })
      return
    case "domain_switched":
      updateMobileChannelPairing(pairing.id, {
        status: "waiting_confirmation",
        remoteStatus: "domain_switched",
        failureCode: null,
        message: `检测到账号所属区域，已切换${platformLabel}授权节点并继续确认。`,
        error: null,
      })
  }
}

function canPublishRegistrationQr(
  pairingId: string,
  pairingProcess: PairingProcess
) {
  const current = getActivePairingForProcess(pairingId, pairingProcess)
  if (!current) {
    stopPairingProcess(pairingId, pairingProcess)
    return false
  }
  return Boolean(
    ["preparing", "waiting_scan", "waiting_confirmation"].includes(
      current.status
    )
  )
}

async function prepareLarkPairing(
  pairing: MobileChannelPairing,
  pairingProcess: PairingProcess,
  defaultProjectId: string | null
) {
  let resolveQrReady: (() => void) | null = null
  const qrReady = new Promise<void>((resolve) => {
    resolveQrReady = resolve
  })

  const registration = registerApp({
    domain: LARK_ACCOUNTS_DOMAIN,
    larkDomain: LARK_ACCOUNTS_DOMAIN,
    signal: pairingProcess.controller.signal,
    source: "astraflow-desktop",
    createOnly: true,
    appPreset: {
      name: "AstraFlow Mobile",
      desc: "Securely connect Lark to this AstraFlow computer",
    },
    addons: {
      preset: false,
      scopes: {
        tenant: ["im:message:send_as_bot", "im:resource"],
      },
      events: { items: { tenant: ["im.message.receive_v1"] } },
    },
    onStatusChange: (info) =>
      handleLarkRegistrationStatus({
        pairing,
        pairingProcess,
        platformLabel: "Lark",
        info,
      }),
    onQRCodeReady: (info) => {
      void (async () => {
        const dataUrl = await qrDataUrl(info.url)
        if (!canPublishRegistrationQr(pairing.id, pairingProcess)) {
          return
        }
        const timing = pairingStepTiming(info.expireIn)
        updateMobileChannelPairing(pairing.id, {
          status: "waiting_scan",
          qrPayload: info.url,
          qrCodeDataUrl: dataUrl,
          issuedAt: timing.issuedAt,
          stepExpiresAt: timing.stepExpiresAt,
          expiresAt: timing.stepExpiresAt,
          expirySource: "provider",
          remoteStatus: "qr_ready",
          failureCode: null,
          retryable: true,
          message: "Scan with Lark to create and authorize AstraFlow Mobile.",
          error: null,
        })
        resolveQrReady?.()
      })().catch((error) => failPairing(pairing.id, pairingProcess, error))
    },
  })

  void registration
    .then(async (result) => {
      if (!result.client_id || !result.client_secret) {
        throw pairingFailure(
          "credential_missing",
          "Lark 授权成功，但没有返回完整的应用凭据。"
        )
      }
      const credentials: LarkMobileChannelCredentials = {
        provider: "lark",
        appId: result.client_id,
        appSecret: result.client_secret,
        ownerOpenId: result.user_info?.open_id ?? null,
      }
      await completePairing({
        pairingId: pairing.id,
        pairingProcess,
        credentials,
        accountId: credentials.appId,
        ownerExternalUserId: credentials.ownerOpenId,
        defaultProjectId,
      })
    })
    .catch((error) => failPairing(pairing.id, pairingProcess, error))

  await Promise.race([
    qrReady,
    registration.then(() => undefined),
    delay(15_000, pairingProcess.controller.signal).then(() => {
      throw new Error("Lark QR code generation timed out. Please try again.")
    }),
  ])
}

async function prepareTelegramPairing(
  pairing: MobileChannelPairing,
  pairingProcess: PairingProcess,
  defaultProjectId: string | null,
  botToken: string | undefined
) {
  const token = botToken?.trim()
  if (!token) {
    throw new Error("请先填写 Telegram BotFather 提供的 Bot Token。")
  }

  const result = telegramGetMeSchema.parse(
    await fetchJson<unknown>(`https://api.telegram.org/bot${token}/getMe`, {
      signal: pairingProcess.controller.signal,
    })
  )
  if (!result.ok || !result.result?.is_bot || !result.result.username) {
    throw new Error(result.description || "Telegram Bot Token 校验失败。")
  }

  const credentials: TelegramMobileChannelCredentials = {
    provider: "telegram",
    botToken: token,
    botUsername: result.result.username,
    ownerUserId: null,
  }
  await completePairing({
    pairingId: pairing.id,
    pairingProcess,
    credentials,
    accountId: String(result.result.id),
    ownerExternalUserId: null,
    defaultProjectId,
    bindingQrPayload: (bindCode) =>
      telegramBotDeepLink(result.result!.username!, bindCode),
    bindingMessage:
      "请使用 Telegram 扫描二维码，打开机器人并点击 Start 完成设备绑定。",
  })
}

async function prepareDiscordPairing(
  pairing: MobileChannelPairing,
  pairingProcess: PairingProcess,
  defaultProjectId: string | null,
  applicationId: string | undefined,
  botToken: string | undefined
) {
  const normalizedApplicationId = applicationId?.trim()
  const token = botToken?.trim()
  if (!normalizedApplicationId || !token) {
    throw new Error("请先填写 Discord Application ID 和 Bot Token。")
  }

  const application = discordApplicationSchema.parse(
    await fetchJson<unknown>(
      "https://discord.com/api/v10/oauth2/applications/@me",
      {
        headers: { Authorization: `Bot ${token}` },
        signal: pairingProcess.controller.signal,
      }
    )
  )
  if (application.id !== normalizedApplicationId) {
    throw new Error("Discord Bot Token 与 Application ID 不匹配。")
  }

  const credentials: DiscordMobileChannelCredentials = {
    provider: "discord",
    applicationId: normalizedApplicationId,
    botToken: token,
    ownerUserId: null,
  }
  await completePairing({
    pairingId: pairing.id,
    pairingProcess,
    credentials,
    accountId: application.id,
    ownerExternalUserId: null,
    defaultProjectId,
    bindingQrPayload: () =>
      discordBotInstallUrl({ applicationId: application.id }),
    bindingMessage:
      "请扫描二维码将机器人安装到 Discord 服务器，然后在目标频道发送页面中的绑定命令。",
  })
}

async function prepareWechatPairing(
  pairing: MobileChannelPairing,
  pairingProcess: PairingProcess,
  defaultProjectId: string | null
) {
  const pairingExpiresAt = expiresAt(WECHAT_PAIRING_MAX_LIFETIME_SECONDS)

  async function fetchWechatQr(refreshAttempt: number) {
    const localTokens = collectWechatLocalBotTokens(
      listMobileChannelConnectionRecords()
    )
    logWechatPairingEvent({
      event: "qr_request",
      pairingId: pairing.id,
      pairingProcess,
      details: {
        localTokenCount: localTokens.length,
        refreshAttempt,
      },
    })
    const raw = await postJson<unknown>(
      `${WECHAT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
      { local_token_list: localTokens },
      { headers: wechatHeaders(), signal: pairingProcess.controller.signal }
    )
    const nextQr = wechatQrSchema.parse(raw)
    logWechatPairingEvent({
      event: "qr_issued",
      pairingId: pairing.id,
      pairingProcess,
      qrcode: nextQr.qrcode,
      details: { refreshAttempt },
    })
    return nextQr
  }

  async function showWechatQr({
    nextQr,
    refreshAttempt,
  }: {
    nextQr: z.infer<typeof wechatQrSchema>
    refreshAttempt: number
  }) {
    const dataUrl = await qrDataUrl(nextQr.qrcode_img_content)
    if (!isCurrentPairingProcess(pairing.id, pairingProcess)) {
      return false
    }

    pairingProcess.lastWechatStatus = null
    pairingProcess.verificationCode = null
    const qrTiming = pairingStepTiming(WECHAT_QR_LIFETIME_SECONDS)
    const published = updateMobileChannelPairing(pairing.id, {
      status: "waiting_scan",
      qrPayload: nextQr.qrcode_img_content,
      qrCodeDataUrl: dataUrl,
      issuedAt: qrTiming.issuedAt,
      stepExpiresAt: qrTiming.stepExpiresAt,
      expiresAt: pairingExpiresAt,
      expirySource: "provider_policy",
      remoteStatus: "qr_issued",
      message:
        refreshAttempt === 0
          ? "请使用微信扫描二维码，并在手机上确认连接。"
          : `二维码已自动更新（${refreshAttempt}/${WECHAT_QR_MAX_REFRESH_ATTEMPTS}），请重新扫描。`,
      error: null,
    })
    if (
      published?.status !== "waiting_scan" ||
      !isCurrentPairingProcess(pairing.id, pairingProcess)
    ) {
      stopPairingProcess(pairing.id, pairingProcess)
      return false
    }
    return true
  }

  let qr = await fetchWechatQr(0)
  if (!(await showWechatQr({ nextQr: qr, refreshAttempt: 0 }))) {
    return
  }

  void (async () => {
    let pollingBaseUrl = WECHAT_BASE_URL
    let completedRefreshes = 0

    const refreshWechatQr = async (reason: string) => {
      const refreshAttempt = nextWechatQrRefreshAttempt(completedRefreshes)
      if (refreshAttempt === null) {
        const verificationBlocked = reason === "verify_code_blocked"
        const failureMessage = verificationBlocked
          ? "验证码错误次数过多，自动换码次数已用完，请重新开始绑定。"
          : "二维码多次过期，自动换码次数已用完，请重新开始绑定。"
        updateMobileChannelPairing(pairing.id, {
          status: "expired",
          qrPayload: null,
          qrCodeDataUrl: null,
          issuedAt: null,
          stepExpiresAt: null,
          remoteStatus: reason,
          failureCode: verificationBlocked
            ? "verify_code_blocked"
            : "wechat_qr_refresh_exhausted",
          retryable: true,
          message: failureMessage,
          error: failureMessage,
        })
        logWechatPairingEvent({
          event: "qr_refresh_exhausted",
          pairingId: pairing.id,
          pairingProcess,
          qrcode: qr.qrcode,
          details: { completedRefreshes, reason },
        })
        releasePairingProcess(pairing.id, pairingProcess)
        return false
      }

      updateMobileChannelPairing(pairing.id, {
        status: "refreshing",
        qrPayload: null,
        qrCodeDataUrl: null,
        issuedAt: null,
        stepExpiresAt: null,
        expiresAt: pairingExpiresAt,
        expirySource: "provider_policy",
        remoteStatus: `refreshing:${reason}`,
        failureCode: null,
        retryable: true,
        message: "二维码已失效，正在自动刷新…",
        error: null,
      })
      logWechatPairingEvent({
        event: "qr_refreshing",
        pairingId: pairing.id,
        pairingProcess,
        qrcode: qr.qrcode,
        details: { reason, refreshAttempt },
      })

      const nextQr = await fetchWechatQr(refreshAttempt)
      if (!(await showWechatQr({ nextQr, refreshAttempt }))) {
        return false
      }

      qr = nextQr
      pollingBaseUrl = WECHAT_BASE_URL
      completedRefreshes = refreshAttempt
      return true
    }

    while (isCurrentPairingProcess(pairing.id, pairingProcess)) {
      const activePairing = getActivePairingForProcess(
        pairing.id,
        pairingProcess
      )
      if (!activePairing) {
        pairingProcess.controller.abort()
        releasePairingProcess(pairing.id, pairingProcess)
        return
      }
      if (
        activePairing.stepExpiresAt &&
        Date.now() > Date.parse(activePairing.stepExpiresAt) + 45_000
      ) {
        if (!(await refreshWechatQr("local_deadline"))) {
          return
        }
        continue
      }

      const verifyCode = pairingProcess.verificationCode
      const query = new URL("/ilink/bot/get_qrcode_status", pollingBaseUrl)
      query.searchParams.set("qrcode", qr.qrcode)
      if (verifyCode) {
        query.searchParams.set("verify_code", verifyCode)
      }

      let status: z.infer<typeof wechatQrStatusSchema>

      try {
        status = wechatQrStatusSchema.parse(
          await fetchJson<unknown>(
            query.toString(),
            {
              headers: wechatHeaders(),
              signal: pairingProcess.controller.signal,
            },
            38_000
          )
        )
      } catch (error) {
        if (
          pairingProcess.controller.signal.aborted ||
          !isCurrentPairingProcess(pairing.id, pairingProcess)
        ) {
          return
        }
        logWechatPairingEvent({
          event: isAbortError(error) ? "poll_timeout" : "poll_retry",
          pairingId: pairing.id,
          pairingProcess,
          qrcode: qr.qrcode,
          details: { pollingHost: safeUrlHost(pollingBaseUrl) },
        })
        if (isAbortError(error)) {
          continue
        }
        const failure = pairingFailureFromUnknown(error)
        if (!isTransientPairingError(error)) {
          throw failure
        }
        updateMobileChannelPairing(pairing.id, {
          remoteStatus: "network_retry",
          failureCode: null,
          retryable: true,
          message: `微信扫码状态查询暂时失败，正在自动重试（第 ${pairingProcess.networkFailureCount + 1} 次）…`,
          error: null,
        })
        pairingProcess.networkFailureCount += 1
        pairingProcess.networkFailureStartedAt ??= Date.now()
        await delay(1_500, pairingProcess.controller.signal)
        continue
      }

      if (!getActivePairingForProcess(pairing.id, pairingProcess)) {
        pairingProcess.controller.abort()
        releasePairingProcess(pairing.id, pairingProcess)
        return
      }
      pairingProcess.networkFailureCount = 0
      pairingProcess.networkFailureStartedAt = null

      if (pairingProcess.lastWechatStatus !== status.status) {
        pairingProcess.lastWechatStatus = status.status
        logWechatPairingEvent({
          event: "status_transition",
          pairingId: pairing.id,
          pairingProcess,
          qrcode: qr.qrcode,
          details: {
            status: status.status,
            pollingHost: safeUrlHost(pollingBaseUrl),
            hasBotId: Boolean(status.ilink_bot_id),
            hasBotToken: Boolean(status.bot_token),
          },
        })
        updateMobileChannelPairing(pairing.id, {
          remoteStatus: status.status,
          failureCode: null,
          error: null,
        })
      }

      switch (status.status) {
        case "wait":
          await delay(750, pairingProcess.controller.signal)
          continue
        case "scaned":
          if (verifyCode && pairingProcess.verificationCode === verifyCode) {
            pairingProcess.verificationCode = null
          }
          updateMobileChannelPairing(pairing.id, {
            status: "scanned",
            remoteStatus: "scaned",
            message: "已扫码，请在微信中确认。",
          })
          continue
        case "need_verifycode": {
          const verifyCodeRejected = Boolean(verifyCode)
          if (verifyCode && pairingProcess.verificationCode === verifyCode) {
            pairingProcess.verificationCode = null
          }
          updateMobileChannelPairing(pairing.id, {
            status: "verification_required",
            remoteStatus: "need_verifycode",
            failureCode: verifyCodeRejected ? "verify_code_rejected" : null,
            message: verifyCodeRejected
              ? "验证码不匹配，请重新输入手机端显示的数字。"
              : "微信要求输入验证码，请填写手机端显示的验证码。",
          })
          await delay(1_000, pairingProcess.controller.signal)
          continue
        }
        case "verify_code_blocked": {
          if (!(await refreshWechatQr("verify_code_blocked"))) {
            return
          }
          continue
        }
        case "scaned_but_redirect":
          if (!status.redirect_host) {
            updateMobileChannelPairing(pairing.id, {
              status: "waiting_confirmation",
              remoteStatus: "scaned_but_redirect_missing_host",
              failureCode: null,
              retryable: true,
              message:
                "微信未返回新的接入节点，正在按官方兼容策略继续使用当前节点确认。",
              error: null,
            })
            continue
          }
          pollingBaseUrl = normalizeBaseUrl(status.redirect_host)
          updateMobileChannelPairing(pairing.id, {
            status: "waiting_confirmation",
            remoteStatus: "scaned_but_redirect",
            message: "正在切换微信接入节点，请稍候。",
          })
          continue
        case "binded_redirect": {
          const existing = getMobileChannelConnectionByProvider("wechat")
          if (existing?.credentials?.provider !== "wechat") {
            throw new Error(
              "微信提示机器人已绑定，但本机没有可用凭据，请解除微信授权后重新绑定。"
            )
          }

          if (existing.enabled) {
            const runtime = await import("./runtime")
            await runtime.connectMobileChannel(existing.id)
            const ownerExternalUserId =
              existing.ownerExternalUserId ?? existing.credentials.userId
            const target = ownerExternalUserId
              ? ownerUsageGuideTarget({
                  connectionId: existing.id,
                  provider: "wechat",
                  ownerExternalUserId,
                })
              : null
            if (!target) {
              throw pairingFailure(
                "outbound_target_missing",
                "微信机器人已绑定，但本机缺少接收用户信息，无法验证消息发送能力。请解除微信授权后重新绑定。",
                { retryable: false }
              )
            }
            try {
              await runtime.sendMobileChannelText(
                target,
                "检测到该微信机器人已绑定，AstraFlow 已完成连接与消息发送验证。"
              )
            } catch (error) {
              throw pairingFailure(
                "outbound_health_check_failed",
                `微信机器人已连接，但发送验证消息失败：${errorMessage(error)}`
              )
            }
          }
          if (!isCurrentPairingProcess(pairing.id, pairingProcess)) {
            return
          }

          const verifiedExisting = updateMobileChannelConnectionMetadata(
            existing.id,
            {
              bindingPending: false,
              pendingPairingAttemptId: null,
              pendingBindingReset: null,
            }
          )
          if (!verifiedExisting) {
            throw pairingFailure(
              "connection_state_missing",
              "微信机器人已绑定，但本机连接状态无法保存。"
            )
          }

          updateMobileChannelPairing(pairing.id, {
            connectionId: existing.id,
            status: existing.enabled ? "connected" : "paused",
            qrPayload: null,
            qrCodeDataUrl: null,
            issuedAt: null,
            stepExpiresAt: null,
            expirySource: null,
            remoteStatus: existing.enabled
              ? "binded_redirect_outbound_verified"
              : "binded_redirect_paused",
            failureCode: existing.enabled ? null : "connection_paused",
            retryable: false,
            message: existing.enabled
              ? "该微信机器人已绑定，并已完成连接和消息发送验证，无需重复绑定。"
              : "该微信机器人已绑定，当前处于暂停状态，可通过右上角开关重新启用。",
            error: existing.enabled ? null : "机器人已绑定，但当前已暂停。",
          })
          logWechatPairingEvent({
            event: "already_bound",
            pairingId: pairing.id,
            pairingProcess,
            qrcode: qr.qrcode,
            details: {
              connectionId: existing.id,
              connectionEnabled: existing.enabled,
            },
          })
          releasePairingProcess(pairing.id, pairingProcess)
          return
        }
        case "expired": {
          if (!(await refreshWechatQr("expired"))) {
            return
          }
          continue
        }
        case "confirmed": {
          if (!status.bot_token || !status.ilink_bot_id) {
            throw pairingFailure(
              "credential_missing",
              "微信已确认授权，但没有返回完整的机器人凭据。"
            )
          }

          const credentials: WechatMobileChannelCredentials = {
            provider: "wechat",
            accountId: status.ilink_bot_id,
            token: status.bot_token,
            baseUrl: normalizeBaseUrl(status.baseurl),
            userId: status.ilink_user_id ?? null,
          }

          await completePairing({
            pairingId: pairing.id,
            pairingProcess,
            credentials,
            accountId: credentials.accountId,
            ownerExternalUserId: credentials.userId,
            defaultProjectId,
          })
          return
        }
        default: {
          const unsupportedStatus: never = status.status
          throw new Error(`不支持的微信扫码状态：${unsupportedStatus}`)
        }
      }
    }
  })().catch((error) => failPairing(pairing.id, pairingProcess, error))
}

function wecomPlatformCode() {
  switch (process.platform) {
    case "darwin":
      return 1
    case "win32":
      return 2
    case "linux":
      return 3
    default:
      return 0
  }
}

async function prepareWecomPairing(
  pairing: MobileChannelPairing,
  pairingProcess: PairingProcess,
  defaultProjectId: string | null
) {
  const raw = await fetchJson<unknown>(
    `${WECOM_QR_BASE_URL}/generate?source=wecom_cli_external&plat=${wecomPlatformCode()}`,
    { signal: pairingProcess.controller.signal }
  )
  const qr = wecomQrSchema.parse(raw).data
  const timing = pairingStepTiming(WECOM_QR_TTL_SECONDS)
  const deadlineMs = Date.parse(timing.stepExpiresAt)
  const qrCodeDataUrl = await qrDataUrl(qr.auth_url)
  if (!isCurrentPairingProcess(pairing.id, pairingProcess)) {
    return
  }

  updateMobileChannelPairing(pairing.id, {
    status: "waiting_scan",
    qrPayload: qr.auth_url,
    qrCodeDataUrl,
    issuedAt: timing.issuedAt,
    stepExpiresAt: timing.stepExpiresAt,
    expiresAt: timing.stepExpiresAt,
    expirySource: "provider_policy",
    remoteStatus: "waiting",
    failureCode: null,
    retryable: true,
    message: "请使用企业微信扫描二维码并创建智能机器人。",
    error: null,
  })

  void (async () => {
    while (isCurrentPairingProcess(pairing.id, pairingProcess)) {
      if (!getActivePairingForProcess(pairing.id, pairingProcess)) {
        pairingProcess.controller.abort()
        releasePairingProcess(pairing.id, pairingProcess)
        return
      }
      if (Date.now() >= deadlineMs) {
        throw pairingFailure(
          "wecom_qr_timeout",
          "企业微信扫码授权在 5 分钟内未完成，请重新生成二维码。",
          { status: "expired" }
        )
      }

      let result: z.infer<typeof wecomQrStatusSchema>
      try {
        result = wecomQrStatusSchema.parse(
          await fetchJson<unknown>(
            `${WECOM_QR_BASE_URL}/query_result?scode=${encodeURIComponent(qr.scode)}`,
            { signal: pairingProcess.controller.signal }
          )
        )
      } catch (error) {
        if (pairingProcess.controller.signal.aborted) {
          return
        }
        const failure = pairingFailureFromUnknown(error)
        if (!isTransientPairingError(error)) {
          throw failure
        }
        pairingProcess.networkFailureStartedAt ??= Date.now()
        pairingProcess.networkFailureCount += 1
        if (
          Date.now() - pairingProcess.networkFailureStartedAt >=
          PAIRING_NETWORK_RETRY_LIMIT_MS
        ) {
          throw pairingFailure(
            "wecom_poll_network_timeout",
            `企业微信扫码状态连续查询失败：${failure.message}`
          )
        }
        updateMobileChannelPairing(pairing.id, {
          remoteStatus: "network_retry",
          failureCode: null,
          retryable: true,
          message: `企业微信扫码状态查询失败，正在重试（第 ${pairingProcess.networkFailureCount} 次）…`,
          error: null,
        })
        await delay(3_000, pairingProcess.controller.signal)
        continue
      }
      pairingProcess.networkFailureStartedAt = null
      pairingProcess.networkFailureCount = 0

      const remoteStatus = result.data?.status?.trim() || "waiting"
      updateMobileChannelPairing(pairing.id, {
        remoteStatus,
        failureCode: null,
        message:
          result.data?.message ||
          result.data?.error ||
          (remoteStatus === "success"
            ? "企业微信已确认授权，正在读取机器人凭据…"
            : "等待在企业微信中完成机器人创建和授权。"),
        error: null,
      })

      if (remoteStatus === "success") {
        if (!result.data?.bot_info) {
          throw pairingFailure(
            "credential_missing",
            "企业微信显示授权成功，但没有返回 Bot ID 或 Secret。"
          )
        }
        const credentials: WecomMobileChannelCredentials = {
          provider: "wecom",
          botId: result.data.bot_info.botid,
          secret: result.data.bot_info.secret,
        }
        await completePairing({
          pairingId: pairing.id,
          pairingProcess,
          credentials,
          accountId: credentials.botId,
          ownerExternalUserId: null,
          defaultProjectId,
        })
        return
      }

      await delay(3_000, pairingProcess.controller.signal)
    }
  })().catch((error) => failPairing(pairing.id, pairingProcess, error))
}

async function prepareFeishuPairing(
  pairing: MobileChannelPairing,
  pairingProcess: PairingProcess,
  defaultProjectId: string | null
) {
  let resolveQrReady: (() => void) | null = null
  const qrReady = new Promise<void>((resolve) => {
    resolveQrReady = resolve
  })

  const registration = registerApp({
    signal: pairingProcess.controller.signal,
    source: "astraflow-desktop",
    createOnly: true,
    appPreset: {
      name: "AstraFlow Mobile",
      desc: "从飞书安全连接并操作这台 AstraFlow 电脑",
    },
    addons: {
      preset: false,
      scopes: {
        tenant: ["im:message:send_as_bot", "im:resource"],
      },
      events: { items: { tenant: ["im.message.receive_v1"] } },
    },
    onStatusChange: (info) =>
      handleLarkRegistrationStatus({
        pairing,
        pairingProcess,
        platformLabel: "飞书",
        info,
      }),
    onQRCodeReady: (info) => {
      void (async () => {
        const dataUrl = await qrDataUrl(info.url)
        if (!canPublishRegistrationQr(pairing.id, pairingProcess)) {
          return
        }
        const timing = pairingStepTiming(info.expireIn)
        updateMobileChannelPairing(pairing.id, {
          status: "waiting_scan",
          qrPayload: info.url,
          qrCodeDataUrl: dataUrl,
          issuedAt: timing.issuedAt,
          stepExpiresAt: timing.stepExpiresAt,
          expiresAt: timing.stepExpiresAt,
          expirySource: "provider",
          remoteStatus: "qr_ready",
          failureCode: null,
          retryable: true,
          message: "请使用飞书扫描二维码，创建并授权 AstraFlow 机器人。",
          error: null,
        })
        resolveQrReady?.()
      })().catch((error) => failPairing(pairing.id, pairingProcess, error))
    },
  })

  void registration
    .then(async (result) => {
      if (!result.client_id || !result.client_secret) {
        throw pairingFailure(
          "credential_missing",
          "飞书授权成功，但没有返回完整的应用凭据。"
        )
      }
      const credentials: FeishuMobileChannelCredentials = {
        provider: "feishu",
        appId: result.client_id,
        appSecret: result.client_secret,
        ownerOpenId: result.user_info?.open_id ?? null,
        tenantBrand: result.user_info?.tenant_brand ?? null,
      }
      await completePairing({
        pairingId: pairing.id,
        pairingProcess,
        credentials,
        accountId: credentials.appId,
        ownerExternalUserId: credentials.ownerOpenId,
        defaultProjectId,
      })
    })
    .catch((error) => failPairing(pairing.id, pairingProcess, error))

  await Promise.race([
    qrReady,
    registration.then(() => undefined),
    delay(15_000, pairingProcess.controller.signal).then(() => {
      throw new Error("飞书二维码生成超时，请重试。")
    }),
  ])
}

function assertDingtalkSuccess(
  result: z.infer<typeof dingtalkApiBaseSchema>,
  step: string
) {
  if (result.errcode !== 0) {
    throw pairingFailure(
      `dingtalk_${result.errcode}`,
      `${step}：${result.errmsg || `错误 ${result.errcode}`}`,
      { retryable: result.errcode >= 500 }
    )
  }
}

async function prepareDingtalkPairing(
  pairing: MobileChannelPairing,
  pairingProcess: PairingProcess,
  defaultProjectId: string | null
) {
  const source =
    process.env.ASTRAFLOW_DINGTALK_REGISTRATION_SOURCE?.trim() ||
    "DING_DWS_CLAW"
  const init = dingtalkInitSchema.parse(
    await postJson<unknown>(
      `${DINGTALK_REGISTRATION_BASE_URL}/app/registration/init`,
      { source },
      { signal: pairingProcess.controller.signal }
    )
  )
  assertDingtalkSuccess(init, "钉钉初始化失败")
  if (!init.nonce) {
    throw new Error("钉钉初始化未返回 nonce。")
  }

  const begin = dingtalkBeginSchema.parse(
    await postJson<unknown>(
      `${DINGTALK_REGISTRATION_BASE_URL}/app/registration/begin`,
      { nonce: init.nonce },
      { signal: pairingProcess.controller.signal }
    )
  )
  assertDingtalkSuccess(begin, "钉钉授权失败")
  if (!begin.device_code || !begin.verification_uri_complete) {
    throw new Error("钉钉授权未返回完整的设备码。")
  }

  const expirySeconds = Math.max(1, begin.expires_in ?? 7_200)
  const intervalMs = Math.max(1, begin.interval ?? 3) * 1_000
  const timing = pairingStepTiming(expirySeconds)
  const deadlineMs = Date.parse(timing.stepExpiresAt)

  updateMobileChannelPairing(pairing.id, {
    status: "waiting_scan",
    qrPayload: begin.verification_uri_complete,
    qrCodeDataUrl: await qrDataUrl(begin.verification_uri_complete),
    issuedAt: timing.issuedAt,
    stepExpiresAt: timing.stepExpiresAt,
    expiresAt: timing.stepExpiresAt,
    expirySource: "provider",
    remoteStatus: "WAITING",
    failureCode: null,
    retryable: true,
    message: "请使用钉钉扫描二维码并完成机器人配置。",
    error: null,
  })

  void (async () => {
    let retryWindowStartedAt: number | null = null
    while (isCurrentPairingProcess(pairing.id, pairingProcess)) {
      if (!getActivePairingForProcess(pairing.id, pairingProcess)) {
        pairingProcess.controller.abort()
        releasePairingProcess(pairing.id, pairingProcess)
        return
      }
      if (Date.now() >= deadlineMs) {
        throw pairingFailure(
          "dingtalk_device_code_expired",
          "钉钉设备授权码已到期，请重新生成。",
          { status: "expired" }
        )
      }
      await delay(intervalMs, pairingProcess.controller.signal)
      let result: z.infer<typeof dingtalkPollSchema>
      try {
        result = dingtalkPollSchema.parse(
          await postJson<unknown>(
            `${DINGTALK_REGISTRATION_BASE_URL}/app/registration/poll`,
            { device_code: begin.device_code },
            { signal: pairingProcess.controller.signal }
          )
        )
        assertDingtalkSuccess(result, "钉钉授权轮询失败")
      } catch (error) {
        if (pairingProcess.controller.signal.aborted) {
          return
        }
        const failure = pairingFailureFromUnknown(error)
        const retryablePlatformError =
          error instanceof PairingFailure && error.code.startsWith("dingtalk_")
        if (!retryablePlatformError && !isTransientPairingError(error)) {
          throw failure
        }
        retryWindowStartedAt ??= Date.now()
        pairingProcess.networkFailureCount += 1
        if (
          Date.now() - retryWindowStartedAt >=
          PAIRING_NETWORK_RETRY_LIMIT_MS
        ) {
          throw pairingFailure(
            "dingtalk_poll_network_timeout",
            `钉钉授权状态连续查询失败：${failure.message}`
          )
        }
        updateMobileChannelPairing(pairing.id, {
          remoteStatus: "NETWORK_RETRY",
          failureCode: null,
          retryable: true,
          message: `钉钉授权状态查询失败，正在重试（第 ${pairingProcess.networkFailureCount} 次）…`,
          error: null,
        })
        continue
      }
      pairingProcess.networkFailureCount = 0
      const status = result.status?.toUpperCase()

      if (status === "WAITING") {
        retryWindowStartedAt = null
        updateMobileChannelPairing(pairing.id, {
          remoteStatus: "WAITING",
          message: "等待在钉钉中完成机器人授权。",
          error: null,
        })
        continue
      }
      if (status === "SUCCESS") {
        if (!result.client_id || !result.client_secret) {
          throw pairingFailure(
            "credential_missing",
            "钉钉授权成功，但没有返回 Client ID 或 Client Secret。"
          )
        }
        const credentials: DingtalkMobileChannelCredentials = {
          provider: "dingtalk",
          clientId: result.client_id,
          clientSecret: result.client_secret,
        }
        await completePairing({
          pairingId: pairing.id,
          pairingProcess,
          credentials,
          accountId: credentials.clientId,
          ownerExternalUserId: null,
          defaultProjectId,
        })
        return
      }
      retryWindowStartedAt ??= Date.now()
      const normalizedStatus =
        status === "EXPIRED" || status === "FAIL" ? status : "UNKNOWN"
      updateMobileChannelPairing(pairing.id, {
        remoteStatus: normalizedStatus,
        failureCode: null,
        retryable: true,
        message:
          normalizedStatus === "EXPIRED"
            ? "钉钉暂时返回授权码过期，正在按官方策略复核…"
            : normalizedStatus === "FAIL"
              ? `钉钉暂时返回授权失败，正在复核：${result.fail_reason || "未提供原因"}`
              : `钉钉返回未知授权状态 ${status || "UNKNOWN"}，正在复核…`,
        error: null,
      })
      if (Date.now() - retryWindowStartedAt < PAIRING_NETWORK_RETRY_LIMIT_MS) {
        continue
      }
      if (normalizedStatus === "EXPIRED") {
        throw pairingFailure(
          "dingtalk_device_code_expired",
          "钉钉设备授权码已过期，请重新生成。",
          { status: "expired" }
        )
      }
      if (normalizedStatus === "FAIL") {
        throw pairingFailure(
          "dingtalk_authorization_failed",
          result.fail_reason || "钉钉拒绝了本次机器人授权。"
        )
      }
      throw pairingFailure(
        "dingtalk_unknown_status",
        `钉钉持续返回无法识别的授权状态：${status || "UNKNOWN"}。`
      )
    }
  })().catch((error) => failPairing(pairing.id, pairingProcess, error))
}

function failPairing(
  pairingId: string,
  pairingProcess: PairingProcess,
  error: unknown
) {
  if (
    pairingProcess.controller.signal.aborted ||
    !isCurrentPairingProcess(pairingId, pairingProcess)
  ) {
    return
  }

  const pairing = getMobileChannelPairing(pairingId)
  const failure = pairingFailureFromUnknown(error)
  console.error("[mobile-channels] pairing_failed", {
    pairingId,
    attemptId: pairingProcess.attemptId,
    provider: pairing?.provider,
    remoteStatus: pairing?.remoteStatus,
    failureCode: failure.code,
    retryable: failure.retryable,
    error: failure.message,
  })
  updateMobileChannelPairing(pairingId, {
    status: failure.status,
    qrPayload: null,
    qrCodeDataUrl: null,
    stepExpiresAt: null,
    remoteStatus: `failure:${failure.code}`,
    failureCode: failure.code,
    retryable: failure.retryable,
    error: failure.message,
    message: failure.message,
  })
  try {
    restoreMobileChannelPairingReplacement(pairingId)
  } catch (rollbackError) {
    console.error("[mobile-channels] terminal_pairing_rollback_failed", {
      pairingId,
      attemptId: pairingProcess.attemptId,
      error: errorMessage(rollbackError),
    })
  }
  pairingProcess.controller.abort()
  releasePairingProcess(pairingId, pairingProcess)
}

export async function startMobileChannelPairing({
  provider,
  defaultProjectId = null,
  telegramBotToken,
  discordApplicationId,
  discordBotToken,
}: {
  provider: MobileChannelProvider
  defaultProjectId?: string | null
  telegramBotToken?: string
  discordApplicationId?: string
  discordBotToken?: string
}) {
  const processes = getPairingProcesses()

  for (const [pairingId, process] of processes) {
    const existing = getMobileChannelPairing(pairingId)
    if (existing?.provider === provider) {
      if (provider === "wechat") {
        logWechatPairingEvent({
          event: "superseded",
          pairingId,
          pairingProcess: process,
        })
      }
      process.controller.abort()
      processes.delete(pairingId)
    }
  }

  cancelActiveMobileChannelPairings(provider)
  const pairing = createMobileChannelPairing({
    provider,
    expiresAt: expiresAt(
      provider === "wechat" ? WECHAT_PAIRING_MAX_LIFETIME_SECONDS : 5 * 60
    ),
    message: "正在向平台申请二维码…",
  })
  const pairingProcess: PairingProcess = {
    attemptId: randomBytes(8).toString("hex"),
    controller: new AbortController(),
    lastWechatStatus: null,
    networkFailureCount: 0,
    networkFailureStartedAt: null,
    verificationCode: null,
  }
  processes.set(pairing.id, pairingProcess)

  try {
    switch (provider) {
      case "wechat":
        await prepareWechatPairing(pairing, pairingProcess, defaultProjectId)
        break
      case "wecom":
        await prepareWecomPairing(pairing, pairingProcess, defaultProjectId)
        break
      case "feishu":
        await prepareFeishuPairing(pairing, pairingProcess, defaultProjectId)
        break
      case "dingtalk":
        await prepareDingtalkPairing(pairing, pairingProcess, defaultProjectId)
        break
      case "lark":
        await prepareLarkPairing(pairing, pairingProcess, defaultProjectId)
        break
      case "telegram":
        await prepareTelegramPairing(
          pairing,
          pairingProcess,
          defaultProjectId,
          telegramBotToken
        )
        break
      case "discord":
        await prepareDiscordPairing(
          pairing,
          pairingProcess,
          defaultProjectId,
          discordApplicationId,
          discordBotToken
        )
        break
    }
  } catch (error) {
    failPairing(pairing.id, pairingProcess, error)
  }

  return getMobileChannelPairing(pairing.id)
}

export function submitMobileChannelPairingVerification({
  pairingId,
  code,
}: {
  pairingId: string
  code: string
}) {
  const pairing = getMobileChannelPairing(pairingId)
  const process = getPairingProcesses().get(pairingId)

  if (
    !pairing ||
    pairing.provider !== "wechat" ||
    pairing.status !== "verification_required" ||
    (pairing.stepExpiresAt !== null &&
      Date.parse(pairing.stepExpiresAt) <= Date.now()) ||
    !process ||
    !isCurrentPairingProcess(pairingId, process)
  ) {
    return null
  }

  process.verificationCode = code
  return updateMobileChannelPairing(pairingId, {
    status: "waiting_confirmation",
    remoteStatus: "verify_code_submitted",
    failureCode: null,
    retryable: true,
    message: "验证码已提交，请在微信中继续确认。",
    error: null,
  })
}

export function cancelMobileChannelPairing(pairingId: string) {
  const process = getPairingProcesses().get(pairingId)
  process?.controller.abort()
  getPairingProcesses().delete(pairingId)

  const cancelled = updateMobileChannelPairing(pairingId, {
    status: "cancelled",
    qrPayload: null,
    qrCodeDataUrl: null,
    stepExpiresAt: null,
    remoteStatus: "cancelled",
    failureCode: "user_cancelled",
    retryable: true,
    error: "用户取消了本次绑定。",
    message: "已取消本次接入。",
  })
  if (cancelled) {
    restoreMobileChannelPairingReplacement(pairingId)
  }
  return getMobileChannelPairing(pairingId)
}
