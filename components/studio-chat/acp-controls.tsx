"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import type {
  AuthMethod,
  Implementation,
  ListSessionsResponse,
  ProviderInfo,
  SessionConfigOption,
  SessionConfigSelectGroup,
  SessionConfigSelectOption,
  SessionInfo,
  SessionModeState,
} from "@agentclientprotocol/sdk"
import {
  ArrowRight,
  KeyRound,
  ListRestart,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { dispatchStudioSessionsChanged } from "@/lib/studio-session-events"
import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import {
  getAcpSessionInfoPresentation,
  getClaudeRateLimitPresentation,
  type AcpSessionInfoSnapshot,
} from "@/lib/agent/acp/session-presentation"
import { cn } from "@/lib/utils"

const ACP_RUNTIME_IDS = new Set([
  "astraflow",
  "codex",
  "claude-code",
  "opencode",
])

type AcpSessionControlSnapshot = {
  connected: true
  phase: "initialized" | "session"
  studioSessionId: string
  runtimeId: string
  sessionId: string | null
  workspace: string
  protocolVersion: number
  agentInfo: Implementation | null
  authMethods: AuthMethod[]
  authentication: {
    logout: boolean
  }
  session: {
    canClose: boolean
    canDelete: boolean
    canList: boolean
    canResume: boolean
    modes: SessionModeState | null
    configOptions: SessionConfigOption[]
    loadReplayUpdateCount: number
    availableCommands: SlashCommandDescriptor[]
    info: AcpSessionInfoSnapshot | null
    rateLimitInfo: Record<string, unknown> | null
  }
  providers: {
    configurable: boolean
  }
}

type AcpControlAction =
  | { action: "authenticate"; methodId: string }
  | { action: "close" }
  | {
      action: "continue_session"
      agentSessionId: string
      cwd: string
      title?: string | null
      updatedAt?: string | null
    }
  | { action: "delete_session"; sessionId: string }
  | { action: "disable_provider"; providerId: string }
  | { action: "list_providers" }
  | { action: "list_sessions"; cursor?: string; cwd?: string }
  | { action: "logout" }
  | { action: "prepare" }
  | {
      action: "set_config_option"
      configId: string
      value: string | boolean
    }
  | { action: "set_mode"; modeId: string }
  | {
      action: "set_provider"
      providerId: string
      apiType: string
      baseUrl: string
      headers?: Record<string, string>
    }

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error?: string }

type HeaderDraft = {
  id: number
  name: string
  value: string
}

type Copy = {
  title: string
  description: string
  overview: string
  sessions: string
  providers: string
  agentModes: string
  configuration: string
  authentication: string
  signIn: string
  logout: string
  noSessions: string
  noProviders: string
  listSessions: string
  listProviders: string
  nextPage: string
  cwdFilter: string
  current: string
  continueSession: string
  continueSessionReady: string
  continueSessionHint: string
  continueSessionWorkspaceMismatch: string
  closeSession: string
  deleteSession: string
  deleteCurrentSession: string
  deleteConfirm: string
  cancel: string
  provider: string
  apiType: string
  baseUrl: string
  headers: string
  headerName: string
  secretValue: string
  addHeader: string
  applyProvider: string
  disableProvider: string
  required: string
  disabled: string
  connected: string
  refresh: string
  updated: string
  operationFailed: string
  reconnectHint: string
  sessionTitle: string
  lastUpdated: string
  threadStatus: string
  goal: string
  tokenBudget: string
  archived: string
  closed: string
  rateLimit: string
  resetsAt: string
}

const EN_COPY: Copy = {
  title: "ACP controls",
  description: "Agent-provided session controls",
  overview: "Overview",
  sessions: "Sessions",
  providers: "Providers",
  agentModes: "Agent modes",
  configuration: "Session configuration",
  authentication: "Authentication",
  signIn: "Authenticate",
  logout: "Log out",
  noSessions: "No sessions returned by the agent.",
  noProviders: "No configurable providers returned by the agent.",
  listSessions: "List sessions",
  listProviders: "List providers",
  nextPage: "Next page",
  cwdFilter: "Working directory filter",
  current: "Current",
  continueSession: "Continue in a new chat",
  continueSessionReady: "Agent session ready",
  continueSessionHint:
    "Its previous transcript stays in the agent and will continue with your next message.",
  continueSessionWorkspaceMismatch:
    "Open this agent session from its original Studio workspace.",
  closeSession: "Close current session",
  deleteSession: "Delete",
  deleteCurrentSession: "Delete current session",
  deleteConfirm: "Delete this agent session? This cannot be undone.",
  cancel: "Cancel",
  provider: "Provider",
  apiType: "API protocol",
  baseUrl: "Base URL",
  headers: "Request headers (kept only until submit)",
  headerName: "Header name",
  secretValue: "Secret value",
  addHeader: "Add header",
  applyProvider: "Apply and reconnect",
  disableProvider: "Disable provider",
  required: "Required",
  disabled: "Disabled",
  connected: "Connected",
  refresh: "Refresh",
  updated: "Updated",
  operationFailed: "ACP operation failed",
  reconnectHint: "The provider change will apply on the next turn.",
  sessionTitle: "Session title",
  lastUpdated: "Last updated",
  threadStatus: "Thread status",
  goal: "Goal",
  tokenBudget: "Token budget",
  archived: "Archived",
  closed: "Closed",
  rateLimit: "Claude usage limit",
  resetsAt: "Resets",
}

