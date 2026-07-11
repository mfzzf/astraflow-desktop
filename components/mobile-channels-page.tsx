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
import type {
  MobileChannelConnection,
  MobileChannelPairing,
  MobileChannelProvider,
  MobileChannelReplyGranularity,
} from "@/lib/mobile-channels/types"
import { mobileChannelProviders } from "@/lib/mobile-channels/types"
import type { StudioLocalProject } from "@/lib/studio-types"
import { cn } from "@/lib/utils"

type ChannelOverviewResponse = {
  ok: boolean
  data?: {
    connections: MobileChannelConnection[]
    pairings: MobileChannelPairing[]
  }
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
}

type AgentRuntimesResponse = {
  ok: boolean
  data?: AgentRuntimeOption[]
}

type AgentModelSettingsResponse = {
  ok: boolean
  data?: {
    models?: AgentModelOption[]
  }
}

const DEFAULT_AGENT_RUNTIME_ID = "astraflow"

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
      linkBot: "绑定机器人",
      linkBotDescription: "扫码后凭据将自动保存。",
      scanQr: "扫码绑定",
      scanWith: (channel: string) => `请使用${channel}扫码并确认。`,
      preparing: "正在生成二维码…",
      waitingScan: "等待扫码",
      scanned: "已扫码，请在手机上确认",
      verificationRequired: "需要输入验证码",
      waitingConfirmation: "正在确认授权",
      awaitingBind: "发送绑定命令完成最后一步",
      pairingConnected: "绑定完成",
      pairingExpired: "二维码已过期",
      pairingCancelled: "绑定已取消",
      pairingError: "绑定失败",
      retry: "重新生成",
      verificationLabel: "手机端验证码",
      verificationPlaceholder: "输入 4–10 位数字",
      submitVerification: "提交",
      submitting: "提交中",
      bindInstruction: "在手机上打开刚创建的机器人，发送：",
      copyCommand: "复制命令",
      copied: "绑定命令已复制。",
      replyGranularity: "回复粒度",
      replyGranularityDescription: "消息回复的详细程度。",
      granularityStandard: "标准回复",
      granularityFull: "完整回复",
      granularitySummary: "摘要回复",
      agent: "Agent",
      agentDescription: "处理此机器人任务的本机智能体。",
      model: "模型",
      modelDescription: "运行任务时使用的模型。",
      followDefault: "跟随默认",
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
    linkBot: "Link bot",
    linkBotDescription: "Credentials are saved after scan.",
    scanQr: "Scan QR code",
    scanWith: (channel: string) => `Scan with ${channel} and confirm.`,
    preparing: "Generating QR code…",
    waitingScan: "Waiting for scan",
    scanned: "Scanned — confirm on your phone",
    verificationRequired: "Verification code required",
    waitingConfirmation: "Confirming authorization",
    awaitingBind: "One more step: send the bind command",
    pairingConnected: "Bound successfully",
    pairingExpired: "QR code expired",
    pairingCancelled: "Setup cancelled",
    pairingError: "Binding failed",
    retry: "Generate again",
    verificationLabel: "Verification code",
    verificationPlaceholder: "Enter 4–10 digits",
    submitVerification: "Submit",
    submitting: "Submitting",
    bindInstruction: "Open the bot you just created and send:",
    copyCommand: "Copy command",
    copied: "Bind command copied.",
    replyGranularity: "Bot reply granularity",
    replyGranularityDescription: "Message detail level.",
    granularityStandard: "Standard reply",
    granularityFull: "Full reply",
    granularitySummary: "Summary reply",
    agent: "Agent",
    agentDescription: "The local agent that handles this bot's tasks.",
    model: "Model",
    modelDescription: "Model used when running tasks.",
    followDefault: "Follow default",
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
    enDescription: "Scan to log in; first message activates.",
    zhDescription: "扫码登录，收到首条消息后激活。",
  },
  {
    key: "feishu",
    provider: "feishu",
    logo: "/channel-logos/feishu.png",
    enName: "Feishu",
    zhName: "飞书",
    badge: "CN",
    enDescription: "Scan to create an app, then bind by message.",
    zhDescription: "扫码创建应用，再通过消息绑定。",
  },
  {
    key: "wecom",
    provider: "wecom",
    logo: "/channel-logos/wecom.png",
    enName: "WeCom",
    zhName: "企业微信",
    badge: null,
    enDescription: "Official AI bot for direct and group chats.",
    zhDescription: "官方智能机器人，支持单聊与群聊。",
  },
  {
    key: "dingtalk",
    provider: "dingtalk",
    logo: "/channel-logos/dingtalk.png",
    enName: "DingTalk",
    zhName: "钉钉",
    badge: null,
    enDescription: "Stream mode; no public callback URL needed.",
    zhDescription: "Stream 模式连接，无需公网回调地址。",
  },
  {
    key: "lark",
    provider: null,
    logo: "/channel-logos/lark.png",
    enName: "Lark",
    zhName: "Lark",
    badge: "Global",
    enDescription: "",
    zhDescription: "",
  },
  {
    key: "telegram",
    provider: null,
    logo: "/channel-logos/telegram.svg",
    enName: "Telegram",
    zhName: "Telegram",
    badge: null,
    enDescription: "",
    zhDescription: "",
  },
  {
    key: "discord",
    provider: null,
    logo: "/channel-logos/discord.svg",
    enName: "Discord",
    zhName: "Discord",
    badge: null,
    enDescription: "",
    zhDescription: "",
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
      !["connected", "expired", "cancelled", "error"].includes(pairing.status)
  )
}

