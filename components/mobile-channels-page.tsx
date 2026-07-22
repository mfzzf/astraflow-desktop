"use client"

import Image from "next/image"
import * as React from "react"
import {
  RiAddLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiLoader4Line,
  RiQrCodeLine,
  RiRefreshLine,
  RiTimeLine,
} from "@remixicon/react"
import { toast } from "sonner"

import { getSidebarAwarePageInsetClassName } from "@/components/app-page-inset"
import { useI18n } from "@/components/i18n-provider"
import {
  setStoredChatModel,
  setStoredChatReasoningEffort,
  setStoredChatRuntime,
  writeStoredChatDefaults,
} from "@/components/studio-chat/chat-preferences"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useSidebar } from "@/components/ui/sidebar"
import type { ChatReasoningEffort } from "@/lib/chat-models"
import type {
  MobileChannelConnection,
  MobileChannelPairing,
  MobileChannelProvider,
  MobileChannelReplyGranularity,
} from "@/lib/mobile-channels/types"
import { mobileChannelProviders } from "@/lib/mobile-channels/types"
import { calculateServerRemainingSeconds } from "@/lib/mobile-channels/pairing-time"
import type {
  StudioLocalProject,
  StudioPermissionMode,
} from "@/lib/studio-types"
import { dispatchStudioSessionsChanged } from "@/lib/studio-session-events"
import { cn } from "@/lib/utils"

type ChannelOverviewResponse = {
  ok: boolean
  data?: {
    connections: MobileChannelConnection[]
    pairings: MobileChannelPairing[]
  }
  error?: unknown
}

type ConnectionStatusResponse = {
  ok: boolean
  data?: {
    connections: MobileChannelConnection[]
  }
  error?: unknown
}

type ConnectionMutationResponse = {
  ok: boolean
  data?: MobileChannelConnection
  error?: unknown
}

type LocalProjectsResponse = {
  ok: boolean
  data?: StudioLocalProject[]
  error?: unknown
}

type PairingResponse = {
  ok: boolean
  data?: MobileChannelPairing | null
  error?: unknown
}

type AgentRuntimeOption = {
  id: string
  label: string
}

type AgentModelOption = {
  id: string
  label: string
  supportedRuntimeIds: string[]
  enabled: boolean
  reasoningEfforts: ChatReasoningEffort[]
  defaultReasoningEffort: ChatReasoningEffort
}

type AgentRuntimesResponse = {
  ok: boolean
  data?: AgentRuntimeOption[]
}

type AgentModelSettingsResponse = {
  ok: boolean
  data?: {
    models?: AgentModelOption[]
    runtimes?: Record<string, { defaultModel: string }>
  }
}

const DEFAULT_AGENT_RUNTIME_ID = "astraflow"
const MOBILE_CONNECTION_STATUS_POLL_MS = 2_000

type Copy = ReturnType<typeof getCopy>

function getCopy(locale: "en" | "zh") {
  if (locale === "zh") {
    return {
      newBot: "新建机器人",
      newBotHeading: "新建机器人",
      newBotDescription:
        "选择机器人接收消息的渠道。选择渠道后即可配置凭据、完成绑定并设置默认工作区。",
      comingSoon: "即将支持",
      botFallbackName: "新机器人",
      notBound: "未绑定",
      connected: "已连接",
      connecting: "连接中",
      disconnected: "已暂停",
      error: "需处理",
      networkOffline: "网络已断开",
      networkOfflineDescription:
        "电脑当前处于离线状态；恢复网络后机器人会自动重新连接。",
      linkBot: "绑定机器人",
      linkBotDescription: "扫码后凭据将自动保存。",
      relinkBotDescription:
        "本次扫码成功前，当前机器人配置保持不变；下方仅显示本次重新绑定状态。",
      scanQr: "扫码绑定",
      relinkQr: "重新绑定",
      existingConnectionNote:
        "本次扫码完成前，已保存的机器人配置不会改变；下面是本次重新绑定状态。",
      scanWith: (channel: string) => `请使用${channel}扫码并确认。`,
      preparing: "正在生成二维码…",
      refreshing: "正在刷新二维码",
      waitingScan: "等待扫码",
      scanned: "已扫码，请在手机上确认",
      verificationRequired: "需要输入验证码",
      waitingConfirmation: "正在确认授权",
      validating: "正在验证机器人连接和消息能力",
      awaitingBind: "发送绑定命令完成最后一步",
      pairingConnected: "绑定完成",
      pairingPaused: "已绑定，机器人已暂停",
      pairingExpired: "二维码已过期",
      pairingCancelled: "绑定已取消",
      pairingError: "绑定失败",
      retry: "重新生成",
      qrRemaining: "二维码剩余",
      validationRemaining: "连接验证剩余",
      bindRemaining: "绑定码剩余",
      waitingServerExpiry: "时间已到，正在等待服务端确认状态",
      providerTime: "平台有效期",
      policyTime: "平台策略有效期",
      localValidationTime: "CompShare 连接验证有效期",
      localBindingTime: "CompShare 绑定服务有效期",
      platformStatus: "当前状态",
      failureCode: (code: string) => `错误代码：${code}`,
      nonRetryableHint: "请先按上述原因处理，再重新绑定。",
      connectionAwaitingBind: "机器人已连接，等待手机完成绑定",
      verificationLabel: "手机端验证码",
      verificationPlaceholder: "输入 4–10 位数字",
      submitVerification: "提交",
      submitting: "提交中",
      bindInstruction: "在手机上打开刚创建的机器人，发送：",
      copyCommand: "复制命令",
      copied: "绑定命令已复制。",
      credentialTitle: (channel: string) => `配置${channel}机器人`,
      telegramCredentialDescription:
        "先在 BotFather 创建机器人并粘贴 Bot Token；验证通过后会生成手机绑定二维码。",
      discordCredentialDescription:
        "先在 Discord Developer Portal 创建 Bot、开启 Message Content Intent，再填写凭据生成安装二维码。",
      applicationId: "Application ID",
      botToken: "Bot Token",
      credentialPrivacy: "凭据只会加密保存在本机，不会写入二维码。",
      continueToQr: "验证并生成二维码",
      credentialInvalid: "请填写有效的机器人凭据。",
      replyGranularity: "回复粒度",
      replyGranularityDescription: "消息回复的详细程度。",
      granularityStandard: "标准回复",
      granularityFull: "完整回复",
      granularitySummary: "摘要回复",
      agent: "Agent",
      agentDescription: "处理此机器人任务的本机智能体。",
      model: "模型",
      modelDescription: "运行任务时使用的模型，并可单独设置思考强度。",
      reasoningEffort: "思考强度",
      reasoningDefault: (label: string) => `跟随模型 · ${label}`,
      reasoningNone: "不思考",
      reasoningMinimal: "极低",
      reasoningLow: "低",
      reasoningMedium: "中",
      reasoningHigh: "高",
      reasoningXHigh: "超高",
      reasoningMax: "最大",
      reasoningEnabled: "思考",
      followDefault: "跟随默认",
      permissionMode: "机器人权限",
      permissionModeDescription:
        "控制手机任务如何批准工具调用。默认自动批准常规操作，高风险操作仍会询问。",
      permissionAuto: "自动批准",
      permissionAsk: "每次询问",
      permissionFullAccess: "完全访问（不询问）",
      permissionReadonly: "只读",
      workspace: "默认工作区",
      workspaceDescription: "手机发来的新会话会在该工作区开始。",
      noWorkspace: "暂不指定",
      deleteBot: "删除机器人",
      deleteBotDescription: "移除这个机器人。",
      deleteConfirmTitle: (channel: string) => `删除${channel}机器人？`,
      deleteConfirmDescription:
        "将删除本机保存的机器人凭据与移动会话绑定，平台上的机器人应用不会被自动删除。",
      cancel: "取消",
      confirmDelete: "确认删除",
      removing: "正在删除",
      connectionError: "连接异常",
      loadFailed: "无法读取机器人状态。",
      actionFailed: "操作失败，请稍后重试。",
      saved: "设置已保存。",
      paused: "机器人已暂停。",
      resumed: "机器人已重新连接。",
      removed: "机器人已删除。",
      enableAria: "启用机器人",
    }
  }

  return {
    newBot: "New bot",
    newBotHeading: "New bot",
    newBotDescription:
      "Choose where this bot will receive messages. After selecting a channel, configure credentials, binding, and the default workspace.",
    comingSoon: "Coming soon",
    botFallbackName: "New bot",
    notBound: "Not bound",
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Paused",
    error: "Needs attention",
    networkOffline: "Offline",
    networkOfflineDescription:
      "This computer is offline. The bot will reconnect automatically when the network returns.",
    linkBot: "Link bot",
    linkBotDescription: "Credentials are saved after scan.",
    relinkBotDescription:
      "Your current bot stays unchanged until this scan succeeds; the status below is only for this relink attempt.",
    scanQr: "Scan QR code",
    relinkQr: "Relink",
    existingConnectionNote:
      "Your saved bot stays unchanged until this scan finishes. The status below is only for this relink attempt.",
    scanWith: (channel: string) => `Scan with ${channel} and confirm.`,
    preparing: "Generating QR code…",
    refreshing: "Refreshing QR code",
    waitingScan: "Waiting for scan",
    scanned: "Scanned — confirm on your phone",
    verificationRequired: "Verification code required",
    waitingConfirmation: "Confirming authorization",
    validating: "Validating the bot connection and messaging capability",
    awaitingBind: "One more step: send the bind command",
    pairingConnected: "Bound successfully",
    pairingPaused: "Bound, but the bot is paused",
    pairingExpired: "QR code expired",
    pairingCancelled: "Setup cancelled",
    pairingError: "Binding failed",
    retry: "Generate again",
    qrRemaining: "QR time remaining",
    validationRemaining: "Connection validation time remaining",
    bindRemaining: "Bind code remaining",
    waitingServerExpiry: "Time elapsed; waiting for server confirmation",
    providerTime: "Provider expiry",
    policyTime: "Provider policy expiry",
    localValidationTime: "CompShare connection validation expiry",
    localBindingTime: "CompShare binding service expiry",
    platformStatus: "Current status",
    failureCode: (code: string) => `Error code: ${code}`,
    nonRetryableHint: "Resolve the issue above before linking again.",
    connectionAwaitingBind: "Bot connected; waiting for mobile binding",
    verificationLabel: "Verification code",
    verificationPlaceholder: "Enter 4–10 digits",
    submitVerification: "Submit",
    submitting: "Submitting",
    bindInstruction: "Open the bot you just created and send:",
    copyCommand: "Copy command",
    copied: "Bind command copied.",
    credentialTitle: (channel: string) => `Configure ${channel} bot`,
    telegramCredentialDescription:
      "Create a bot with BotFather and paste its token. CompShare will verify it before generating the mobile binding QR code.",
    discordCredentialDescription:
      "Create a bot in the Discord Developer Portal, enable Message Content Intent, then enter its credentials to generate the install QR code.",
    applicationId: "Application ID",
    botToken: "Bot token",
    credentialPrivacy:
      "Credentials are encrypted locally and are never embedded in the QR code.",
    continueToQr: "Verify and generate QR",
    credentialInvalid: "Enter valid bot credentials.",
    replyGranularity: "Bot reply granularity",
    replyGranularityDescription: "Message detail level.",
    granularityStandard: "Standard reply",
    granularityFull: "Full reply",
    granularitySummary: "Summary reply",
    agent: "Agent",
    agentDescription: "The local agent that handles this bot's tasks.",
    model: "Model",
    modelDescription: "Model used for tasks, with its own thinking level.",
    reasoningEffort: "Thinking level",
    reasoningDefault: (label: string) => `Model default · ${label}`,
    reasoningNone: "No thinking",
    reasoningMinimal: "Minimal",
    reasoningLow: "Low",
    reasoningMedium: "Medium",
    reasoningHigh: "High",
    reasoningXHigh: "Extra high",
    reasoningMax: "Maximum",
    reasoningEnabled: "Thinking",
    followDefault: "Follow default",
    permissionMode: "Bot permissions",
    permissionModeDescription:
      "Control tool approvals for mobile tasks. Auto approves routine operations and still asks for high-risk actions.",
    permissionAuto: "Auto approve",
    permissionAsk: "Ask every time",
    permissionFullAccess: "Full access (no prompts)",
    permissionReadonly: "Read only",
    workspace: "Default workspace",
    workspaceDescription: "New mobile sessions will start in this workspace.",
    noWorkspace: "No default workspace",
    deleteBot: "Delete bot",
    deleteBotDescription: "Remove this bot.",
    deleteConfirmTitle: (channel: string) => `Delete the ${channel} bot?`,
    deleteConfirmDescription:
      "This deletes locally saved bot credentials and mobile session bindings. The bot application on the platform is not deleted automatically.",
    cancel: "Cancel",
    confirmDelete: "Delete bot",
    removing: "Deleting",
    connectionError: "Connection error",
    loadFailed: "Unable to load bot status.",
    actionFailed: "The action failed. Please try again.",
    saved: "Settings saved.",
    paused: "Bot paused.",
    resumed: "Bot reconnected.",
    removed: "Bot deleted.",
    enableAria: "Enable bot",
  }
}