const ZH_COPY: Copy = {
  title: "ACP 控制",
  description: "Agent 提供的会话控制",
  overview: "概览",
  sessions: "会话",
  providers: "提供方",
  agentModes: "Agent 模式",
  configuration: "会话配置",
  authentication: "认证",
  signIn: "认证",
  logout: "退出登录",
  noSessions: "Agent 未返回会话。",
  noProviders: "Agent 未返回可配置的提供方。",
  listSessions: "列出会话",
  listProviders: "列出提供方",
  nextPage: "下一页",
  cwdFilter: "按工作目录筛选",
  current: "当前",
  continueSession: "在新对话中继续",
  continueSessionReady: "Agent 会话已就绪",
  continueSessionHint:
    "历史对话保留在 Agent 中，将从你发送的下一条消息继续。",
  continueSessionWorkspaceMismatch:
    "请从该 Agent 会话原来的 Studio 工作区中打开。",
  closeSession: "关闭当前会话",
  deleteSession: "删除",
  deleteCurrentSession: "删除当前会话",
  deleteConfirm: "删除此 Agent 会话？此操作无法撤销。",
  cancel: "取消",
  provider: "提供方",
  apiType: "API 协议",
  baseUrl: "基础 URL",
  headers: "请求头（仅保留到提交）",
  headerName: "请求头名称",
  secretValue: "密钥值",
  addHeader: "添加请求头",
  applyProvider: "应用并重新连接",
  disableProvider: "停用提供方",
  required: "必需",
  disabled: "未启用",
  connected: "已连接",
  refresh: "刷新",
  updated: "已更新",
  operationFailed: "ACP 操作失败",
  reconnectHint: "提供方变更将在下一个对话轮次生效。",
  sessionTitle: "会话标题",
  lastUpdated: "最近更新",
  threadStatus: "线程状态",
  goal: "目标",
  tokenBudget: "Token 预算",
  archived: "已归档",
  closed: "已关闭",
  rateLimit: "Claude 使用限额",
  resetsAt: "重置时间",
}

let headerDraftId = 0

function createHeaderDraft(): HeaderDraft {
  headerDraftId += 1
  return { id: headerDraftId, name: "", value: "" }
}

function readApiError(payload: unknown, fallback: string) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error
  }

  return fallback
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(
      readApiError(payload, `Request failed (${response.status})`)
    )
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("ok" in payload) ||
    payload.ok !== true ||
    !("data" in payload)
  ) {
    throw new Error(readApiError(payload, "Invalid ACP response."))
  }

  return (payload as ApiEnvelope<T> & { ok: true }).data
}

function acpEndpoint(runtimeId: string, sessionId?: string) {
  const path = `/api/studio/agent-runtimes/${encodeURIComponent(runtimeId)}/acp`

  return sessionId ? `${path}?sessionId=${encodeURIComponent(sessionId)}` : path
}

function isSelectGroup(
  value: SessionConfigSelectOption | SessionConfigSelectGroup
): value is SessionConfigSelectGroup {
  return "group" in value
}

function isAgentManagedAuthMethod(method: AuthMethod) {
  const type = (method as AuthMethod & { type?: string }).type

  return type === undefined || type === "agent"
}

function formatSessionTimestamp(
  value: string | null | undefined,
  locale: string
) {
  if (!value) {
    return null
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date)
}

function sameWorkspace(left: string, right: string) {
  const normalize = (value: string) =>
    value.trim().replace(/[\\/]+$/, "") || value.trim()

  return normalize(left) === normalize(right)
}

