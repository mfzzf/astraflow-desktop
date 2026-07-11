"use client"

import Image from "next/image"
import * as React from "react"
import {
  RiCheckLine,
  RiComputerLine,
  RiDeleteBinLine,
  RiDingdingLine,
  RiErrorWarningLine,
  RiLoader4Line,
  RiQrCodeLine,
  RiRefreshLine,
  RiSendPlane2Line,
  RiShieldCheckLine,
  RiSmartphoneLine,
  RiWechat2Line,
  RiWechatLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"
import { toast } from "sonner"

import { getSidebarAwarePageInsetClassName } from "@/components/app-page-inset"
import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useSidebar } from "@/components/ui/sidebar"
import type {
  MobileChannelConnection,
  MobileChannelPairing,
  MobileChannelProvider,
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

type Copy = ReturnType<typeof getCopy>

function getCopy(locale: "en" | "zh") {
  if (locale === "zh") {
    return {
      eyebrow: "移动控制中心",
      heading: "从聊天应用继续电脑上的 Agent 任务",
      intro:
        "扫码连接后，手机只负责发送任务、查看进度和批准操作；文件、终端与 Git 仍在这台电脑上执行。",
      connectedSummary: (connected: number, total: number) =>
        `${connected} 个在线 · ${total} 个已配置`,
      refresh: "刷新状态",
      refreshing: "正在刷新",
      defaultWorkspace: "默认工作区",
      noWorkspace: "暂不指定工作区",
      workspaceHint: "移动端发来的新会话会在这里开始。",
      notConfigured: "未接入",
      connected: "已连接",
      connecting: "连接中",
      disconnected: "已暂停",
      error: "需处理",
      lastEvent: "最近消息",
      noMessages: "尚未收到消息",
      account: "机器人标识",
      scan: "扫码接入",
      rescan: "重新扫码",
      continuePairing: "继续接入",
      pause: "暂停",
      reconnect: "重新连接",
      remove: "解除",
      removing: "正在解除",
      securityTitle: "本机执行，默认需要授权",
      securityDescription:
        "渠道凭据使用本机密钥加密保存。移动消息会进入现有 Agent Permission Gateway，高风险工具调用仍需在手机或桌面端明确批准。",
      loadFailed: "无法读取移动渠道状态。",
      actionFailed: "操作失败，请稍后重试。",
      saved: "默认工作区已更新。",
      paused: "移动渠道已暂停。",
      reconnected: "移动渠道已重新连接。",
      removed: "移动渠道已解除。",
      scanTitle: (provider: string) => `连接${provider}`,
      scanDescription: "二维码仅用于创建或授权机器人，不会开放远程桌面。",
      preparing: "正在生成安全二维码…",
      waitingScan: "等待扫码",
      scanned: "已扫码，等待手机确认",
      verificationRequired: "需要微信验证码",
      waitingConfirmation: "正在确认授权",
      awaitingBind: "还差一步：绑定这台电脑",
      pairingConnected: "接入完成",
      pairingExpired: "二维码已过期",
      pairingCancelled: "接入已取消",
      pairingError: "接入失败",
      scanWith: (provider: string) => `请使用${provider}扫描`,
      qrFallback: "也可以在手机浏览器打开二维码链接。",
      verificationLabel: "手机端验证码",
      verificationPlaceholder: "输入 4–10 位数字",
      submitVerification: "提交验证码",
      submitting: "正在提交",
      bindInstruction: "在手机中打开刚创建的机器人，并发送：",
      copyCommand: "复制绑定命令",
      copied: "绑定命令已复制。",
      retry: "重新生成",
      close: "完成",
      dismiss: "关闭",
      cancel: "取消",
      removeTitle: (provider: string) => `解除${provider}？`,
      removeDescription:
        "这会删除本机保存的机器人凭据和移动会话绑定。平台上的机器人应用不会被自动删除。",
      confirmRemove: "确认解除",
      connectionError: "连接异常",
    }
  }

  return {
    eyebrow: "Mobile control center",
    heading: "Continue desktop Agent tasks from your chat apps",
    intro:
      "After pairing, your phone sends tasks, follows progress, and approves actions. Files, terminal commands, and Git still run on this computer.",
    connectedSummary: (connected: number, total: number) =>
      `${connected} online · ${total} configured`,
    refresh: "Refresh status",
    refreshing: "Refreshing",
    defaultWorkspace: "Default workspace",
    noWorkspace: "No default workspace",
    workspaceHint: "New mobile sessions will start here.",
    notConfigured: "Not connected",
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Paused",
    error: "Needs attention",
    lastEvent: "Last message",
    noMessages: "No messages yet",
    account: "Bot identifier",
    scan: "Connect with QR",
    rescan: "Scan again",
    continuePairing: "Continue setup",
    pause: "Pause",
    reconnect: "Reconnect",
    remove: "Remove",
    removing: "Removing",
    securityTitle: "Runs locally with permission checks",
    securityDescription:
      "Channel credentials are encrypted with the local app key. Mobile messages pass through the existing Agent Permission Gateway, so high-risk tool calls still require explicit approval on mobile or desktop.",
    loadFailed: "Unable to load mobile channel status.",
    actionFailed: "The action failed. Please try again.",
    saved: "Default workspace updated.",
    paused: "Mobile channel paused.",
    reconnected: "Mobile channel reconnected.",
    removed: "Mobile channel removed.",
    scanTitle: (provider: string) => `Connect ${provider}`,
    scanDescription:
      "The QR code only creates or authorizes a bot. It does not expose a remote desktop.",
    preparing: "Generating a secure QR code…",
    waitingScan: "Waiting for scan",
    scanned: "Scanned — confirm on your phone",
    verificationRequired: "WeChat verification required",
    waitingConfirmation: "Confirming authorization",
    awaitingBind: "One more step: bind this computer",
    pairingConnected: "Connection complete",
    pairingExpired: "QR code expired",
    pairingCancelled: "Setup cancelled",
    pairingError: "Connection failed",
    scanWith: (provider: string) => `Scan with ${provider}`,
    qrFallback: "You can also open the QR destination on your phone.",
    verificationLabel: "Verification code",
    verificationPlaceholder: "Enter 4–10 digits",
    submitVerification: "Submit code",
    submitting: "Submitting",
    bindInstruction: "Open the bot you just created and send:",
    copyCommand: "Copy bind command",
    copied: "Bind command copied.",
    retry: "Generate again",
    close: "Done",
    dismiss: "Close",
    cancel: "Cancel",
    removeTitle: (provider: string) => `Remove ${provider}?`,
    removeDescription:
      "This deletes locally saved bot credentials and mobile session bindings. The bot application on the platform is not deleted automatically.",
    confirmRemove: "Remove connection",
    connectionError: "Connection error",
  }
}

const providerDetails: Record<
  MobileChannelProvider,
  {
    icon: RemixiconComponentType
    zhName: string
    enName: string
    zhDescription: string
    enDescription: string
  }
> = {
  wechat: {
    icon: RiWechatLine,
    zhName: "微信",
    enName: "WeChat",
    zhDescription: "通过微信 iLink Bot 长轮询接收任务，适合个人移动入口。",
    enDescription:
      "Receive tasks through a WeChat iLink Bot for a personal mobile entry point.",
  },
  wecom: {
    icon: RiWechat2Line,
    zhName: "企业微信",
    enName: "WeCom",
    zhDescription: "使用官方智能机器人长连接，支持单聊、群聊与主动回复。",
    enDescription:
      "Uses the official AI Bot connection for direct messages, groups, and replies.",
  },
  feishu: {
    icon: RiSendPlane2Line,
    zhName: "飞书",
    enName: "Feishu",
    zhDescription: "扫码创建飞书应用，通过 WebSocket 接收消息和审批命令。",
    enDescription:
      "Create a Feishu app by QR and receive messages over WebSocket.",
  },
  dingtalk: {
    icon: RiDingdingLine,
    zhName: "钉钉",
    enName: "DingTalk",
    zhDescription: "通过官方 Stream 模式连接机器人，无需公网回调地址。",
    enDescription:
      "Connects with the official Stream mode without a public callback URL.",
  },
}

function providerName(provider: MobileChannelProvider, locale: "en" | "zh") {
  const details = providerDetails[provider]
  return locale === "zh" ? details.zhName : details.enName
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

function connectionStatusLabel(
  connection: MobileChannelConnection | undefined,
  copy: Copy
) {
  if (!connection?.configured) {
    return copy.notConfigured
  }
  if (!connection.enabled) {
    return copy.disconnected
  }

  return copy[connection.status]
}

function formatTimestamp(value: string | null, locale: "en" | "zh") {
  if (!value) {
    return null
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function activePairing(pairing: MobileChannelPairing | undefined) {
  return Boolean(
    pairing &&
    !["connected", "expired", "cancelled", "error"].includes(pairing.status)
  )
}

function StatusBadge({
  connection,
  copy,
}: {
  connection: MobileChannelConnection | undefined
  copy: Copy
}) {
  const connected = connection?.enabled && connection.status === "connected"
  const attention = connection?.status === "error"

  return (
    <Badge
      variant={attention ? "destructive" : "outline"}
      className="bg-background/70"
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full bg-muted-foreground/50",
          connected && "bg-emerald-500",
          connection?.status === "connecting" && "animate-pulse bg-amber-500",
          attention && "bg-destructive"
        )}
      />
      {connectionStatusLabel(connection, copy)}
    </Badge>
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
  const [draftProjects, setDraftProjects] = React.useState<
    Partial<Record<MobileChannelProvider, string>>
  >({})
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [busyProvider, setBusyProvider] =
    React.useState<MobileChannelProvider | null>(null)
  const [activeProvider, setActiveProvider] =
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
    async (showSpinner = false) => {
      if (showSpinner) {
        setRefreshing(true)
      }

      try {
        const [channelsResponse, projectsResponse] = await Promise.all([
          fetch("/api/mobile/channels", { cache: "no-store" }),
          fetch("/api/studio/local-projects", { cache: "no-store" }),
        ])
        const channels =
          (await channelsResponse.json()) as ChannelOverviewResponse
        const localProjects =
          (await projectsResponse.json()) as LocalProjectsResponse

        if (!channelsResponse.ok || !channels.ok || !channels.data) {
          throw new Error(copy.loadFailed)
        }

        setConnections(channels.data.connections)
        setPairings(channels.data.pairings)
        if (projectsResponse.ok && localProjects.ok && localProjects.data) {
          setProjects(localProjects.data)
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : copy.loadFailed)
      } finally {
        setLoading(false)
        setRefreshing(false)
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
  const configuredCount = connections.filter(
    (connection) => connection.configured
  ).length
  const connectedCount = connections.filter(
    (connection) => connection.enabled && connection.status === "connected"
  ).length

  async function startPairing(provider: MobileChannelProvider) {
    setActiveProvider(provider)
    setPairing(null)
    setVerificationCode("")
    setBusyProvider(provider)
    let receivedPairing = false

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
        receivedPairing = true
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
      if (!receivedPairing) {
        setActiveProvider(null)
      }
    } finally {
      setBusyProvider(null)
    }
  }

  function resumePairing(item: MobileChannelPairing) {
    setActiveProvider(item.provider)
    setPairing(item)
    setVerificationCode("")
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

    try {
      const response = await fetch(
        `/api/mobile/channels/connections/${connection.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ defaultProjectId: projectId }),
        }
      )
      if (!response.ok) {
        throw new Error(copy.actionFailed)
      }
      toast.success(copy.saved)
      await loadOverview()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.actionFailed)
    }
  }

  async function toggleConnection(connection: MobileChannelConnection) {
    setBusyProvider(connection.provider)
    try {
      const url = connection.enabled
        ? `/api/mobile/channels/connections/${connection.id}`
        : `/api/mobile/channels/connections/${connection.id}/connect`
      const response = await fetch(url, {
        method: connection.enabled ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: connection.enabled
          ? JSON.stringify({ enabled: false })
          : undefined,
      })
      if (!response.ok) {
        throw new Error(copy.actionFailed)
      }
      toast.success(connection.enabled ? copy.paused : copy.reconnected)
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

  return (
    <main className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
      <section
        className={getSidebarAwarePageInsetClassName({
          className: "min-h-0 flex-1 overflow-y-auto",
          needsSidebarToggleOffset,
          variant: "standard",
        })}
      >
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div className="max-w-3xl">
              <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                <RiSmartphoneLine className="size-4" aria-hidden />
                {copy.eyebrow}
              </div>
              <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight sm:text-3xl">
                {copy.heading}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                {copy.intro}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {copy.connectedSummary(connectedCount, configuredCount)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadOverview(true)}
                disabled={refreshing}
                aria-label={copy.refresh}
              >
                <RiRefreshLine className={cn(refreshing && "animate-spin")} />
                {refreshing ? copy.refreshing : copy.refresh}
              </Button>
            </div>
          </div>

          <Alert>
            <RiShieldCheckLine aria-hidden />
            <AlertTitle>{copy.securityTitle}</AlertTitle>
            <AlertDescription>{copy.securityDescription}</AlertDescription>
          </Alert>

          {loading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {mobileChannelProviders.map((provider) => (
                <Skeleton key={provider} className="h-72 rounded-4xl" />
              ))}
            </div>
          ) : (
            <div className="grid items-stretch gap-4 lg:grid-cols-2">
              {mobileChannelProviders.map((provider) => {
                const details = providerDetails[provider]
                const Icon = details.icon
                const name = providerName(provider, locale)
                const connection = connectionByProvider.get(provider)
                const latestPairing = pairingByProvider.get(provider)
                const isBusy = busyProvider === provider
                const selectedProject =
                  connection?.defaultProjectId ||
                  draftProjects[provider] ||
                  "__none"
                const eventTime = formatTimestamp(
                  connection?.lastEventAt ?? null,
                  locale
                )

                return (
                  <Card key={provider} className="h-full" size="sm">
                    <CardHeader>
                      <div className="mb-2 flex size-10 items-center justify-center rounded-2xl bg-muted text-foreground ring-1 ring-foreground/5">
                        <Icon className="size-5" aria-hidden />
                      </div>
                      <CardTitle>{name}</CardTitle>
                      <CardDescription>
                        {locale === "zh"
                          ? details.zhDescription
                          : details.enDescription}
                      </CardDescription>
                      <CardAction>
                        <StatusBadge connection={connection} copy={copy} />
                      </CardAction>
                    </CardHeader>

                    <CardContent className="flex flex-1 flex-col gap-4">
                      <div>
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                          <RiComputerLine
                            className="size-3.5 text-muted-foreground"
                            aria-hidden
                          />
                          {copy.defaultWorkspace}
                        </div>
                        <Select
                          value={selectedProject}
                          onValueChange={(value) =>
                            void updateWorkspace(provider, value)
                          }
                        >
                          <SelectTrigger className="w-full" size="sm">
                            <SelectValue placeholder={copy.noWorkspace} />
                          </SelectTrigger>
                          <SelectContent position="popper" align="start">
                            <SelectGroup>
                              <SelectItem value="__none">
                                {copy.noWorkspace}
                              </SelectItem>
                              {projects.map((project) => (
                                <SelectItem key={project.id} value={project.id}>
                                  <span className="max-w-72 truncate">
                                    {project.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {copy.workspaceHint}
                        </p>
                      </div>

                      {connection?.configured ? (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl bg-muted/45 px-3 py-2.5 text-xs">
                          <div className="text-muted-foreground">
                            {copy.account}
                          </div>
                          <div className="truncate text-right font-mono">
                            {connection.accountId || "—"}
                          </div>
                          <div className="text-muted-foreground">
                            {copy.lastEvent}
                          </div>
                          <div className="text-right">
                            {eventTime || copy.noMessages}
                          </div>
                        </div>
                      ) : null}

                      {connection?.lastError ? (
                        <div className="flex gap-2 rounded-2xl bg-destructive/8 px-3 py-2.5 text-xs text-destructive">
                          <RiErrorWarningLine className="mt-0.5 size-3.5 shrink-0" />
                          <span className="line-clamp-3">
                            {copy.connectionError}: {connection.lastError}
                          </span>
                        </div>
                      ) : null}
                    </CardContent>

                    <CardFooter className="mt-auto gap-2 border-t">
                      {activePairing(latestPairing) ? (
                        <Button
                          size="sm"
                          onClick={() => resumePairing(latestPairing!)}
                        >
                          <RiQrCodeLine />
                          {copy.continuePairing}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => void startPairing(provider)}
                          disabled={isBusy}
                        >
                          {isBusy ? (
                            <RiLoader4Line className="animate-spin" />
                          ) : (
                            <RiQrCodeLine />
                          )}
                          {connection?.configured ? copy.rescan : copy.scan}
                        </Button>
                      )}

                      {connection?.configured ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void toggleConnection(connection)}
                            disabled={isBusy}
                          >
                            {connection.enabled ? copy.pause : copy.reconnect}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="ml-auto text-muted-foreground hover:text-destructive"
                            onClick={() => setRemoveTarget(connection)}
                            aria-label={copy.remove}
                          >
                            <RiDeleteBinLine />
                          </Button>
                        </>
                      ) : null}
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <Dialog
        open={activeProvider !== null}
        onOpenChange={(open) => {
          if (!open) {
            setActiveProvider(null)
            setPairing(null)
            setVerificationCode("")
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          {activeProvider ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {copy.scanTitle(providerName(activeProvider, locale))}
                </DialogTitle>
                <DialogDescription>{copy.scanDescription}</DialogDescription>
              </DialogHeader>

              <div className="flex flex-col items-center gap-4">
                {!pairing || pairing.status === "preparing" ? (
                  <div className="flex size-72 flex-col items-center justify-center gap-3 rounded-3xl border bg-muted/30">
                    <RiLoader4Line className="size-7 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      {copy.preparing}
                    </span>
                  </div>
                ) : pairing.status === "connected" ? (
                  <div className="flex size-56 flex-col items-center justify-center gap-3 rounded-full bg-emerald-500/10 text-center text-emerald-700 dark:text-emerald-400">
                    <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15">
                      <RiCheckLine className="size-8" />
                    </div>
                    <span className="font-heading font-medium">
                      {copy.pairingConnected}
                    </span>
                  </div>
                ) : pairing.qrCodeDataUrl &&
                  [
                    "waiting_scan",
                    "scanned",
                    "verification_required",
                    "waiting_confirmation",
                  ].includes(pairing.status) ? (
                  <div className="rounded-3xl border bg-white p-3 shadow-sm">
                    <Image
                      src={pairing.qrCodeDataUrl}
                      alt={copy.scanWith(providerName(activeProvider, locale))}
                      width={280}
                      height={280}
                      className="size-64 sm:size-72"
                      unoptimized
                      priority
                    />
                  </div>
                ) : pairing.status === "awaiting_bind" &&
                  pairing.bindCommand ? (
                  <div className="w-full rounded-3xl border bg-muted/35 p-5 text-center">
                    <p className="text-sm text-muted-foreground">
                      {copy.bindInstruction}
                    </p>
                    <div className="my-4 rounded-2xl bg-background px-4 py-3 font-mono text-lg font-semibold tracking-wide ring-1 ring-foreground/8">
                      {pairing.bindCommand}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => void copyBindCommand()}
                    >
                      {copy.copyCommand}
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-h-48 w-full flex-col items-center justify-center gap-3 rounded-3xl border bg-muted/30 px-6 text-center">
                    <RiErrorWarningLine className="size-7 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {pairing.error || pairing.message || copy.pairingError}
                    </p>
                  </div>
                )}

                {pairing ? (
                  <div className="w-full text-center">
                    <Badge
                      variant={
                        pairing.status === "error" ? "destructive" : "secondary"
                      }
                    >
                      {pairingStatusLabel(pairing, copy)}
                    </Badge>
                    {pairing.message ? (
                      <p className="mx-auto mt-2 max-w-sm text-sm leading-5 text-muted-foreground">
                        {pairing.message}
                      </p>
                    ) : null}
                    {pairing.qrPayload && pairing.status === "waiting_scan" ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {copy.qrFallback}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {pairing?.status === "verification_required" ? (
                  <div className="w-full">
                    <Separator className="mb-4" />
                    <label
                      htmlFor="mobile-channel-verification"
                      className="mb-1.5 block text-xs font-medium"
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
                          setVerificationCode(
                            event.target.value.replace(/\D/g, "").slice(0, 10)
                          )
                        }
                        placeholder={copy.verificationPlaceholder}
                      />
                      <Button
                        onClick={() => void submitVerification()}
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

              <DialogFooter>
                {pairing &&
                ["expired", "cancelled", "error"].includes(pairing.status) ? (
                  <Button
                    onClick={() => void startPairing(activeProvider)}
                    disabled={busyProvider === activeProvider}
                  >
                    {busyProvider === activeProvider ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiRefreshLine />
                    )}
                    {copy.retry}
                  </Button>
                ) : null}
                <Button
                  variant={
                    pairing?.status === "connected" ? "default" : "outline"
                  }
                  onClick={() => {
                    setActiveProvider(null)
                    setPairing(null)
                  }}
                >
                  {pairing?.status === "connected" ? copy.close : copy.dismiss}
                </Button>
              </DialogFooter>
            </>
          ) : null}
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
                ? copy.removeTitle(providerName(removeTarget.provider, locale))
                : copy.remove}
            </DialogTitle>
            <DialogDescription>{copy.removeDescription}</DialogDescription>
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
              {removing ? copy.removing : copy.confirmRemove}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}

export { MobileChannelsPage }