type ChannelDefinition = {
  key: string
  provider: MobileChannelProvider | null
  logo: string
  enName: string
  zhName: string
  badge: "CN" | "Global" | null
  enDescription: string
  zhDescription: string
}

const channelDefinitions: ChannelDefinition[] = [
  {
    key: "wechat",
    provider: "wechat",
    logo: "/channel-logos/wechat.png",
    enName: "Weixin",
    zhName: "微信",
    badge: null,
    enDescription: "Scan to log in; supports images and generated video.",
    zhDescription: "扫码登录，支持图片任务和生成视频回传。",
  },
  {
    key: "feishu",
    provider: "feishu",
    logo: "/channel-logos/feishu.png",
    enName: "Feishu",
    zhName: "飞书",
    badge: "CN",
    enDescription:
      "Scan to create an app; supports images and generated video.",
    zhDescription: "扫码创建应用，支持图片和生成视频回传。",
  },
  {
    key: "wecom",
    provider: "wecom",
    logo: "/channel-logos/wecom.png",
    enName: "WeCom",
    zhName: "企业微信",
    badge: null,
    enDescription: "Official AI bot with image and generated video messaging.",
    zhDescription: "官方智能机器人，支持图片和生成视频回传。",
  },
  {
    key: "dingtalk",
    provider: "dingtalk",
    logo: "/channel-logos/dingtalk.png",
    enName: "DingTalk",
    zhName: "钉钉",
    badge: null,
    enDescription: "Stream mode with image and generated video messaging.",
    zhDescription: "Stream 模式连接，支持图片和生成视频回传。",
  },
  {
    key: "lark",
    provider: "lark",
    logo: "/channel-logos/lark.png",
    enName: "Lark",
    zhName: "Lark",
    badge: "Global",
    enDescription:
      "Scan with Lark; supports text, images, and generated video.",
    zhDescription: "使用 Lark 扫码接入，支持文字、图片和生成视频回传。",
  },
  {
    key: "telegram",
    provider: "telegram",
    logo: "/channel-logos/telegram.svg",
    enName: "Telegram",
    zhName: "Telegram",
    badge: null,
    enDescription: "Connect a BotFather bot, then scan to bind this computer.",
    zhDescription: "接入 BotFather 机器人，再扫码绑定这台电脑。",
  },
  {
    key: "discord",
    provider: "discord",
    logo: "/channel-logos/discord.svg",
    enName: "Discord",
    zhName: "Discord",
    badge: null,
    enDescription: "Install a Discord bot by QR code for text and media tasks.",
    zhDescription: "扫码安装 Discord Bot，支持文字与媒体任务。",
  },
]

const channelByProvider = new Map(
  channelDefinitions
    .filter((channel) => channel.provider !== null)
    .map((channel) => [channel.provider as MobileChannelProvider, channel])
)

function channelName(provider: MobileChannelProvider, locale: "en" | "zh") {
  const channel = channelByProvider.get(provider)
  if (!channel) {
    return provider
  }
  return locale === "zh" ? channel.zhName : channel.enName
}