function connectionStatusLabel(
  connection: MobileChannelConnection | undefined,
  copy: Copy
) {
  if (!connection?.configured) {
    return copy.notBound
  }
  if (!connection.enabled) {
    return copy.disconnected
  }
  if (connection.status === "disconnected") {
    return copy.disconnected
  }
  return copy[connection.status]
}

function pairingStatusLabel(pairing: MobileChannelPairing, copy: Copy) {
  switch (pairing.status) {
    case "preparing":
      return copy.preparing
    case "waiting_scan":
      return copy.waitingScan
    case "scanned":
      return copy.scanned
    case "verification_required":
      return copy.verificationRequired
    case "waiting_confirmation":
      return copy.waitingConfirmation
    case "awaiting_bind":
      return copy.awaitingBind
    case "connected":
      return copy.pairingConnected
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
}: {
  connection: MobileChannelConnection | undefined
  pairing: MobileChannelPairing | undefined
}) {
  const connected = connection?.enabled && connection.status === "connected"
  const pending =
    connection?.status === "connecting" || activePairing(pairing)

  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full bg-muted-foreground/40",
        connected && "bg-emerald-500",
        pending && "animate-pulse bg-amber-500",
        connection?.status === "error" && "bg-destructive"
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
  const [draftProjects, setDraftProjects] = React.useState<
    Partial<Record<MobileChannelProvider, string>>
  >({})
  const [loading, setLoading] = React.useState(true)
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
  const [removeTarget, setRemoveTarget] =
    React.useState<MobileChannelConnection | null>(null)
  const [removing, setRemoving] = React.useState(false)

  const loadOverview = React.useCallback(
    async () => {
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
        const runtimes =
          (await runtimesResponse.json()) as AgentRuntimesResponse
        const modelSettings =
          (await modelSettingsResponse.json()) as AgentModelSettingsResponse

        if (!channelsResponse.ok || !channels.ok || !channels.data) {
          throw new Error(copy.loadFailed)
        }

        setConnections(channels.data.connections)
        setPairings(channels.data.pairings)
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
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : copy.loadFailed)
      } finally {
        setLoading(false)
      }
    },
    [copy.loadFailed]
  )

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadOverview()
    })
  }, [loadOverview])

  React.useEffect(() => {
    if (!pairing) {
      return
    }

    if (
      ["connected", "expired", "cancelled", "error"].includes(pairing.status)
    ) {
      queueMicrotask(() => {
        void loadOverview()
      })
      return
    }

    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/mobile/channels/pairings/${pairing.id}`,
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
  }, [loadOverview, pairing])

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
    setPairing(activePairing(latest) ? (latest ?? null) : null)
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
      const response = await fetch(
        `/api/mobile/channels/pairings/start/${provider}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaultProjectId }),
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
        throw new Error(copy.actionFailed)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed)
    } finally {
      setBusyProvider(null)
    }
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
      if (!response.ok) {
        throw new Error(copy.actionFailed)
      }
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

  async function updateAgentRuntime(
    connection: MobileChannelConnection,
    value: string
  ) {
    const runtimeId = value === "__default" ? null : value
    const effectiveRuntimeId = runtimeId ?? DEFAULT_AGENT_RUNTIME_ID
    const body: Record<string, unknown> = { agentRuntimeId: runtimeId }
    if (
      connection.chatModel &&
      !agentModels.some(
        (model) =>
          model.id === connection.chatModel &&
          model.enabled &&
          model.supportedRuntimeIds.includes(effectiveRuntimeId)
      )
    ) {
      body.chatModel = null
    }
    await patchConnection(connection, body, copy.saved)
  }

  async function updateChatModel(
    connection: MobileChannelConnection,
    value: string
  ) {
    await patchConnection(
      connection,
      { chatModel: value === "__default" ? null : value },
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
    pairing && pairing.provider === selectedProvider ? pairing : null
  const effectiveRuntimeId =
    selectedConnection?.agentRuntimeId ?? DEFAULT_AGENT_RUNTIME_ID
  const modelOptions = agentModels.filter(
    (model) =>
      model.enabled && model.supportedRuntimeIds.includes(effectiveRuntimeId)
  )
  const selectedModelMissing = Boolean(
    selectedConnection?.chatModel &&
      !modelOptions.some(
        (model) => model.id === selectedConnection.chatModel
      )
  )

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
                            {locale === "zh"
                              ? channel.zhName
                              : channel.enName}
                            {channel.badge ? (
                              <Badge variant="outline">{channel.badge}</Badge>
                            ) : null}
                          </span>
                        </span>
                        <StatusDot
                          connection={connection}
                          pairing={latestPairing}
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
                                void startPairing(channel.provider)
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
                      <ChannelLogo channel={selectedChannel} className="size-12" />
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate font-heading text-xl font-semibold">
                          {selectedConnection?.displayName ||
                            copy.botFallbackName}
                        </h2>
                        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                          <RiTimeLine className="size-4" aria-hidden />
                          {connectionStatusLabel(selectedConnection, copy)}
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

                    {selectedConnection?.lastError ? (
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
                        description={copy.linkBotDescription}
                      >
                        <Button
                          variant="outline"
                          onClick={() =>
                            selectedProvider
                              ? void startPairing(selectedProvider)
                              : undefined
                          }
                          disabled={busyProvider === selectedProvider}
                        >
                          {busyProvider === selectedProvider ? (
                            <RiLoader4Line className="animate-spin" />
                          ) : (
                            <RiQrCodeLine />
                          )}
                          {copy.scanQr}
                        </Button>
                      </SettingRow>

                      {visiblePairing ? (
                        <div className="border-t p-5">
                          <PairingPanel
                            pairing={visiblePairing}
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
                                ? void startPairing(selectedProvider)
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
                              void updateAgentRuntime(
                                selectedConnection,
                                value
                              )
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
                                <SelectItem
                                  key={runtime.id}
                                  value={runtime.id}
                                >
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
                        <Select
                          value={selectedConnection?.chatModel ?? "__default"}
                          disabled={!selectedConnection}
                          onValueChange={(value) => {
                            if (selectedConnection) {
                              void updateChatModel(selectedConnection, value)
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

function PairingPanel({
  pairing,
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
    ].includes(pairing.status)

  return (
    <div className="rounded-xl bg-muted/40 p-5">
      {pairing.status === "preparing" ? (
        <div className="flex items-center gap-3 text-base text-muted-foreground">
          <RiLoader4Line className="size-5 animate-spin" aria-hidden />
          {copy.preparing}
        </div>
      ) : pairing.status === "connected" ? (
        <div className="flex items-center gap-3 text-base font-medium text-emerald-700 dark:text-emerald-400">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500/15">
            <RiCheckLine className="size-5" aria-hidden />
          </span>
          {copy.pairingConnected}
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
          <p className="flex items-center gap-2 text-base text-muted-foreground">
            <RiErrorWarningLine className="size-5 shrink-0" aria-hidden />
            {pairing.error ||
              pairing.message ||
              pairingStatusLabel(pairing, copy)}
          </p>
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
