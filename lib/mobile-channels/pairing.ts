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
  createMobileChannelPairing,
  getMobileChannelPairing,
  saveMobileChannelConnection,
  updateMobileChannelConnectionMetadata,
  updateMobileChannelPairing,
} from "./store"
import {
  mobileChannelProviderLabels,
  type DingtalkMobileChannelCredentials,
  type DiscordMobileChannelCredentials,
  type FeishuMobileChannelCredentials,
  type LarkMobileChannelCredentials,
  type MobileChannelCredentials,
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

type PairingProcess = {
  controller: AbortController
  verificationCode: string | null
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

const wechatQrSchema = z.object({
  qrcode: z.string().min(1),
  qrcode_img_content: z.string().url(),
})

const wechatQrStatusSchema = z.object({
  status: z.string(),
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
      status: z.string().optional(),
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

function qrDataUrl(payload: string) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 560,
    color: { dark: "#101312", light: "#FFFFFF" },
  })
}

function expiresAt(seconds: number) {
  return new Date(Date.now() + Math.max(30, seconds) * 1000).toISOString()
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

async function completePairing({
  pairingId,
  credentials,
  accountId,
  ownerExternalUserId,
  defaultProjectId,
  bindingQrPayload,
  bindingMessage,
}: {
  pairingId: string
  credentials: MobileChannelCredentials
  accountId: string | null
  ownerExternalUserId: string | null
  defaultProjectId: string | null
  bindingQrPayload?: (bindCode: string) => string
  bindingMessage?: string
}) {
  const provider = credentials.provider
  const connection = saveMobileChannelConnection({
    provider,
    displayName: mobileChannelProviderLabels[provider],
    credentials,
    accountId,
    ownerExternalUserId,
    defaultProjectId,
  })

  if (!connection) {
    throw new Error("Unable to save the mobile connection.")
  }

  const requiresBotBinding = !ownerExternalUserId
  const bindCode = requiresBotBinding ? generateBindCode() : null
  const qrPayload =
    bindCode && bindingQrPayload ? bindingQrPayload(bindCode) : null

  updateMobileChannelPairing(pairingId, {
    connectionId: connection.id,
    status: requiresBotBinding ? "awaiting_bind" : "connected",
    bindCode,
    qrPayload,
    qrCodeDataUrl: qrPayload ? await qrDataUrl(qrPayload) : null,
    message: requiresBotBinding
      ? bindingMessage ||
        `机器人已创建。请在手机中向机器人发送 /bind ${bindCode} 完成设备绑定。`
      : "扫码成功，移动端已连接。",
    error: null,
  })

  const { connectMobileChannel, sendMobileChannelText } = await import(
    "./runtime"
  )
  try {
    await connectMobileChannel(connection.id)
    if (ownerExternalUserId) {
      const target = ownerUsageGuideTarget({
        connectionId: connection.id,
        provider,
        ownerExternalUserId,
      })
      if (target) {
        try {
          await sendMobileChannelText(
            target,
            getMobileChannelUsageGuide({
              provider,
              connectionJustCompleted: true,
            })
          )
          updateMobileChannelConnectionMetadata(connection.id, {
            ...connection.metadata,
            [MOBILE_CHANNEL_USAGE_GUIDE_SENT_AT_METADATA_KEY]:
              new Date().toISOString(),
          })
          updateMobileChannelPairing(pairingId, {
            message: "扫码成功，使用说明已发送到移动端。",
          })
        } catch (error) {
          console.error("[mobile-channels] initial_usage_guide_failed", {
            provider,
            connectionId: connection.id,
            error: errorMessage(error),
          })
        }
      }
    }
  } finally {
    getPairingProcesses().delete(pairingId)
  }
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
    onQRCodeReady: (info) => {
      void qrDataUrl(info.url).then((dataUrl) => {
        updateMobileChannelPairing(pairing.id, {
          status: "waiting_scan",
          qrPayload: info.url,
          qrCodeDataUrl: dataUrl,
          expiresAt: expiresAt(info.expireIn),
          message: "Scan with Lark to create and authorize AstraFlow Mobile.",
        })
        resolveQrReady?.()
      })
    },
  })

  void registration
    .then(async (result) => {
      const credentials: LarkMobileChannelCredentials = {
        provider: "lark",
        appId: result.client_id,
        appSecret: result.client_secret,
        ownerOpenId: result.user_info?.open_id ?? null,
      }
      await completePairing({
        pairingId: pairing.id,
        credentials,
        accountId: credentials.appId,
        ownerExternalUserId: credentials.ownerOpenId,
        defaultProjectId,
      })
    })
    .catch((error) => failPairing(pairing.id, error))

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
    await fetchJson<unknown>(
      `https://api.telegram.org/bot${token}/getMe`,
      { signal: pairingProcess.controller.signal }
    )
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
  const raw = await postJson<unknown>(
    `${WECHAT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
    { local_token_list: [] },
    { headers: wechatHeaders(), signal: pairingProcess.controller.signal }
  )
  const qr = wechatQrSchema.parse(raw)

  updateMobileChannelPairing(pairing.id, {
    status: "waiting_scan",
    qrPayload: qr.qrcode_img_content,
    qrCodeDataUrl: await qrDataUrl(qr.qrcode_img_content),
    message: "请使用微信扫描二维码，并在手机上确认连接。",
  })

  void (async () => {
    let pollingBaseUrl = WECHAT_BASE_URL

    while (!pairingProcess.controller.signal.aborted) {
      const verifyCode = pairingProcess.verificationCode
      pairingProcess.verificationCode = null
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
        if (isAbortError(error)) {
          return
        }
        await delay(1_500, pairingProcess.controller.signal)
        continue
      }

      switch (status.status) {
        case "wait":
          continue
        case "scaned":
          updateMobileChannelPairing(pairing.id, {
            status: "scanned",
            message: "已扫码，请在微信中确认。",
          })
          continue
        case "need_verifycode":
          updateMobileChannelPairing(pairing.id, {
            status: "verification_required",
            message: "微信要求输入验证码，请填写手机端显示的验证码。",
          })
          await delay(1_000, pairingProcess.controller.signal)
          continue
        case "verify_code_blocked":
          throw new Error("验证码尝试次数过多，请重新生成二维码。")
        case "scaned_but_redirect":
          if (status.redirect_host) {
            pollingBaseUrl = normalizeBaseUrl(status.redirect_host)
          }
          updateMobileChannelPairing(pairing.id, {
            status: "waiting_confirmation",
            message: "正在切换微信接入节点，请稍候。",
          })
          continue
        case "binded_redirect":
          throw new Error("该微信机器人已绑定，请先在原客户端解除后重试。")
        case "expired":
          updateMobileChannelPairing(pairing.id, {
            status: "expired",
            message: "二维码已过期，请重新生成。",
          })
          return
        case "confirmed": {
          if (!status.bot_token || !status.ilink_bot_id) {
            throw new Error("微信已确认，但未返回机器人凭据。")
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
            credentials,
            accountId: credentials.accountId,
            ownerExternalUserId: credentials.userId,
            defaultProjectId,
          })
          return
        }
        default:
          await delay(1_500, pairingProcess.controller.signal)
      }
    }
  })().catch((error) => failPairing(pairing.id, error))
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
    `${WECOM_QR_BASE_URL}/generate?source=wecom-cli&plat=${wecomPlatformCode()}`,
    { signal: pairingProcess.controller.signal }
  )
  const qr = wecomQrSchema.parse(raw).data

  updateMobileChannelPairing(pairing.id, {
    status: "waiting_scan",
    qrPayload: qr.auth_url,
    qrCodeDataUrl: await qrDataUrl(qr.auth_url),
    message: "请使用企业微信扫描二维码并创建智能机器人。",
  })

  void (async () => {
    while (!pairingProcess.controller.signal.aborted) {
      const result = wecomQrStatusSchema.parse(
        await fetchJson<unknown>(
          `${WECOM_QR_BASE_URL}/query_result?scode=${encodeURIComponent(qr.scode)}`,
          { signal: pairingProcess.controller.signal }
        )
      )

      if (result.data?.status === "success" && result.data.bot_info) {
        const credentials: WecomMobileChannelCredentials = {
          provider: "wecom",
          botId: result.data.bot_info.botid,
          secret: result.data.bot_info.secret,
        }
        await completePairing({
          pairingId: pairing.id,
          credentials,
          accountId: credentials.botId,
          ownerExternalUserId: null,
          defaultProjectId,
        })
        return
      }

      await delay(3_000, pairingProcess.controller.signal)
    }
  })().catch((error) => failPairing(pairing.id, error))
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
    onQRCodeReady: (info) => {
      void qrDataUrl(info.url).then((dataUrl) => {
        updateMobileChannelPairing(pairing.id, {
          status: "waiting_scan",
          qrPayload: info.url,
          qrCodeDataUrl: dataUrl,
          expiresAt: expiresAt(info.expireIn),
          message: "请使用飞书扫描二维码，创建并授权 AstraFlow 机器人。",
        })
        resolveQrReady?.()
      })
    },
  })

  void registration
    .then(async (result) => {
      const credentials: FeishuMobileChannelCredentials = {
        provider: "feishu",
        appId: result.client_id,
        appSecret: result.client_secret,
        ownerOpenId: result.user_info?.open_id ?? null,
        tenantBrand: result.user_info?.tenant_brand ?? null,
      }
      await completePairing({
        pairingId: pairing.id,
        credentials,
        accountId: credentials.appId,
        ownerExternalUserId: credentials.ownerOpenId,
        defaultProjectId,
      })
    })
    .catch((error) => failPairing(pairing.id, error))

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
    throw new Error(`${step}: ${result.errmsg || `error ${result.errcode}`}`)
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

  const expirySeconds = Math.max(60, begin.expires_in ?? 7_200)
  const intervalMs = Math.max(3, begin.interval ?? 3) * 1_000

  updateMobileChannelPairing(pairing.id, {
    status: "waiting_scan",
    qrPayload: begin.verification_uri_complete,
    qrCodeDataUrl: await qrDataUrl(begin.verification_uri_complete),
    expiresAt: expiresAt(expirySeconds),
    message: "请使用钉钉扫描二维码并完成机器人配置。",
  })

  void (async () => {
    while (!pairingProcess.controller.signal.aborted) {
      await delay(intervalMs, pairingProcess.controller.signal)
      const result = dingtalkPollSchema.parse(
        await postJson<unknown>(
          `${DINGTALK_REGISTRATION_BASE_URL}/app/registration/poll`,
          { device_code: begin.device_code },
          { signal: pairingProcess.controller.signal }
        )
      )
      assertDingtalkSuccess(result, "钉钉授权轮询失败")
      const status = result.status?.toUpperCase()

      if (status === "WAITING") {
        continue
      }
      if (status === "SUCCESS") {
        if (!result.client_id || !result.client_secret) {
          throw new Error("钉钉授权成功，但未返回应用凭据。")
        }
        const credentials: DingtalkMobileChannelCredentials = {
          provider: "dingtalk",
          clientId: result.client_id,
          clientSecret: result.client_secret,
        }
        await completePairing({
          pairingId: pairing.id,
          credentials,
          accountId: credentials.clientId,
          ownerExternalUserId: null,
          defaultProjectId,
        })
        return
      }
      if (status === "EXPIRED") {
        updateMobileChannelPairing(pairing.id, {
          status: "expired",
          message: "二维码已过期，请重新生成。",
        })
        return
      }
      if (status === "FAIL") {
        throw new Error(result.fail_reason || "钉钉授权失败。")
      }
    }
  })().catch((error) => failPairing(pairing.id, error))
}

function failPairing(pairingId: string, error: unknown) {
  if (isAbortError(error)) {
    return
  }

  console.error("[mobile-channels] pairing_failed", {
    pairingId,
    error: errorMessage(error),
  })
  updateMobileChannelPairing(pairingId, {
    status: "error",
    error: errorMessage(error),
    message: "接入失败，请检查网络后重试。",
  })
  getPairingProcesses().delete(pairingId)
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
      process.controller.abort()
      processes.delete(pairingId)
    }
  }

  cancelActiveMobileChannelPairings(provider)
  const pairing = createMobileChannelPairing({
    provider,
    expiresAt: expiresAt(5 * 60),
    message: "正在向平台申请二维码…",
  })
  const pairingProcess: PairingProcess = {
    controller: new AbortController(),
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
    failPairing(pairing.id, error)
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

  if (!pairing || pairing.provider !== "wechat" || !process) {
    return null
  }

  process.verificationCode = code
  return updateMobileChannelPairing(pairingId, {
    status: "waiting_confirmation",
    message: "验证码已提交，请在微信中继续确认。",
    error: null,
  })
}

export function cancelMobileChannelPairing(pairingId: string) {
  const process = getPairingProcesses().get(pairingId)
  process?.controller.abort()
  getPairingProcesses().delete(pairingId)

  return updateMobileChannelPairing(pairingId, {
    status: "cancelled",
    message: "已取消本次接入。",
  })
}