function activePairing(pairing: MobileChannelPairing | null | undefined) {
  return Boolean(
    pairing &&
    !["connected", "paused", "expired", "cancelled", "error"].includes(
      pairing.status
    )
  )
}

function updateConnectionSnapshot(
  current: MobileChannelConnection[],
  next: MobileChannelConnection[]
) {
  const unchanged =
    current.length === next.length &&
    current.every((connection, index) => {
      const candidate = next[index]
      if (!candidate) {
        return false
      }
      return (
        connection.id === candidate.id &&
        connection.updatedAt === candidate.updatedAt &&
        connection.status === candidate.status &&
        connection.enabled === candidate.enabled &&
        connection.bindingPending === candidate.bindingPending &&
        connection.lastError === candidate.lastError
      )
    })

  return unchanged ? current : next
}

function reasoningEffortLabel(effort: ChatReasoningEffort, copy: Copy) {
  switch (effort) {
    case "none":
      return copy.reasoningNone
    case "minimal":
      return copy.reasoningMinimal
    case "low":
      return copy.reasoningLow
    case "medium":
      return copy.reasoningMedium
    case "high":
      return copy.reasoningHigh
    case "xhigh":
      return copy.reasoningXHigh
    case "max":
      return copy.reasoningMax
    case "enabled":
      return copy.reasoningEnabled
  }
}

function connectionStatusLabel(
  connection: MobileChannelConnection | undefined,
  copy: Copy,
  pairing: MobileChannelPairing | null | undefined,
  networkOnline: boolean
) {
  if (!connection?.configured) {
    return copy.notBound
  }
  if (!connection.enabled) {
    return copy.disconnected
  }
  if (!networkOnline) {
    return copy.networkOffline
  }
  if (connection.status === "disconnected") {
    return copy.disconnected
  }
  if (
    pairing?.connectionId === connection.id &&
    pairing.status === "validating"
  ) {
    return copy.validating
  }
  if (connection.bindingPending) {
    return copy.connectionAwaitingBind
  }
  if (
    pairing?.connectionId === connection.id &&
    pairing.status === "awaiting_bind"
  ) {
    return copy.connectionAwaitingBind
  }
  return copy[connection.status]
}

function pairingStatusLabel(pairing: MobileChannelPairing, copy: Copy) {
  switch (pairing.status) {
    case "preparing":
      return copy.preparing
    case "refreshing":
      return copy.refreshing
    case "waiting_scan":
      return copy.waitingScan
    case "scanned":
      return copy.scanned
    case "verification_required":
      return copy.verificationRequired
    case "waiting_confirmation":
      return copy.waitingConfirmation
    case "validating":
      return copy.validating
    case "awaiting_bind":
      return copy.awaitingBind
    case "connected":
      return copy.pairingConnected
    case "paused":
      return copy.pairingPaused
    case "expired":
      return copy.pairingExpired
    case "cancelled":
      return copy.pairingCancelled
    case "error":
      return copy.pairingError
  }
}

function ChannelLogo({
  channel,
  className,
}: {
  channel: ChannelDefinition
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-xl",
        className
      )}
    >
      <Image
        src={channel.logo}
        alt={channel.enName}
        width={96}
        height={96}
        className="size-full object-contain"
        unoptimized
      />
    </span>
  )
}

function StatusDot({
  connection,
  pairing,
  networkOnline,
}: {
  connection: MobileChannelConnection | undefined
  pairing: MobileChannelPairing | undefined
  networkOnline: boolean
}) {
  const offline =
    Boolean(connection?.enabled && connection.configured) && !networkOnline
  const connected =
    connection?.enabled && connection.status === "connected" && networkOnline
  const pending =
    !offline &&
    (connection?.status === "connecting" ||
      connection?.bindingPending ||
      activePairing(pairing))

  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full bg-muted-foreground/40",
        connected && "bg-emerald-500",
        pending && "animate-pulse bg-amber-500",
        offline && "bg-muted-foreground/60",
        connection?.status === "error" && !offline && "bg-destructive"
      )}
    />
  )
}

function SettingRow({
  title,
  description,
  children,
  className,
}: {
  title: string
  description: string
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-center",
        className
      )}
    >
      <div>
        <div className="text-base font-medium">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