function ConfigSelectItems({ option }: { option: SessionConfigOption }) {
  if (option.type !== "select") {
    return null
  }

  const ungrouped = option.options.filter(
    (candidate): candidate is SessionConfigSelectOption =>
      !isSelectGroup(candidate)
  )
  const groups = option.options.filter(isSelectGroup)

  return (
    <>
      {ungrouped.length > 0 ? (
        <SelectGroup>
          {ungrouped.map((candidate) => (
            <SelectItem key={candidate.value} value={candidate.value}>
              {candidate.name}
            </SelectItem>
          ))}
        </SelectGroup>
      ) : null}
      {groups.map((group) => (
        <SelectGroup key={group.group}>
          <SelectLabel>{group.name}</SelectLabel>
          {group.options.map((candidate) => (
            <SelectItem key={candidate.value} value={candidate.value}>
              {candidate.name}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  )
}

type AcpSessionControlsProps = {
  dense: boolean
  disabled: boolean
  locale: string
  runtimeId: string
  sessionId: string
  onEnsureSession: () => Promise<string>
}

export function AcpSessionControls(props: AcpSessionControlsProps) {
  if (!ACP_RUNTIME_IDS.has(props.runtimeId)) {
    return null
  }

  return (
    <AcpSessionControlsInner
      key={`${props.runtimeId}:${props.sessionId}`}
      {...props}
    />
  )
}

function AcpSessionControlsInner({
  dense,
  disabled,
  locale,
  runtimeId,
  sessionId,
  onEnsureSession,
}: AcpSessionControlsProps) {
  const router = useRouter()
  const copy = locale.startsWith("zh") ? ZH_COPY : EN_COPY
  const requestSequenceRef = React.useRef(0)
  const [open, setOpen] = React.useState(false)
  const [snapshot, setSnapshot] =
    React.useState<AcpSessionControlSnapshot | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)
  const [sessions, setSessions] = React.useState<SessionInfo[]>([])
  const [sessionsLoaded, setSessionsLoaded] = React.useState(false)
  const [sessionsCursor, setSessionsCursor] = React.useState<string | null>(
    null
  )
  const [sessionCwd, setSessionCwd] = React.useState("")
  const [listedSessionCwd, setListedSessionCwd] = React.useState("")
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = React.useState<
    string | null
  >(null)
  const [providers, setProviders] = React.useState<ProviderInfo[]>([])
  const [providersLoaded, setProvidersLoaded] = React.useState(false)
  const [selectedProviderId, setSelectedProviderId] = React.useState("")
  const [providerApiType, setProviderApiType] = React.useState("")
  const [providerBaseUrl, setProviderBaseUrl] = React.useState("")
  const [providerHeaders, setProviderHeaders] = React.useState<HeaderDraft[]>([
    createHeaderDraft(),
  ])

  const loadSnapshot = React.useCallback(
    async ({ quiet = false }: { quiet?: boolean } = {}) => {
      const requestSequence = requestSequenceRef.current + 1
      requestSequenceRef.current = requestSequence

      if (!quiet) {
        setRefreshing(true)
      }

      try {
        const response = await fetch(acpEndpoint(runtimeId, sessionId), {
          cache: "no-store",
        })
        const data = await readEnvelope<AcpSessionControlSnapshot | null>(
          response
        )

        if (requestSequence === requestSequenceRef.current) {
          setSnapshot(data)
          if (!data) {
            setOpen(false)
          }
        }

        return data
      } catch (error) {
        if (!quiet) {
          toast.error(copy.operationFailed, {
            description: error instanceof Error ? error.message : String(error),
          })
        }
        return null
      } finally {
        if (!quiet && requestSequence === requestSequenceRef.current) {
          setRefreshing(false)
        }
      }
    },
    [copy.operationFailed, runtimeId, sessionId]
  )

  const sendControl = React.useCallback(
    async <T,>(control: AcpControlAction, targetSessionId = sessionId) => {
      if (!targetSessionId) {
        throw new Error("A Studio session is required for ACP controls.")
      }
      const response = await fetch(acpEndpoint(runtimeId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: targetSessionId, control }),
      })

      return readEnvelope<T>(response)
    },
    [runtimeId, sessionId]
  )

  React.useEffect(() => {
    if (disabled) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void loadSnapshot({ quiet: true })
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [disabled, loadSnapshot])

  React.useEffect(() => {
    if (disabled || !open) {
      return
    }

    const intervalId = window.setInterval(() => {
      void loadSnapshot({ quiet: true })
    }, 1_500)

    return () => window.clearInterval(intervalId)
  }, [disabled, loadSnapshot, open])

  const selectedProvider = React.useMemo(
    () =>
      providers.find(
        (provider) => provider.providerId === selectedProviderId
      ) ?? null,
    [providers, selectedProviderId]
  )

  const selectProvider = React.useCallback(
    (providerId: string, availableProviders = providers) => {
      const provider = availableProviders.find(
        (candidate) => candidate.providerId === providerId
      )

      setSelectedProviderId(providerId)
      setProviderApiType(
        provider?.current?.apiType ?? provider?.supported.at(0) ?? "openai"
      )
      setProviderBaseUrl(provider?.current?.baseUrl ?? "")
      setProviderHeaders([createHeaderDraft()])
    },
    [providers]
  )

  const handleFailure = React.useCallback(
    (error: unknown) => {
      toast.error(copy.operationFailed, {
        description: error instanceof Error ? error.message : String(error),
      })
    },
    [copy.operationFailed]
  )

  const updateSessionControl = React.useCallback(
    async (action: AcpControlAction, label: string) => {
      setPendingAction(label)
      try {
        await sendControl(action)
        await loadSnapshot({ quiet: true })
        toast.success(copy.updated)
      } catch (error) {
        handleFailure(error)
      } finally {
        setPendingAction(null)
      }
    },
    [copy.updated, handleFailure, loadSnapshot, sendControl]
  )

  const listSessions = React.useCallback(
    async ({ append = false }: { append?: boolean } = {}) => {
      const cwd = append ? listedSessionCwd : sessionCwd.trim()
      const cursor = append ? sessionsCursor : null

      setPendingAction("list_sessions")
      try {
        const response = await sendControl<ListSessionsResponse>({
          action: "list_sessions",
          ...(cursor ? { cursor } : {}),
          ...(cwd ? { cwd } : {}),
        })
        setSessions((current) =>
          append ? [...current, ...response.sessions] : response.sessions
        )
        setSessionsCursor(response.nextCursor ?? null)
        setListedSessionCwd(cwd)
        setSessionsLoaded(true)
      } catch (error) {
        handleFailure(error)
      } finally {
        setPendingAction(null)
      }
    },
    [handleFailure, listedSessionCwd, sendControl, sessionCwd, sessionsCursor]
  )

  const listProviders = React.useCallback(async () => {
    setPendingAction("list_providers")
    try {
      const response = await sendControl<{ providers: ProviderInfo[] }>({
        action: "list_providers",
      })
      setProviders(response.providers)
      setProvidersLoaded(true)

      const preferredProvider =
        response.providers.find(
          (provider) => provider.providerId === selectedProviderId
        ) ?? response.providers.at(0)

      if (preferredProvider) {
        selectProvider(preferredProvider.providerId, response.providers)
      }
    } catch (error) {
      handleFailure(error)
    } finally {
      setPendingAction(null)
    }
  }, [handleFailure, selectProvider, selectedProviderId, sendControl])

  const deleteSession = React.useCallback(
    async (agentSessionId: string) => {
      setPendingAction(`delete:${agentSessionId}`)
      try {
        await sendControl({
          action: "delete_session",
          sessionId: agentSessionId,
        })
        setPendingDeleteSessionId(null)

        if (agentSessionId === snapshot?.sessionId) {
          setSnapshot(null)
          setOpen(false)
        } else {
          await listSessions()
        }
        toast.success(copy.updated)
      } catch (error) {
        handleFailure(error)
      } finally {
        setPendingAction(null)
      }
    },
    [copy.updated, handleFailure, listSessions, sendControl, snapshot]
  )

  const continueSession = React.useCallback(
    async (agentSession: SessionInfo) => {
      setPendingAction(`continue:${agentSession.sessionId}`)
      try {
        const result = await sendControl<{
          sessionPath: string
          reused: boolean
        }>({
          action: "continue_session",
          agentSessionId: agentSession.sessionId,
          cwd: agentSession.cwd,
          title: agentSession.title,
          updatedAt: agentSession.updatedAt,
        })

        dispatchStudioSessionsChanged()
        setOpen(false)
        toast.success(copy.continueSessionReady, {
          description: copy.continueSessionHint,
        })
        router.push(result.sessionPath)
      } catch (error) {
        handleFailure(error)
      } finally {
        setPendingAction(null)
      }
    },
    [
      copy.continueSessionHint,
      copy.continueSessionReady,
      handleFailure,
      router,
      sendControl,
    ]
  )

  const closeCurrentSession = React.useCallback(async () => {
    if (!window.confirm(copy.closeSession + "?")) {
      return
    }

    setPendingAction("close")
    try {
      await sendControl({ action: "close" })
      setSnapshot(null)
      setOpen(false)
      toast.success(copy.updated)
    } catch (error) {
      handleFailure(error)
    } finally {
      setPendingAction(null)
    }
  }, [copy.closeSession, copy.updated, handleFailure, sendControl])

  const logout = React.useCallback(async () => {
    if (!window.confirm(copy.logout + "?")) {
      return
    }

    setPendingAction("logout")
    try {
      await sendControl({ action: "logout" })
      setSnapshot(null)
      setOpen(false)
      toast.success(copy.updated)
    } catch (error) {
      handleFailure(error)
    } finally {
      setPendingAction(null)
    }
  }, [copy.logout, copy.updated, handleFailure, sendControl])

  const saveProvider = React.useCallback(async () => {
    if (
      !selectedProvider ||
      !providerApiType.trim() ||
      !providerBaseUrl.trim()
    ) {
      toast.error(copy.operationFailed, {
        description: `${copy.apiType} · ${copy.baseUrl}`,
      })
      return
    }

    const headers = Object.fromEntries(
      providerHeaders
        .map((header) => [header.name.trim(), header.value] as const)
        .filter(([name, value]) => name.length > 0 && value.length > 0)
    )

    setPendingAction("set_provider")
    try {
      await sendControl({
        action: "set_provider",
        providerId: selectedProvider.providerId,
        apiType: providerApiType.trim(),
        baseUrl: providerBaseUrl.trim(),
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      })
      setProviderHeaders([createHeaderDraft()])
      await Promise.all([loadSnapshot({ quiet: true }), listProviders()])
      toast.success(copy.updated, { description: copy.reconnectHint })
    } catch (error) {
      handleFailure(error)
    } finally {
      setPendingAction(null)
    }
  }, [
    copy.apiType,
    copy.baseUrl,
    copy.operationFailed,
    copy.reconnectHint,
    copy.updated,
    handleFailure,
    listProviders,
    loadSnapshot,
    providerApiType,
    providerBaseUrl,
    providerHeaders,
    selectedProvider,
    sendControl,
  ])

  const disableProvider = React.useCallback(async () => {
    if (!selectedProvider || selectedProvider.required) {
      return
    }

    setPendingAction("disable_provider")
    try {
      await sendControl({
        action: "disable_provider",
        providerId: selectedProvider.providerId,
      })
      setProviderHeaders([createHeaderDraft()])
      await Promise.all([loadSnapshot({ quiet: true }), listProviders()])
      toast.success(copy.updated, { description: copy.reconnectHint })
    } catch (error) {
      handleFailure(error)
    } finally {
      setPendingAction(null)
    }
  }, [
    copy.reconnectHint,
    copy.updated,
    handleFailure,
    listProviders,
    loadSnapshot,
    selectedProvider,
    sendControl,
  ])

  if (!snapshot) {
    const prepareConnection = async () => {
      setPendingAction("prepare")
      try {
        const targetSessionId = sessionId || (await onEnsureSession())
        const prepared = await sendControl<AcpSessionControlSnapshot>(
          {
            action: "prepare",
          },
          targetSessionId
        )

        setSnapshot(prepared)
        setOpen(true)
      } catch (error) {
        handleFailure(error)
      } finally {
        setPendingAction(null)
      }
    }

    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled || pendingAction === "prepare"}
        aria-label={copy.title}
        title={copy.title}
        className={cn("rounded-full", dense && "size-5")}
        onClick={() => void prepareConnection()}
      >
        {pendingAction === "prepare" ? (
          <LoaderCircle aria-hidden className="animate-spin" />
        ) : (
          <Settings2 aria-hidden />
        )}
      </Button>
    )
  }

  const hasSessionTab =
    snapshot.session.canList ||
    snapshot.session.canResume ||
    snapshot.session.canClose ||
    snapshot.session.canDelete
  const agentLabel =
    snapshot.agentInfo?.title || snapshot.agentInfo?.name || runtimeId
  const anyActionPending = pendingAction !== null
  const agentManagedAuthMethods = snapshot.authMethods.filter(
    isAgentManagedAuthMethod
  )
  const sessionInfo = getAcpSessionInfoPresentation(snapshot.session.info)
  const sessionUpdatedAt = formatSessionTimestamp(
    sessionInfo.updatedAt,
    locale
  )
  const rateLimit = getClaudeRateLimitPresentation(
    snapshot.session.rateLimitInfo
  )
  const rateLimitResetsAt =
    rateLimit?.resetsAt && !Number.isNaN(rateLimit.resetsAt.getTime())
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(rateLimit.resetsAt)
      : null

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          void loadSnapshot({ quiet: true })
        } else {
          setProviderHeaders([createHeaderDraft()])
          setPendingDeleteSessionId(null)
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled}
          aria-label={copy.title}
          title={copy.title}
          className={cn("rounded-full", dense && "size-5")}
        >
          <Settings2 aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-[min(26rem,calc(100vw-1rem))] gap-3 rounded-2xl p-3"
      >
        <PopoverHeader className="gap-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <PopoverTitle className="truncate text-sm">
                {agentLabel}
              </PopoverTitle>
              <PopoverDescription className="truncate text-xs">
                {snapshot.agentInfo?.version
                  ? `${snapshot.agentInfo.version} · `
                  : ""}
                ACP v{snapshot.protocolVersion} · {copy.connected}
              </PopoverDescription>
            </div>
            <Badge variant="outline">{runtimeId}</Badge>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={refreshing || anyActionPending}
              aria-label={copy.refresh}
              title={copy.refresh}
              onClick={() => void loadSnapshot()}
            >
              {refreshing ? (
                <LoaderCircle
                  data-icon="inline-start"
                  className="animate-spin"
                />
              ) : (
                <RefreshCw data-icon="inline-start" />
              )}
            </Button>
          </div>
        </PopoverHeader>

        <Tabs defaultValue="overview" className="min-h-0 gap-2">
          <TabsList className="h-8 w-full p-0.5">
            <TabsTrigger value="overview" className="px-2 text-xs">
              {copy.overview}
            </TabsTrigger>
            {hasSessionTab ? (
              <TabsTrigger
                value="sessions"
                className="px-2 text-xs"
                onClick={() => {
                  if (snapshot.session.canList && !sessionsLoaded) {
                    void listSessions()
                  }
                }}
              >
                {copy.sessions}
              </TabsTrigger>
            ) : null}
            {snapshot.providers.configurable ? (
              <TabsTrigger
                value="providers"
                className="px-2 text-xs"
                onClick={() => {
                  if (!providersLoaded) {
                    void listProviders()
                  }
                }}
              >
                {copy.providers}
              </TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent
            value="overview"
            className="max-h-[min(28rem,65vh)] overflow-y-auto pr-1"
          >
            <div className="flex flex-col gap-4">
              <div className="min-w-0 rounded-xl bg-muted/40 px-3 py-2 text-xs">
                <div className="truncate font-medium">{snapshot.sessionId}</div>
                <div className="mt-0.5 text-muted-foreground">
                  {copy.description}
                </div>
                {sessionInfo.title ? (
                  <div className="mt-2 min-w-0">
                    <div className="text-[11px] text-muted-foreground">
                      {copy.sessionTitle}
                    </div>
                    <div className="truncate font-medium">
                      {sessionInfo.title}
                    </div>
                  </div>
                ) : null}
                {sessionUpdatedAt ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {copy.lastUpdated}: {sessionUpdatedAt}
                  </div>
                ) : null}
                {sessionInfo.threadStatus ||
                sessionInfo.archived ||
                sessionInfo.closed ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sessionInfo.threadStatus ? (
                      <Badge variant="outline" className="text-[10px]">
                        {copy.threadStatus}: {sessionInfo.threadStatus}
                      </Badge>
                    ) : null}
                    {sessionInfo.archived ? (
                      <Badge variant="secondary" className="text-[10px]">
                        {copy.archived}
                      </Badge>
                    ) : null}
                    {sessionInfo.closed ? (
                      <Badge variant="destructive" className="text-[10px]">
                        {copy.closed}
                      </Badge>
                    ) : null}
                  </div>
                ) : null}
                {sessionInfo.goal ? (
                  <div className="mt-2 rounded-lg border bg-background/60 px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{copy.goal}</span>
                      {sessionInfo.goal.status ? (
                        <Badge variant="outline" className="text-[10px]">
                          {sessionInfo.goal.status}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-muted-foreground">
                      {sessionInfo.goal.objective}
                    </div>
                    {sessionInfo.goal.tokenBudget !== null ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {copy.tokenBudget}: {sessionInfo.goal.tokenBudget.toLocaleString(locale)}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {rateLimit ? (
                <section className="flex flex-col gap-2 rounded-xl border px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">{copy.rateLimit}</h3>
                    {rateLimit.status ? (
                      <Badge
                        variant={
                          rateLimit.status === "rejected"
                            ? "destructive"
                            : "outline"
                        }
                        className={cn(
                          "text-[10px]",
                          rateLimit.status === "allowed warning" &&
                            "border-amber-500/50 text-amber-700 dark:text-amber-300"
                        )}
                      >
                        {rateLimit.status}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                    {rateLimit.rateLimitType ? (
                      <span>{rateLimit.rateLimitType}</span>
                    ) : null}
                    {rateLimit.utilizationPercent !== null ? (
                      <span>{rateLimit.utilizationPercent}%</span>
                    ) : null}
                    {rateLimitResetsAt ? (
                      <span>
                        {copy.resetsAt}: {rateLimitResetsAt}
                      </span>
                    ) : null}
                    {rateLimit.overageStatus ? (
                      <span>Overage: {rateLimit.overageStatus}</span>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {snapshot.session.configOptions.length === 0 &&
              snapshot.session.modes ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium">{copy.agentModes}</h3>
                  <Select
                    value={snapshot.session.modes.currentModeId}
                    disabled={disabled || anyActionPending}
                    onValueChange={(modeId) =>
                      void updateSessionControl(
                        { action: "set_mode", modeId },
                        "set_mode"
                      )
                    }
                  >
                    <SelectTrigger size="xs" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        {snapshot.session.modes.availableModes.map((mode) => (
                          <SelectItem
                            key={mode.id}
                            value={mode.id}
                            title={mode.description ?? undefined}
                          >
                            {mode.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </section>
              ) : null}

              {snapshot.session.configOptions.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium">{copy.configuration}</h3>
                  <FieldGroup className="gap-3">
                    {snapshot.session.configOptions.map((option) =>
                      option.type === "select" ? (
                        <Field key={option.id} className="gap-1.5">
                          <FieldLabel
                            htmlFor={`acp-config-${option.id}`}
                            className="text-xs"
                          >
                            {option.name}
                          </FieldLabel>
                          <Select
                            value={option.currentValue}
                            disabled={disabled || anyActionPending}
                            onValueChange={(value) =>
                              void updateSessionControl(
                                {
                                  action: "set_config_option",
                                  configId: option.id,
                                  value,
                                },
                                `config:${option.id}`
                              )
                            }
                          >
                            <SelectTrigger
                              id={`acp-config-${option.id}`}
                              size="xs"
                              className="w-full"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent position="popper">
                              <ConfigSelectItems option={option} />
                            </SelectContent>
                          </Select>
                          {option.description ? (
                            <FieldDescription className="text-xs">
                              {option.description}
                            </FieldDescription>
                          ) : null}
                        </Field>
                      ) : (
                        <Field
                          key={option.id}
                          orientation="horizontal"
                          className="items-center gap-2"
                        >
                          <FieldContent className="gap-0.5">
                            <FieldLabel
                              htmlFor={`acp-config-${option.id}`}
                              className="text-xs"
                            >
                              {option.name}
                            </FieldLabel>
                            {option.description ? (
                              <FieldDescription className="text-xs">
                                {option.description}
                              </FieldDescription>
                            ) : null}
                          </FieldContent>
                          <Switch
                            id={`acp-config-${option.id}`}
                            size="sm"
                            checked={option.currentValue}
                            disabled={disabled || anyActionPending}
                            onCheckedChange={(value) =>
                              void updateSessionControl(
                                {
                                  action: "set_config_option",
                                  configId: option.id,
                                  value,
                                },
                                `config:${option.id}`
                              )
                            }
                          />
                        </Field>
                      )
                    )}
                  </FieldGroup>
                </section>
              ) : null}

              {agentManagedAuthMethods.length > 0 ||
              snapshot.authentication.logout ? (
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium">{copy.authentication}</h3>
                  <div className="flex flex-col gap-1.5">
                    {agentManagedAuthMethods.map((method) => (
                      <div
                        key={method.id}
                        className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/40 px-2.5 py-2"
                      >
                        <KeyRound aria-hidden className="size-3.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium">
                            {method.name}
                          </div>
                          {method.description ? (
                            <div className="truncate text-xs text-muted-foreground">
                              {method.description}
                            </div>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={disabled || anyActionPending}
                          onClick={() =>
                            void updateSessionControl(
                              {
                                action: "authenticate",
                                methodId: method.id,
                              },
                              `auth:${method.id}`
                            )
                          }
                        >
                          {copy.signIn}
                        </Button>
                      </div>
                    ))}
                    {snapshot.authentication.logout ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={disabled || anyActionPending}
                        onClick={() => void logout()}
                      >
                        <LogOut data-icon="inline-start" />
                        {copy.logout}
                      </Button>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          </TabsContent>

          {hasSessionTab ? (
            <TabsContent
              value="sessions"
              className="max-h-[min(28rem,65vh)] overflow-y-auto pr-1"
            >
              <div className="flex flex-col gap-3">
                {snapshot.session.canList ? (
                  <FieldGroup className="gap-2">
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="acp-session-cwd" className="text-xs">
                        {copy.cwdFilter}
                      </FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          id="acp-session-cwd"
                          value={sessionCwd}
                          placeholder="/workspace"
                          className="h-7 rounded-xl text-xs"
                          onChange={(event) =>
                            setSessionCwd(event.target.value)
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={disabled || anyActionPending}
                          onClick={() => void listSessions()}
                        >
                          {pendingAction === "list_sessions" ? (
                            <LoaderCircle
                              data-icon="inline-start"
                              className="animate-spin"
                            />
                          ) : (
                            <ListRestart data-icon="inline-start" />
                          )}
                          {copy.listSessions}
                        </Button>
                      </div>
                    </Field>
                  </FieldGroup>
                ) : null}

                {sessionsLoaded && sessions.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    {copy.noSessions}
                  </p>
                ) : null}

                {sessions.length > 0 ? (
                  <div className="flex flex-col gap-1.5">
                    {sessions.map((agentSession) => {
                      const isCurrent =
                        agentSession.sessionId === snapshot.sessionId
                      const updatedAt = formatSessionTimestamp(
                        agentSession.updatedAt,
                        locale
                      )
                      const confirming =
                        pendingDeleteSessionId === agentSession.sessionId
                      const workspaceMatches = sameWorkspace(
                        agentSession.cwd,
                        snapshot.workspace
                      )

                      return (
                        <div
                          key={agentSession.sessionId}
                          className="flex min-w-0 items-center gap-2 rounded-xl bg-muted/40 px-2.5 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-medium">
                                {agentSession.title || agentSession.sessionId}
                              </span>
                              {isCurrent ? (
                                <Badge variant="secondary">
                                  {copy.current}
                                </Badge>
                              ) : null}
                            </div>
                            <div
                              className="truncate text-xs text-muted-foreground"
                              title={agentSession.cwd}
                            >
                              {agentSession.cwd}
                              {updatedAt ? ` · ${updatedAt}` : ""}
                            </div>
                          </div>
                          {snapshot.session.canResume && !isCurrent ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              disabled={
                                disabled ||
                                anyActionPending ||
                                !workspaceMatches
                              }
                              aria-label={copy.continueSession}
                              title={
                                workspaceMatches
                                  ? copy.continueSession
                                  : copy.continueSessionWorkspaceMismatch
                              }
                              onClick={() =>
                                void continueSession(agentSession)
                              }
                            >
                              {pendingAction ===
                              `continue:${agentSession.sessionId}` ? (
                                <LoaderCircle
                                  aria-hidden
                                  className="animate-spin"
                                />
                              ) : (
                                <ArrowRight aria-hidden />
                              )}
                            </Button>
                          ) : null}
                          {snapshot.session.canDelete ? (
                            confirming ? (
                              <div className="flex shrink-0 gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label={copy.cancel}
                                  title={copy.cancel}
                                  onClick={() =>
                                    setPendingDeleteSessionId(null)
                                  }
                                >
                                  <X aria-hidden />
                                </Button>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="icon-xs"
                                  disabled={anyActionPending}
                                  aria-label={copy.deleteConfirm}
                                  title={copy.deleteConfirm}
                                  onClick={() =>
                                    void deleteSession(agentSession.sessionId)
                                  }
                                >
                                  {pendingAction ===
                                  `delete:${agentSession.sessionId}` ? (
                                    <LoaderCircle
                                      aria-hidden
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <Trash2 aria-hidden />
                                  )}
                                </Button>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                disabled={disabled || anyActionPending}
                                aria-label={copy.deleteSession}
                                title={copy.deleteSession}
                                onClick={() =>
                                  setPendingDeleteSessionId(
                                    agentSession.sessionId
                                  )
                                }
                              >
                                <Trash2 aria-hidden />
                              </Button>
                            )
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {sessionsCursor ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={disabled || anyActionPending}
                    onClick={() => void listSessions({ append: true })}
                  >
                    {copy.nextPage}
                  </Button>
                ) : null}

                {snapshot.session.canClose || snapshot.session.canDelete ? (
                  <>
                    <Separator />
                    <div className="flex flex-wrap justify-end gap-2">
                      {snapshot.session.canClose ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={disabled || anyActionPending}
                          onClick={() => void closeCurrentSession()}
                        >
                          {copy.closeSession}
                        </Button>
                      ) : null}
                      {snapshot.session.canDelete && snapshot.sessionId ? (
                        <Button
                          type="button"
                          variant="destructive"
                          size="xs"
                          disabled={disabled || anyActionPending}
                          onClick={() => {
                            if (window.confirm(copy.deleteConfirm)) {
                              void deleteSession(snapshot.sessionId!)
                            }
                          }}
                        >
                          {copy.deleteCurrentSession}
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </TabsContent>
          ) : null}

          {snapshot.providers.configurable ? (
            <TabsContent
              value="providers"
              className="max-h-[min(28rem,65vh)] overflow-y-auto pr-1"
            >
              {pendingAction === "list_providers" && !providersLoaded ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <LoaderCircle aria-hidden className="size-4 animate-spin" />
                </div>
              ) : providersLoaded && providers.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-4">
                  <p className="text-center text-xs text-muted-foreground">
                    {copy.noProviders}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={disabled || anyActionPending}
                    onClick={() => void listProviders()}
                  >
                    <RefreshCw data-icon="inline-start" />
                    {copy.listProviders}
                  </Button>
                </div>
              ) : selectedProvider ? (
                <FieldGroup className="gap-3">
                  <Field className="gap-1.5">
                    <FieldLabel htmlFor="acp-provider" className="text-xs">
                      {copy.provider}
                    </FieldLabel>
                    <Select
                      value={selectedProvider.providerId}
                      disabled={disabled || anyActionPending}
                      onValueChange={selectProvider}
                    >
                      <SelectTrigger
                        id="acp-provider"
                        size="xs"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectGroup>
                          {providers.map((provider) => (
                            <SelectItem
                              key={provider.providerId}
                              value={provider.providerId}
                            >
                              {provider.providerId}
                              {provider.required ? ` · ${copy.required}` : ""}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field className="gap-1.5">
                    <FieldLabel htmlFor="acp-provider-api" className="text-xs">
                      {copy.apiType}
                    </FieldLabel>
                    <Select
                      value={providerApiType}
                      disabled={disabled || anyActionPending}
                      onValueChange={setProviderApiType}
                    >
                      <SelectTrigger
                        id="acp-provider-api"
                        size="xs"
                        className="w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectGroup>
                          {selectedProvider.supported.map((protocol) => (
                            <SelectItem key={protocol} value={protocol}>
                              {protocol}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field className="gap-1.5">
                    <FieldLabel htmlFor="acp-provider-url" className="text-xs">
                      {copy.baseUrl}
                    </FieldLabel>
                    <Input
                      id="acp-provider-url"
                      type="url"
                      value={providerBaseUrl}
                      placeholder="https://api.example.com/v1"
                      className="h-7 rounded-xl text-xs"
                      disabled={disabled || anyActionPending}
                      onChange={(event) =>
                        setProviderBaseUrl(event.target.value)
                      }
                    />
                  </Field>

                  <Field className="gap-1.5">
                    <FieldLabel className="text-xs">{copy.headers}</FieldLabel>
                    <div className="flex flex-col gap-2">
                      {providerHeaders.map((header) => (
                        <div key={header.id} className="flex gap-1.5">
                          <Input
                            value={header.name}
                            aria-label={copy.headerName}
                            placeholder={copy.headerName}
                            autoComplete="off"
                            className="h-7 rounded-xl text-xs"
                            disabled={disabled || anyActionPending}
                            onChange={(event) =>
                              setProviderHeaders((current) =>
                                current.map((candidate) =>
                                  candidate.id === header.id
                                    ? {
                                        ...candidate,
                                        name: event.target.value,
                                      }
                                    : candidate
                                )
                              )
                            }
                          />
                          <Input
                            type="password"
                            value={header.value}
                            aria-label={copy.secretValue}
                            placeholder={copy.secretValue}
                            autoComplete="new-password"
                            className="h-7 rounded-xl text-xs"
                            disabled={disabled || anyActionPending}
                            onChange={(event) =>
                              setProviderHeaders((current) =>
                                current.map((candidate) =>
                                  candidate.id === header.id
                                    ? {
                                        ...candidate,
                                        value: event.target.value,
                                      }
                                    : candidate
                                )
                              )
                            }
                          />
                          {providerHeaders.length > 1 ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              disabled={disabled || anyActionPending}
                              aria-label={copy.cancel}
                              title={copy.cancel}
                              onClick={() =>
                                setProviderHeaders((current) =>
                                  current.filter(
                                    (candidate) => candidate.id !== header.id
                                  )
                                )
                              }
                            >
                              <X aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="self-start"
                        disabled={disabled || anyActionPending}
                        onClick={() =>
                          setProviderHeaders((current) => [
                            ...current,
                            createHeaderDraft(),
                          ])
                        }
                      >
                        <Plus data-icon="inline-start" />
                        {copy.addHeader}
                      </Button>
                    </div>
                  </Field>

                  <div className="flex flex-wrap justify-end gap-2">
                    {!selectedProvider.required ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={
                          disabled ||
                          anyActionPending ||
                          !selectedProvider.current
                        }
                        onClick={() => void disableProvider()}
                      >
                        {selectedProvider.current
                          ? copy.disableProvider
                          : copy.disabled}
                      </Button>
                    ) : (
                      <Badge variant="secondary">{copy.required}</Badge>
                    )}
                    <Button
                      type="button"
                      size="xs"
                      disabled={disabled || anyActionPending}
                      onClick={() => void saveProvider()}
                    >
                      {copy.applyProvider}
                    </Button>
                  </div>
                </FieldGroup>
              ) : (
                <div className="flex justify-center py-4">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={disabled || anyActionPending}
                    onClick={() => void listProviders()}
                  >
                    <RefreshCw data-icon="inline-start" />
                    {copy.listProviders}
                  </Button>
                </div>
              )}
            </TabsContent>
          ) : null}
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}