function MobileChannelsPage() {
  const { locale } = useI18n()
  const copy = React.useMemo(() => getCopy(locale), [locale])
  const { open: sidebarOpen, isMobile } = useSidebar()
  const needsSidebarToggleOffset = isMobile || !sidebarOpen

  const [connections, setConnections] = React.useState<
    MobileChannelConnection[]
  >([])
  const [pairings, setPairings] = React.useState<MobileChannelPairing[]>([])
  const [projects, setProjects] = React.useState<StudioLocalProject[]>([])
  const [agentRuntimes, setAgentRuntimes] = React.useState<
    AgentRuntimeOption[]
  >([])
  const [agentModels, setAgentModels] = React.useState<AgentModelOption[]>([])
  const [runtimeModelSettings, setRuntimeModelSettings] = React.useState<
    Record<string, { defaultModel: string }>
  >({})
  const [draftProjects, setDraftProjects] = React.useState<
    Partial<Record<MobileChannelProvider, string>>
  >({})
  const [loading, setLoading] = React.useState(true)
  const [networkOnline, setNetworkOnline] = React.useState(true)
  const [selected, setSelected] = React.useState<
    "new" | MobileChannelProvider | null
  >(null)
  const [busyProvider, setBusyProvider] =
    React.useState<MobileChannelProvider | null>(null)
  const [pairing, setPairing] = React.useState<MobileChannelPairing | null>(
    null
  )
  const [verificationCode, setVerificationCode] = React.useState("")
  const [submittingVerification, setSubmittingVerification] =
    React.useState(false)
  const [credentialProvider, setCredentialProvider] = React.useState<
    "telegram" | "discord" | null
  >(null)
  const [telegramBotToken, setTelegramBotToken] = React.useState("")
  const [discordApplicationId, setDiscordApplicationId] = React.useState("")
  const [discordBotToken, setDiscordBotToken] = React.useState("")
  const [removeTarget, setRemoveTarget] =
    React.useState<MobileChannelConnection | null>(null)
  const [removing, setRemoving] = React.useState(false)
  const terminalPairingRefreshRef = React.useRef<string | null>(null)
  const connectionRequestVersionRef = React.useRef(0)
  const connectionAppliedVersionRef = React.useRef(0)

  const loadOverview = React.useCallback(async () => {
    const connectionRequestVersion = ++connectionRequestVersionRef.current
    try {
      const [
        channelsResponse,
        projectsResponse,
        runtimesResponse,
        modelSettingsResponse,
      ] = await Promise.all([
        fetch("/api/mobile/channels", { cache: "no-store" }),
        fetch("/api/studio/local-projects", { cache: "no-store" }),
        fetch("/api/studio/agent-runtimes", { cache: "no-store" }),
        fetch("/api/studio/agent-model-settings", { cache: "no-store" }),
      ])
      const channels =
        (await channelsResponse.json()) as ChannelOverviewResponse
      const localProjects =
        (await projectsResponse.json()) as LocalProjectsResponse
      const runtimes = (await runtimesResponse.json()) as AgentRuntimesResponse
      const modelSettings =
        (await modelSettingsResponse.json()) as AgentModelSettingsResponse

      if (!channelsResponse.ok || !channels.ok || !channels.data) {
        throw new Error(copy.loadFailed)
      }

      if (connectionRequestVersion > connectionAppliedVersionRef.current) {
        connectionAppliedVersionRef.current = connectionRequestVersion
        setConnections((current) =>
          updateConnectionSnapshot(current, channels.data!.connections)
        )
      }
      setPairings(channels.data.pairings)
      setPairing((current) => {
        if (current) {
          return (
            channels.data!.pairings.find((item) => item.id === current.id) ??
            current
          )
        }
        return (
          channels.data!.pairings.find((item) => activePairing(item)) ?? null
        )
      })
      if (projectsResponse.ok && localProjects.ok && localProjects.data) {
        setProjects(localProjects.data)
      }
      if (runtimesResponse.ok && runtimes.ok && runtimes.data) {
        setAgentRuntimes(runtimes.data)
      }
      if (
        modelSettingsResponse.ok &&
        modelSettings.ok &&
        modelSettings.data?.models
      ) {
        setAgentModels(modelSettings.data.models)
        setRuntimeModelSettings(modelSettings.data.runtimes ?? {})
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [copy.loadFailed])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadOverview()
    })
  }, [loadOverview])

  React.useEffect(() => {
    const controller = new AbortController()
    let refreshInFlight = false

    const refreshConnectionStatus = async () => {
      if (
        refreshInFlight ||
        controller.signal.aborted ||
        document.visibilityState === "hidden" ||
        !navigator.onLine
      ) {
        return
      }

      refreshInFlight = true
      const requestVersion = ++connectionRequestVersionRef.current
      try {
        const response = await fetch("/api/mobile/channels/status", {
          cache: "no-store",
          signal: controller.signal,
        })
        const payload = (await response.json()) as ConnectionStatusResponse
        if (
          response.ok &&
          payload.ok &&
          payload.data &&
          requestVersion > connectionAppliedVersionRef.current
        ) {
          connectionAppliedVersionRef.current = requestVersion
          setConnections((current) =>
            updateConnectionSnapshot(current, payload.data!.connections)
          )
        }
      } catch {
        // Runtime status polling is best-effort; the next tick or online event
        // retries without interrupting the rest of the settings page.
      } finally {
        refreshInFlight = false
      }
    }

    const refreshWhenAvailable = () => {
      const online = navigator.onLine
      setNetworkOnline(online)
      if (online && document.visibilityState !== "hidden") {
        void refreshConnectionStatus()
      }
    }
    const markOffline = () => setNetworkOnline(false)

    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        refreshWhenAvailable()
      }
    })
    const interval = window.setInterval(
      () => void refreshConnectionStatus(),
      MOBILE_CONNECTION_STATUS_POLL_MS
    )
    window.addEventListener("online", refreshWhenAvailable)
    window.addEventListener("offline", markOffline)
    window.addEventListener("focus", refreshWhenAvailable)
    document.addEventListener("visibilitychange", refreshWhenAvailable)

    return () => {
      controller.abort()
      window.clearInterval(interval)
      window.removeEventListener("online", refreshWhenAvailable)
      window.removeEventListener("offline", markOffline)
      window.removeEventListener("focus", refreshWhenAvailable)
      document.removeEventListener("visibilitychange", refreshWhenAvailable)
    }
  }, [])

  React.useEffect(() => {
    const pairingId = pairing?.id
    const pairingStatus = pairing?.status

    if (!pairingId || !pairingStatus) {
      terminalPairingRefreshRef.current = null
      return
    }

    if (
      ["connected", "paused", "expired", "cancelled", "error"].includes(
        pairingStatus
      )
    ) {
      const terminalRefreshKey = `${pairingId}:${pairingStatus}`
      if (terminalPairingRefreshRef.current === terminalRefreshKey) {
        return
      }
      terminalPairingRefreshRef.current = terminalRefreshKey
      queueMicrotask(() => {
        void loadOverview()
      })
      return
    }

    terminalPairingRefreshRef.current = null
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/mobile/channels/pairings/${pairingId}`,
            { cache: "no-store" }
          )
          const payload = (await response.json()) as PairingResponse
          if (response.ok && payload.ok && payload.data) {
            setPairing(payload.data)
            setPairings((current) => [
              payload.data!,
              ...current.filter((item) => item.id !== payload.data!.id),
            ])
          }
        } catch {
          // A transient polling failure should not dismiss a usable QR code.
        }
      })()
    }, 1_500)

    return () => window.clearInterval(interval)
  }, [loadOverview, pairing?.id, pairing?.status])

  const connectionByProvider = React.useMemo(
    () =>
      new Map(
        connections.map((connection) => [connection.provider, connection])
      ),
    [connections]
  )
  const pairingByProvider = React.useMemo(() => {
    const result = new Map<MobileChannelProvider, MobileChannelPairing>()
    for (const item of pairings) {
      if (!result.has(item.provider)) {
        result.set(item.provider, item)
      }
    }
    return result
  }, [pairings])

  const botProviders = React.useMemo(
    () =>
      mobileChannelProviders.filter(
        (provider) =>
          connectionByProvider.has(provider) ||
          activePairing(pairingByProvider.get(provider))
      ),
    [connectionByProvider, pairingByProvider]
  )

  const effectiveSelected: "new" | MobileChannelProvider =
    selected ?? botProviders[0] ?? "new"

  function selectProvider(provider: MobileChannelProvider) {
    setSelected(provider)
    setVerificationCode("")
    const latest = pairingByProvider.get(provider)
    setPairing(latest ?? null)
  }

  function requestPairing(provider: MobileChannelProvider) {
    if (provider === "telegram" || provider === "discord") {
      setSelected(provider)
      setPairing(null)
      setCredentialProvider(provider)
      return
    }

    void startPairing(provider)
  }

  function closeCredentialDialog() {
    setCredentialProvider(null)
    setTelegramBotToken("")
    setDiscordApplicationId("")
    setDiscordBotToken("")
  }

  async function startPairing(provider: MobileChannelProvider) {
    setSelected(provider)
    setPairing(null)
    setVerificationCode("")
    setBusyProvider(provider)

    try {
      const connection = connectionByProvider.get(provider)
      const defaultProjectId =
        connection?.defaultProjectId || draftProjects[provider] || null
      const body = {
        defaultProjectId,
        ...(provider === "telegram"
          ? { telegramBotToken: telegramBotToken.trim() }
          : {}),
        ...(provider === "discord"
          ? {
              discordApplicationId: discordApplicationId.trim(),
              discordBotToken: discordBotToken.trim(),
            }
          : {}),
      }
      const response = await fetch(
        `/api/mobile/channels/pairings/start/${provider}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      const payload = (await response.json()) as PairingResponse
      if (payload.data) {
        setPairing(payload.data)
        setPairings((current) => [
          payload.data!,
          ...current.filter((item) => item.provider !== provider),
        ])
      }
      if (!response.ok || !payload.data) {
        throw new Error(payload.data?.error || copy.actionFailed)
      }
      if (provider === "telegram") {
        setTelegramBotToken("")
      } else if (provider === "discord") {
        setDiscordApplicationId("")
        setDiscordBotToken("")
      }
      setCredentialProvider(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed)
    } finally {
      setBusyProvider(null)
    }
  }

  function submitCredentialPairing() {
    if (!credentialProvider) {
      return
    }

    const valid =
      credentialProvider === "telegram"
        ? /^\d+:[A-Za-z0-9_-]{20,}$/.test(telegramBotToken.trim())
        : /^\d{16,22}$/.test(discordApplicationId.trim()) &&
          discordBotToken.trim().length >= 30 &&
          !/\s/.test(discordBotToken.trim())
    if (!valid) {
      toast.error(copy.credentialInvalid)
      return
    }

    void startPairing(credentialProvider)
  }

  async function patchConnection(
    connection: MobileChannelConnection,
    body: Record<string, unknown>,
    successMessage: string
  ) {
    try {
      const response = await fetch(
        `/api/mobile/channels/connections/${connection.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      )
      const payload = (await response.json()) as ConnectionMutationResponse
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(copy.actionFailed)
      }
      if (
        Object.hasOwn(body, "agentRuntimeId") ||
        Object.hasOwn(body, "chatModel") ||
        Object.hasOwn(body, "reasoningEffort")
      ) {
        const runtimeId =
          payload.data.agentRuntimeId ?? DEFAULT_AGENT_RUNTIME_ID
        const availableModels = agentModels.filter(
          (model) =>
            model.enabled && model.supportedRuntimeIds.includes(runtimeId)
        )
        const model =
          availableModels.find(
            (candidate) => candidate.id === payload.data?.chatModel
          ) ??
          availableModels.find(
            (candidate) =>
              candidate.id === runtimeModelSettings[runtimeId]?.defaultModel
          ) ??
          availableModels[0]
        if (model) {
          const reasoningEffort =
            payload.data.reasoningEffort &&
            model.reasoningEfforts.includes(payload.data.reasoningEffort)
              ? payload.data.reasoningEffort
              : model.defaultReasoningEffort
          const defaults = {
            runtimeId,
            model: model.id,
            reasoningEffort,
          }
          writeStoredChatDefaults(defaults)
          setStoredChatRuntime(defaults.runtimeId)
          setStoredChatModel(defaults.model)
          setStoredChatReasoningEffort(defaults.model, defaults.reasoningEffort)
        }
      }
      dispatchStudioSessionsChanged()
      toast.success(successMessage)
      await loadOverview()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed)
    }
  }

  async function updateWorkspace(
    provider: MobileChannelProvider,
    value: string
  ) {
    const projectId = value === "__none" ? null : value
    const connection = connectionByProvider.get(provider)

    if (!connection) {
      setDraftProjects((current) => ({
        ...current,
        [provider]: projectId ?? undefined,
      }))
      return
    }

    await patchConnection(
      connection,
      { defaultProjectId: projectId },
      copy.saved
    )
  }

  async function updateGranularity(
    connection: MobileChannelConnection,
    value: MobileChannelReplyGranularity
  ) {
    await patchConnection(connection, { replyGranularity: value }, copy.saved)
  }

  async function updatePermissionMode(
    connection: MobileChannelConnection,
    value: StudioPermissionMode
  ) {
    await patchConnection(connection, { permissionMode: value }, copy.saved)
  }

  async function updateAgentRuntime(
    connection: MobileChannelConnection,
    value: string
  ) {
    const runtimeId = value === "__default" ? null : value
    const effectiveRuntimeId = runtimeId ?? DEFAULT_AGENT_RUNTIME_ID
    const body: Record<string, unknown> = { agentRuntimeId: runtimeId }
    const selectedModelIsValid = Boolean(
      connection.chatModel &&
      agentModels.some(
        (model) =>
          model.id === connection.chatModel &&
          model.enabled &&
          model.supportedRuntimeIds.includes(effectiveRuntimeId)
      )
    )
    if (connection.chatModel && !selectedModelIsValid) {
      body.chatModel = null
    }
    const nextModelId = selectedModelIsValid
      ? connection.chatModel
      : runtimeModelSettings[effectiveRuntimeId]?.defaultModel
    const nextModel =
      agentModels.find((model) => model.id === nextModelId) ??
      agentModels.find(
        (model) =>
          model.enabled &&
          model.supportedRuntimeIds.includes(effectiveRuntimeId)
      )
    if (
      connection.reasoningEffort &&
      !nextModel?.reasoningEfforts.includes(
        connection.reasoningEffort as ChatReasoningEffort
      )
    ) {
      body.reasoningEffort = null
    }
    await patchConnection(connection, body, copy.saved)
  }

  async function updateChatModel(
    connection: MobileChannelConnection,
    value: string
  ) {
    const chatModel = value === "__default" ? null : value
    const nextModelId =
      chatModel ??
      runtimeModelSettings[
        connection.agentRuntimeId ?? DEFAULT_AGENT_RUNTIME_ID
      ]?.defaultModel
    const nextModel =
      agentModels.find((model) => model.id === nextModelId) ??
      agentModels.find(
        (model) =>
          model.enabled &&
          model.supportedRuntimeIds.includes(
            connection.agentRuntimeId ?? DEFAULT_AGENT_RUNTIME_ID
          )
      )
    const body: Record<string, unknown> = { chatModel }
    if (
      connection.reasoningEffort &&
      !nextModel?.reasoningEfforts.includes(
        connection.reasoningEffort as ChatReasoningEffort
      )
    ) {
      body.reasoningEffort = null
    }
    await patchConnection(connection, body, copy.saved)
  }

  async function updateReasoningEffort(
    connection: MobileChannelConnection,
    value: string
  ) {
    await patchConnection(
      connection,
      {
        reasoningEffort:
          value === "__default" ? null : (value as ChatReasoningEffort),
      },
      copy.saved
    )
  }

  async function toggleConnection(
    connection: MobileChannelConnection,
    enabled: boolean
  ) {
    setBusyProvider(connection.provider)
    try {
      const url = enabled
        ? `/api/mobile/channels/connections/${connection.id}/connect`
        : `/api/mobile/channels/connections/${connection.id}`
      const response = await fetch(url, {
        method: enabled ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: enabled ? undefined : JSON.stringify({ enabled: false }),
      })
      if (!response.ok) {
        throw new Error(copy.actionFailed)
      }
      toast.success(enabled ? copy.resumed : copy.paused)
      await loadOverview()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed)
    } finally {
      setBusyProvider(null)
    }
  }

  async function submitVerification() {
    if (!pairing || !/^\d{4,10}$/.test(verificationCode.trim())) {
      return
    }

    setSubmittingVerification(true)
    try {
      const response = await fetch(
        `/api/mobile/channels/pairings/${pairing.id}/verification`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: verificationCode.trim() }),
        }
      )
      const payload = (await response.json()) as PairingResponse
      if (!response.ok || !payload.data) {
        throw new Error(copy.actionFailed)
      }
      setPairing(payload.data)
      setVerificationCode("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed)
    } finally {
      setSubmittingVerification(false)
    }
  }

  async function removeConnection() {
    if (!removeTarget) {
      return
    }

    setRemoving(true)
    try {
      const response = await fetch(
        `/api/mobile/channels/connections/${removeTarget.id}`,
        { method: "DELETE" }
      )
      if (!response.ok) {
        throw new Error(copy.actionFailed)
      }
      toast.success(copy.removed)
      setRemoveTarget(null)
      setPairing(null)
      setSelected("new")
      await loadOverview()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed)
    } finally {
      setRemoving(false)
    }
  }

  async function copyBindCommand() {
    if (!pairing?.bindCommand) {
      return
    }

    try {
      await navigator.clipboard.writeText(pairing.bindCommand)
      toast.success(copy.copied)
    } catch {
      toast.error(copy.actionFailed)
    }
  }

  const selectedProvider =
    effectiveSelected !== "new" ? effectiveSelected : null
  const selectedChannel = selectedProvider
    ? channelByProvider.get(selectedProvider)
    : null
  const selectedConnection = selectedProvider
    ? connectionByProvider.get(selectedProvider)
    : undefined
  const visiblePairing =
    pairing && pairing.provider === selectedProvider
      ? pairing
      : selectedProvider
        ? (pairingByProvider.get(selectedProvider) ?? null)
        : null
  const effectiveRuntimeId =
    selectedConnection?.agentRuntimeId ?? DEFAULT_AGENT_RUNTIME_ID
  const modelOptions = agentModels.filter(
    (model) =>
      model.enabled && model.supportedRuntimeIds.includes(effectiveRuntimeId)
  )
  const selectedModelMissing = Boolean(
    selectedConnection?.chatModel &&
    !modelOptions.some((model) => model.id === selectedConnection.chatModel)
  )
  const effectiveModelId =
    selectedConnection?.chatModel ??
    runtimeModelSettings[effectiveRuntimeId]?.defaultModel
  const effectiveModel =
    agentModels.find((model) => model.id === effectiveModelId) ??
    modelOptions[0]
  const reasoningOptions = effectiveModel?.reasoningEfforts ?? []
  const selectedReasoningEffort =
    selectedConnection?.reasoningEffort &&
    reasoningOptions.includes(
      selectedConnection.reasoningEffort as ChatReasoningEffort
    )
      ? (selectedConnection.reasoningEffort as ChatReasoningEffort)
      : null

  return (
    <main className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
      <section
        className={getSidebarAwarePageInsetClassName({
          className: "min-h-0 flex-1 overflow-y-auto",
          needsSidebarToggleOffset,
          variant: "standard",
        })}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-8">
          {loading ? (
            <div className="flex flex-col gap-6 lg:flex-row">
              <Skeleton className="h-40 rounded-3xl lg:w-80" />
              <Skeleton className="h-[32rem] flex-1 rounded-3xl" />
            </div>
          ) : (
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
              <div className="flex w-full shrink-0 flex-col gap-2 lg:w-80">
                <button
                  type="button"
                  onClick={() => {
                    setSelected("new")
                    setPairing(null)
                  }}
                  className={cn(
                    "flex items-center gap-2.5 rounded-2xl border px-4 py-3.5 text-base font-medium transition-colors hover:bg-muted/60",
                    effectiveSelected === "new" && "bg-muted/60"
                  )}
                >
                  <RiAddLine className="size-5 text-muted-foreground" />
                  {copy.newBot}
                </button>

                <div className="flex flex-col gap-1 pt-1">
                  {botProviders.map((provider) => {
                    const channel = channelByProvider.get(provider)
                    if (!channel) {
                      return null
                    }
                    const connection = connectionByProvider.get(provider)
                    const latestPairing = pairingByProvider.get(provider)

                    return (
                      <button
                        key={provider}
                        type="button"
                        onClick={() => selectProvider(provider)}
                        className={cn(
                          "flex items-center gap-3.5 rounded-2xl px-3.5 py-3 text-left transition-colors hover:bg-muted/60",
                          effectiveSelected === provider && "bg-muted/70"
                        )}
                      >
                        <ChannelLogo channel={channel} className="size-11" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-medium">
                            {connection?.displayName || copy.botFallbackName}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2 text-sm text-muted-foreground">
                            {locale === "zh" ? channel.zhName : channel.enName}
                            {channel.badge ? (
                              <Badge variant="outline">{channel.badge}</Badge>
                            ) : null}
                          </span>
                        </span>
                        <StatusDot
                          connection={connection}
                          pairing={latestPairing}
                          networkOnline={networkOnline}
                        />
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="min-w-0 flex-1 rounded-3xl border bg-card/60 p-6 sm:p-8">
                {effectiveSelected === "new" || !selectedChannel ? (
                  <div className="flex flex-col gap-6">
                    <div>
                      <h2 className="font-heading text-xl font-semibold">
                        {copy.newBotHeading}
                      </h2>
                      <p className="mt-2 max-w-3xl text-base leading-7 text-muted-foreground">
                        {copy.newBotDescription}
                      </p>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-2">
                      {channelDefinitions.map((channel) => {
                        const available = channel.provider !== null
                        const description = available
                          ? locale === "zh"
                            ? channel.zhDescription
                            : channel.enDescription
                          : copy.comingSoon

                        return (
                          <button
                            key={channel.key}
                            type="button"
                            disabled={!available}
                            onClick={() => {
                              if (!channel.provider) {
                                return
                              }
                              if (connectionByProvider.has(channel.provider)) {
                                selectProvider(channel.provider)
                              } else {
                                requestPairing(channel.provider)
                              }
                            }}
                            className={cn(
                              "flex items-start gap-4 rounded-2xl border bg-background/40 p-5 text-left transition-colors",
                              available
                                ? "hover:border-foreground/20 hover:bg-muted/50"
                                : "cursor-default opacity-55"
                            )}
                          >
                            <ChannelLogo
                              channel={channel}
                              className="size-12"
                            />
                            <span className="min-w-0">
                              <span className="flex items-center gap-2.5 text-lg font-semibold">
                                {locale === "zh"
                                  ? channel.zhName
                                  : channel.enName}
                                {channel.badge ? (
                                  <Badge variant="outline">
                                    {channel.badge}
                                  </Badge>
                                ) : null}
                              </span>
                              <span className="mt-1.5 block text-base leading-6 text-muted-foreground">
                                {description}
                              </span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    <div className="flex items-center gap-4">
                      <ChannelLogo
                        channel={selectedChannel}
                        className="size-12"
                      />
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate font-heading text-xl font-semibold">
                          {selectedConnection?.displayName ||
                            copy.botFallbackName}
                        </h2>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                          <RiTimeLine className="size-4" aria-hidden />
                          {connectionStatusLabel(
                            selectedConnection,
                            copy,
                            visiblePairing,
                            networkOnline
                          )}
                        </p>
                      </div>
                      <Switch
                        checked={Boolean(
                          selectedConnection?.configured &&
                          selectedConnection.enabled
                        )}
                        disabled={
                          !selectedConnection?.configured ||
                          busyProvider === selectedProvider
                        }
                        onCheckedChange={(checked) => {
                          if (selectedConnection) {
                            void toggleConnection(selectedConnection, checked)
                          }
                        }}
                        aria-label={copy.enableAria}
                      />
                    </div>

                    {selectedConnection?.enabled &&
                    selectedConnection.configured &&
                    !networkOnline ? (
                      <div className="flex items-start gap-2.5 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
                        <RiErrorWarningLine className="mt-0.5 size-4 shrink-0" />
                        <span>{copy.networkOfflineDescription}</span>
                      </div>
                    ) : selectedConnection?.lastError ? (
                      <div className="flex items-start gap-2.5 rounded-2xl bg-destructive/8 px-4 py-3 text-sm text-destructive">
                        <RiErrorWarningLine className="mt-0.5 size-4 shrink-0" />
                        <span>
                          {copy.connectionError}: {selectedConnection.lastError}
                        </span>
                      </div>
                    ) : null}

                    <div className="rounded-2xl border">
                      <SettingRow
                        title={copy.linkBot}
                        description={
                          selectedConnection?.configured
                            ? copy.relinkBotDescription
                            : copy.linkBotDescription
                        }
                      >
                        <Button
                          variant="outline"
                          onClick={() =>
                            selectedProvider
                              ? requestPairing(selectedProvider)
                              : undefined
                          }
                          disabled={busyProvider === selectedProvider}
                        >
                          {busyProvider === selectedProvider ? (
                            <RiLoader4Line className="animate-spin" />
                          ) : (
                            <RiQrCodeLine />
                          )}
                          {selectedConnection?.configured
                            ? copy.relinkQr
                            : copy.scanQr}
                        </Button>
                      </SettingRow>

                      {visiblePairing ? (
                        <div className="border-t p-5">
                          <PairingPanel
                            pairing={visiblePairing}
                            hasExistingConnection={Boolean(
                              selectedConnection?.configured
                            )}
                            channelLabel={
                              selectedProvider
                                ? channelName(selectedProvider, locale)
                                : ""
                            }
                            copy={copy}
                            verificationCode={verificationCode}
                            onVerificationCodeChange={setVerificationCode}
                            submittingVerification={submittingVerification}
                            onSubmitVerification={() =>
                              void submitVerification()
                            }
                            onCopyBindCommand={() => void copyBindCommand()}
                            onRetry={() =>
                              selectedProvider
                                ? requestPairing(selectedProvider)
                                : undefined
                            }
                            retryBusy={busyProvider === selectedProvider}
                          />
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border">
                      <SettingRow
                        title={copy.agent}
                        description={copy.agentDescription}
                      >
                        <Select
                          value={
                            selectedConnection?.agentRuntimeId ?? "__default"
                          }
                          disabled={!selectedConnection}
                          onValueChange={(value) => {
                            if (selectedConnection) {
                              void updateAgentRuntime(selectedConnection, value)
                            }
                          }}
                        >
                          <SelectTrigger className="w-full sm:w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper" align="end">
                            <SelectGroup>
                              <SelectItem value="__default">
                                {copy.followDefault}
                              </SelectItem>
                              {agentRuntimes.map((runtime) => (
                                <SelectItem key={runtime.id} value={runtime.id}>
                                  {runtime.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </SettingRow>

                      <SettingRow
                        className="border-t"
                        title={copy.model}
                        description={copy.modelDescription}
                      >
                        <div className="flex w-full flex-col gap-2 sm:w-56">
                          <Select
                            value={selectedConnection?.chatModel ?? "__default"}
                            disabled={!selectedConnection}
                            onValueChange={(value) => {
                              if (selectedConnection) {
                                void updateChatModel(selectedConnection, value)
                              }
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper" align="end">
                              <SelectGroup>
                                <SelectItem value="__default">
                                  {copy.followDefault}
                                </SelectItem>
                                {selectedModelMissing &&
                                selectedConnection?.chatModel ? (
                                  <SelectItem
                                    value={selectedConnection.chatModel}
                                  >
                                    {selectedConnection.chatModel}
                                  </SelectItem>
                                ) : null}
                                {modelOptions.map((model) => (
                                  <SelectItem key={model.id} value={model.id}>
                                    {model.label}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>

                          <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-2.5 py-1.5">
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {copy.reasoningEffort}
                            </span>
                            <Select
                              value={selectedReasoningEffort ?? "__default"}
                              disabled={
                                !selectedConnection ||
                                reasoningOptions.length === 0
                              }
                              onValueChange={(value) => {
                                if (selectedConnection) {
                                  void updateReasoningEffort(
                                    selectedConnection,
                                    value
                                  )
                                }
                              }}
                            >
                              <SelectTrigger
                                size="xs"
                                className="max-w-36 min-w-0 flex-1 bg-background/80"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent position="popper" align="end">
                                <SelectGroup>
                                  <SelectItem value="__default">
                                    {copy.reasoningDefault(
                                      reasoningEffortLabel(
                                        effectiveModel?.defaultReasoningEffort ??
                                          "medium",
                                        copy
                                      )
                                    )}
                                  </SelectItem>
                                  {reasoningOptions.map((effort) => (
                                    <SelectItem key={effort} value={effort}>
                                      {reasoningEffortLabel(effort, copy)}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </SettingRow>

                      <SettingRow
                        className="border-t"
                        title={copy.replyGranularity}
                        description={copy.replyGranularityDescription}
                      >
                        <Select
                          value={
                            selectedConnection?.replyGranularity ?? "standard"
                          }
                          disabled={!selectedConnection}
                          onValueChange={(value) => {
                            if (selectedConnection) {
                              void updateGranularity(
                                selectedConnection,
                                value as MobileChannelReplyGranularity
                              )
                            }
                          }}
                        >
                          <SelectTrigger className="w-full sm:w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper" align="end">
                            <SelectGroup>
                              <SelectItem value="standard">
                                {copy.granularityStandard}
                              </SelectItem>
                              <SelectItem value="full">
                                {copy.granularityFull}
                              </SelectItem>
                              <SelectItem value="summary">
                                {copy.granularitySummary}
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </SettingRow>

                      <SettingRow
                        className="border-t"
                        title={copy.permissionMode}
                        description={copy.permissionModeDescription}
                      >
                        <Select
                          value={selectedConnection?.permissionMode ?? "auto"}
                          disabled={!selectedConnection}
                          onValueChange={(value) => {
                            if (selectedConnection) {
                              void updatePermissionMode(
                                selectedConnection,
                                value as StudioPermissionMode
                              )
                            }
                          }}
                        >
                          <SelectTrigger className="w-full sm:w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper" align="end">
                            <SelectGroup>
                              <SelectItem value="auto">
                                {copy.permissionAuto}
                              </SelectItem>
                              <SelectItem value="ask">
                                {copy.permissionAsk}
                              </SelectItem>
                              <SelectItem value="full_access">
                                {copy.permissionFullAccess}
                              </SelectItem>
                              <SelectItem value="readonly">
                                {copy.permissionReadonly}
                              </SelectItem>
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </SettingRow>

                      <SettingRow
                        className="border-t"
                        title={copy.workspace}
                        description={copy.workspaceDescription}
                      >
                        <Select
                          value={
                            selectedConnection?.defaultProjectId ||
                            (selectedProvider
                              ? draftProjects[selectedProvider]
                              : undefined) ||
                            "__none"
                          }
                          onValueChange={(value) => {
                            if (selectedProvider) {
                              void updateWorkspace(selectedProvider, value)
                            }
                          }}
                        >
                          <SelectTrigger className="w-full sm:w-56">
                            <SelectValue placeholder={copy.noWorkspace} />
                          </SelectTrigger>
                          <SelectContent position="popper" align="end">
                            <SelectGroup>
                              <SelectItem value="__none">
                                {copy.noWorkspace}
                              </SelectItem>
                              {projects.map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                  <span className="max-w-64 truncate">
                                    {project.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </SettingRow>
                    </div>

                    {selectedConnection ? (
                      <div className="rounded-2xl border">
                        <SettingRow
                          title={copy.deleteBot}
                          description={copy.deleteBotDescription}
                        >
                          <Button
                            variant="destructive"
                            onClick={() => setRemoveTarget(selectedConnection)}
                          >
                            <RiDeleteBinLine />
                            {copy.deleteBot}
                          </Button>
                        </SettingRow>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <Dialog
        open={credentialProvider !== null}
        onOpenChange={(open) => {
          if (!open && busyProvider !== credentialProvider) {
            closeCredentialDialog()
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {credentialProvider
                ? copy.credentialTitle(channelName(credentialProvider, locale))
                : copy.linkBot}
            </DialogTitle>
            <DialogDescription>
              {credentialProvider === "telegram"
                ? copy.telegramCredentialDescription
                : copy.discordCredentialDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-1">
            {credentialProvider === "discord" ? (
              <label className="flex flex-col gap-2 text-sm font-medium">
                {copy.applicationId}
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  value={discordApplicationId}
                  onChange={(event) =>
                    setDiscordApplicationId(
                      event.target.value.replace(/\D/g, "").slice(0, 22)
                    )
                  }
                  placeholder="123456789012345678"
                />
              </label>
            ) : null}

            <label className="flex flex-col gap-2 text-sm font-medium">
              {copy.botToken}
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={
                  credentialProvider === "telegram"
                    ? telegramBotToken
                    : discordBotToken
                }
                onChange={(event) => {
                  if (credentialProvider === "telegram") {
                    setTelegramBotToken(event.target.value)
                  } else {
                    setDiscordBotToken(event.target.value)
                  }
                }}
                placeholder={
                  credentialProvider === "telegram"
                    ? "123456789:AA…"
                    : "••••••••••••••••••••"
                }
              />
            </label>

            <p className="text-sm leading-6 text-muted-foreground">
              {copy.credentialPrivacy}
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={closeCredentialDialog}
              disabled={busyProvider === credentialProvider}
            >
              {copy.cancel}
            </Button>
            <Button
              onClick={submitCredentialPairing}
              disabled={busyProvider === credentialProvider}
            >
              {busyProvider === credentialProvider ? (
                <RiLoader4Line className="animate-spin" />
              ) : (
                <RiQrCodeLine />
              )}
              {copy.continueToQr}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !removing) {
            setRemoveTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {removeTarget
                ? copy.deleteConfirmTitle(
                    channelName(removeTarget.provider, locale)
                  )
                : copy.deleteBot}
            </DialogTitle>
            <DialogDescription>
              {copy.deleteConfirmDescription}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveTarget(null)}
              disabled={removing}
            >
              {copy.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void removeConnection()}
              disabled={removing}
            >
              {removing ? <RiLoader4Line className="animate-spin" /> : null}
              {removing ? copy.removing : copy.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function formatPairingRemainingTime(seconds: number) {
  const normalized = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(normalized / 3_600)
  const minutes = Math.floor((normalized % 3_600) / 60)
  const remainingSeconds = normalized % 60

  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
}

function usePairingRemainingSeconds(pairing: MobileChannelPairing) {
  const [clientNow, setClientNow] = React.useState(() => performance.now())
  const [clockAnchor] = React.useState(() => ({
    serverTime: pairing.serverTime,
    clientReceivedAtMs: performance.now(),
  }))

  React.useEffect(() => {
    if (!pairing.stepExpiresAt) {
      return
    }
    const interval = window.setInterval(
      () => setClientNow(performance.now()),
      1_000
    )
    return () => window.clearInterval(interval)
  }, [pairing.stepExpiresAt])

  if (!pairing.stepExpiresAt) {
    return null
  }
  return calculateServerRemainingSeconds({
    expiresAt: pairing.stepExpiresAt,
    serverTime: clockAnchor.serverTime,
    clientReceivedAtMs: clockAnchor.clientReceivedAtMs,
    clientNowMs: clientNow,
  })
}

function PairingCountdown({
  pairing,
  copy,
}: {
  pairing: MobileChannelPairing
  copy: Copy
}) {
  const remainingSeconds = usePairingRemainingSeconds(pairing)
  if (remainingSeconds === null || !activePairing(pairing)) {
    return null
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-background/70 px-3.5 py-2.5 text-sm text-muted-foreground ring-1 ring-foreground/6">
      <RiTimeLine className="size-4 shrink-0" aria-hidden />
      <span>
        {pairing.status === "awaiting_bind"
          ? copy.bindRemaining
          : pairing.status === "validating"
            ? copy.validationRemaining
            : copy.qrRemaining}
      </span>
      <strong className="font-mono text-foreground tabular-nums">
        {remainingSeconds > 0
          ? formatPairingRemainingTime(remainingSeconds)
          : copy.waitingServerExpiry}
      </strong>
      <span className="text-xs">
        ·
        {pairing.expirySource === "provider"
          ? copy.providerTime
          : pairing.expirySource === "provider_policy"
            ? copy.policyTime
            : pairing.expirySource === "local_validation"
              ? copy.localValidationTime
              : copy.localBindingTime}
      </span>
    </div>
  )
}

function PairingPanel({
  pairing,
  hasExistingConnection,
  channelLabel,
  copy,
  verificationCode,
  onVerificationCodeChange,
  submittingVerification,
  onSubmitVerification,
  onCopyBindCommand,
  onRetry,
  retryBusy,
}: {
  pairing: MobileChannelPairing
  hasExistingConnection: boolean
  channelLabel: string
  copy: Copy
  verificationCode: string
  onVerificationCodeChange: (value: string) => void
  submittingVerification: boolean
  onSubmitVerification: () => void
  onCopyBindCommand: () => void
  onRetry: () => void
  retryBusy: boolean
}) {
  const failed = ["expired", "cancelled", "error"].includes(pairing.status)
  const showQr =
    pairing.qrCodeDataUrl &&
    [
      "waiting_scan",
      "scanned",
      "verification_required",
      "waiting_confirmation",
      "awaiting_bind",
    ].includes(pairing.status)

  return (
    <div className="rounded-xl bg-muted/40 p-5">
      {hasExistingConnection && pairing.status !== "connected" ? (
        <p className="mb-4 flex items-start gap-2 rounded-xl bg-background/70 px-3.5 py-3 text-sm leading-6 text-muted-foreground ring-1 ring-foreground/6">
          <RiTimeLine className="mt-1 size-4 shrink-0" aria-hidden />
          {copy.existingConnectionNote}
        </p>
      ) : null}
      <PairingCountdown
        key={`${pairing.id}:${pairing.serverTime}:${pairing.stepExpiresAt ?? "none"}`}
        pairing={pairing}
        copy={copy}
      />
      {pairing.remoteStatus ? (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{copy.platformStatus}</span>
          <code className="rounded-md bg-background px-2 py-1 font-mono ring-1 ring-foreground/8">
            {pairing.remoteStatus}
          </code>
          {pairing.failureCode ? (
            <code className="rounded-md bg-destructive/8 px-2 py-1 font-mono text-destructive ring-1 ring-destructive/15">
              {pairing.failureCode}
            </code>
          ) : null}
        </p>
      ) : null}
      {pairing.status === "preparing" ? (
        <div className="flex items-center gap-3 text-base text-muted-foreground">
          <RiLoader4Line className="size-5 animate-spin" aria-hidden />
          {pairing.message || copy.preparing}
        </div>
      ) : pairing.status === "connected" ? (
        <div className="flex items-start gap-3 text-emerald-700 dark:text-emerald-400">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/15">
            <RiCheckLine className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 pt-1.5">
            <span className="block text-base font-medium">
              {copy.pairingConnected}
            </span>
            {pairing.message ? (
              <span className="mt-1 block text-sm leading-6 font-normal text-muted-foreground">
                {pairing.message}
              </span>
            ) : null}
          </span>
        </div>
      ) : pairing.status === "paused" ? (
        <div className="flex items-start gap-3 text-amber-700 dark:text-amber-400">
          <span className="flex size-9 items-center justify-center rounded-full bg-amber-500/15">
            <RiTimeLine className="size-5" aria-hidden />
          </span>
          <span className="min-w-0 pt-1.5">
            <span className="block text-base font-medium">
              {copy.pairingPaused}
            </span>
            {pairing.message ? (
              <span className="mt-1 block text-sm leading-6 font-normal text-muted-foreground">
                {pairing.message}
              </span>
            ) : null}
          </span>
        </div>
      ) : showQr ? (
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="shrink-0 self-center rounded-2xl bg-white p-2.5 shadow-sm sm:self-start">
            <Image
              src={pairing.qrCodeDataUrl!}
              alt={copy.scanWith(channelLabel)}
              width={224}
              height={224}
              className="size-52"
              unoptimized
              priority
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className="text-base">{copy.scanWith(channelLabel)}</p>
            <p className="flex items-center gap-2 text-base text-muted-foreground">
              <RiLoader4Line className="size-4 animate-spin" aria-hidden />
              {pairingStatusLabel(pairing, copy)}
            </p>
            {pairing.message ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {pairing.message}
              </p>
            ) : null}
            {pairing.status === "verification_required" ? (
              <div className="mt-1 flex max-w-sm flex-col gap-2">
                <label
                  htmlFor="mobile-channel-verification"
                  className="text-sm font-medium"
                >
                  {copy.verificationLabel}
                </label>
                <div className="flex gap-2">
                  <Input
                    id="mobile-channel-verification"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={verificationCode}
                    onChange={(event) =>
                      onVerificationCodeChange(
                        event.target.value.replace(/\D/g, "").slice(0, 10)
                      )
                    }
                    placeholder={copy.verificationPlaceholder}
                  />
                  <Button
                    onClick={onSubmitVerification}
                    disabled={
                      submittingVerification ||
                      !/^\d{4,10}$/.test(verificationCode)
                    }
                  >
                    {submittingVerification ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : null}
                    {submittingVerification
                      ? copy.submitting
                      : copy.submitVerification}
                  </Button>
                </div>
              </div>
            ) : null}
            {pairing.status === "awaiting_bind" && pairing.bindCommand ? (
              <div className="mt-1 flex flex-col gap-2">
                <p className="text-sm font-medium">{copy.bindInstruction}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <code className="min-w-0 flex-1 truncate rounded-xl bg-background px-3 py-2.5 font-mono text-sm font-semibold tracking-wide ring-1 ring-foreground/8">
                    {pairing.bindCommand}
                  </code>
                  <Button variant="outline" onClick={onCopyBindCommand}>
                    <RiFileCopyLine />
                    {copy.copyCommand}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : pairing.status === "awaiting_bind" && pairing.bindCommand ? (
        <div className="flex flex-col gap-3">
          <p className="text-base">{copy.bindInstruction}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-background px-4 py-3 font-mono text-base font-semibold tracking-wide ring-1 ring-foreground/8">
              {pairing.bindCommand}
            </code>
            <Button variant="outline" onClick={onCopyBindCommand}>
              <RiFileCopyLine />
              {copy.copyCommand}
            </Button>
          </div>
        </div>
      ) : failed ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-2 text-base text-muted-foreground">
            <RiErrorWarningLine
              className="mt-0.5 size-5 shrink-0"
              aria-hidden
            />
            <div className="min-w-0">
              <p>
                {pairing.error ||
                  pairing.message ||
                  pairingStatusLabel(pairing, copy)}
              </p>
              {pairing.failureCode ? (
                <p className="mt-1 font-mono text-xs text-muted-foreground/80">
                  {copy.failureCode(pairing.failureCode)}
                </p>
              ) : null}
              {!pairing.retryable ? (
                <p className="mt-1 text-sm">{copy.nonRetryableHint}</p>
              ) : null}
            </div>
          </div>
          <Button onClick={onRetry} disabled={retryBusy}>
            {retryBusy ? (
              <RiLoader4Line className="animate-spin" />
            ) : (
              <RiRefreshLine />
            )}
            {copy.retry}
          </Button>
        </div>
      ) : (
        <p className="flex items-center gap-2 text-base text-muted-foreground">
          <RiLoader4Line className="size-4 animate-spin" aria-hidden />
          {pairingStatusLabel(pairing, copy)}
        </p>
      )}
    </div>
  )
}

export { MobileChannelsPage }
