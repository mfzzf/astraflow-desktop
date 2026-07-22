"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as React from "react"
import {
  RiApps2Line,
  RiCalendarScheduleLine,
  RiChat3Line,
  RiCheckLine,
  RiCodeBoxLine,
  RiCoupon3Line,
  RiDeleteBinLine,
  RiExternalLinkLine,
  RiFileListLine,
  RiImageLine,
  RiLoader4Line,
  RiLogoutBoxRLine,
  RiMicLine,
  RiMore2Line,
  RiPencilLine,
  RiPuzzleLine,
  RiQuestionLine,
  RiSettings3Line,
  RiSmartphoneLine,
  RiUser3Line,
  RiVideoLine,
} from "@remixicon/react"
import type { RemixiconComponentType } from "@remixicon/react"
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  Cloud,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderPlus,
  Gauge,
  MessageCirclePlus,
  Pin,
} from "lucide-react"
import { toast } from "sonner"

import { AppInfoButton } from "@/components/app-info-button"
import { useChannelConfig } from "@/components/channel-config-provider"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useI18n } from "@/components/i18n-provider"
import { requestStudioOnboardingTour } from "@/components/onboarding-tour"
import { StudioWorkspaceCreateDialog } from "@/components/studio-workspace-create-dialog"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { logout } from "@/components/logout-button"
import { SidebarToggleButton } from "@/components/sidebar-toggle-button"
import { Titlebar } from "@/components/titlebar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import {
  dispatchStudioLocalProjectsChanged,
  dispatchStudioSessionsChanged,
  dispatchStudioWorkspacesChanged,
  STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
  STUDIO_REMOTE_WORKSPACE_CREATE_REQUESTED_EVENT,
  STUDIO_SESSIONS_CHANGED_EVENT,
  STUDIO_WORKSPACES_CHANGED_EVENT,
} from "@/lib/studio-session-events"
import { getHoursUntilCompShareQuotaReset } from "@/lib/compshare/quota"
import { setPendingProjectId } from "@/lib/studio-pending-project"
import { setPendingWorkspaceId } from "@/lib/studio-pending-workspace"
import {
  studioModes,
  type StudioLocalProjectWithGitInfo,
  type StudioMode,
  type StudioSession,
  type StudioWorkspace,
} from "@/lib/studio-types"
import { cn } from "@/lib/utils"
import { useAppPreference } from "@/lib/app-preferences"
import {
  isChannelFeatureEnabled,
  type ChannelFeature,
} from "@/lib/channel-config-shared"
import {
  CHAT_ENVIRONMENT_STORAGE_KEY,
  CHAT_RUNTIME_STORAGE_KEY,
  DEFAULT_CHAT_RUNTIME_ID,
} from "./studio-chat/constants"

type SessionsResponse =
  | {
      ok: true
      data: StudioSession[]
    }
  | {
      ok: false
      error: unknown
    }

type LocalProjectsResponse =
  | {
      ok: true
      data: StudioLocalProjectWithGitInfo[]
    }
  | {
      ok: false
      error: unknown
    }

type WorkspacesResponse =
  | {
      ok: true
      data: StudioWorkspace[]
    }
  | {
      ok: false
      error?: unknown
      message?: string
    }

type SidebarQuotaWindow = {
  used: number
  limit: number
  resetAt: string | null
}

type SidebarQuotaSummary = {
  limit: number
  remaining: number
  windows: {
    fiveHour: SidebarQuotaWindow
    weekly: SidebarQuotaWindow
    monthly: SidebarQuotaWindow
  }
}

type SidebarAccountUser = {
  userName: string
  displayName: string
  companyName: string
  userEmail: string
  companyId: number | null
  level?: number | null
  quotas?: {
    personal: SidebarQuotaSummary | null
    team: SidebarQuotaSummary | null
  }
}

type SidebarProjectsResponse =
  | {
      ok: true
      data: {
        user: SidebarAccountUser | null
      }
    }
  | {
      ok: false
      message?: string
    }

type NavItem = {
  feature: ChannelFeature
  href: string
  label: string
  icon: RemixiconComponentType
  isActive: (pathname: string) => boolean
}

type StudioModeDefinition = {
  id: StudioMode
  icon: RemixiconComponentType
}

const studioModeDefinitions: StudioModeDefinition[] = [
  { id: "chat", icon: RiChat3Line },
  { id: "image", icon: RiImageLine },
  { id: "video", icon: RiVideoLine },
  { id: "audio", icon: RiMicLine },
]
class LoginRequiredError extends Error {
  constructor() {
    super("Login required.")
    this.name = "LoginRequiredError"
  }
}

function throwIfUnauthorized(response: Response) {
  if (response.status === 401) {
    throw new LoginRequiredError()
  }
}

function isLoginRequiredError(error: unknown) {
  return error instanceof LoginRequiredError
}

function isStudioMode(value: unknown): value is StudioMode {
  return typeof value === "string" && studioModes.includes(value as StudioMode)
}

function getStudioModeHref(mode: StudioMode) {
  return mode === "chat" ? "/studio" : `/studio?mode=${mode}`
}

function getStudioSessionHref(session: StudioSession) {
  return `/studio/${session.mode}/${encodeURIComponent(session.id)}`
}

function getStudioWorkspaceHref(workspaceId: string) {
  return `/studio?workspace=${encodeURIComponent(workspaceId)}`
}

function formatSessionRelativeTime(value: string) {
  const timestamp = new Date(value).getTime()

  if (!Number.isFinite(timestamp)) {
    return ""
  }

  const diffMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))

  if (diffMinutes < 1) return "now"
  if (diffMinutes < 60) return `${diffMinutes}m`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d`
  if (diffDays < 35) return `${Math.floor(diffDays / 7)}w`

  return `${Math.floor(diffDays / 30)}mo`
}

function formatProjectGitSummary(project: StudioLocalProjectWithGitInfo) {
  const changedFiles = project.git.changedFiles
  const additions = project.git.additions
  const deletions = project.git.deletions

  if (!changedFiles && !additions && !deletions) {
    return ""
  }

  const fileSummary =
    typeof changedFiles === "number" && changedFiles > 0
      ? `${changedFiles}`
      : ""
  const diffSummary =
    typeof additions === "number" && typeof deletions === "number"
      ? `+${additions} -${deletions}`
      : ""

  return [fileSummary, diffSummary].filter(Boolean).join(" · ")
}

function parseActiveStudioRoute(
  pathname: string,
  modeQuery: string | null
): {
  mode: StudioMode | null
  sessionId: string
} {
  const match = pathname.match(/^\/studio(?:\/([^/]+)(?:\/([^/]+))?)?/)
  const pathMode = match?.[1]
  const pathSessionId = match?.[2] ? decodeURIComponent(match[2]) : ""

  if (isStudioMode(pathMode)) {
    return {
      mode: pathMode,
      sessionId: pathSessionId,
    }
  }

  if (pathname === "/studio" && isStudioMode(modeQuery)) {
    return {
      mode: modeQuery,
      sessionId: "",
    }
  }

  if (pathname === "/studio") {
    return {
      mode: "chat",
      sessionId: "",
    }
  }

  return {
    mode: null,
    sessionId: "",
  }
}

async function fetchStudioSessions() {
  const response = await fetch("/api/studio/sessions", { cache: "no-store" })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SessionsResponse

  if (!response.ok || !payload.ok) {
    throw new Error("Failed to load sessions")
  }

  return payload.data
}

async function fetchLocalProjects() {
  const response = await fetch("/api/studio/local-projects", {
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as LocalProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error("Failed to load local projects")
  }

  return payload.data
}

async function fetchStudioWorkspaces() {
  const response = await fetch("/api/studio/workspaces", {
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as WorkspacesResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      payload.ok
        ? "Failed to load workspaces"
        : payload.message || "Failed to load workspaces"
    )
  }

  return payload.data
}

async function fetchSidebarAccount() {
  const response = await fetch("/api/studio/projects", { cache: "no-store" })

  if (response.status === 401 || response.status === 403) {
    return null
  }

  const payload = (await response.json()) as SidebarProjectsResponse

  if (!response.ok || !payload.ok) {
    throw new Error("Failed to load account")
  }

  return payload.data.user
}

function getInitials(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return "AF"
  }

  return normalized.slice(0, 2).toUpperCase()
}

function formatQuotaResetCountdown(
  value: string | null,
  locale: string,
  nowMs: number
) {
  const hours = getHoursUntilCompShareQuotaReset(value, nowMs)
  if (hours === null) return ""
  if (hours === 0) {
    return locale === "zh" ? "即将重置" : "Resetting soon"
  }
  return locale === "zh"
    ? `${hours} 小时后重置`
    : `Resets in ${hours} hour${hours === 1 ? "" : "s"}`
}

function SidebarQuotaWindowDetail({
  label,
  window,
  locale,
  nowMs,
}: {
  label: string
  window: SidebarQuotaWindow
  locale: string
  nowMs: number
}) {
  const formatter = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US")
  const resetAt = formatQuotaResetCountdown(window.resetAt, locale, nowMs)
  const percentage =
    window.limit > 0
      ? Math.min(100, Math.max(0, (window.used / window.limit) * 100))
      : 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="font-medium text-foreground">{label}</span>
        {resetAt ? (
          <span className="shrink-0 text-muted-foreground tabular-nums">
            {resetAt}
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground tabular-nums">
        <span>
          {locale === "zh" ? "已用" : "Used"} {formatter.format(window.used)} /{" "}
          {formatter.format(window.limit)} {locale === "zh" ? "次" : "calls"}
        </span>
        <span>{Math.round(percentage)}%</span>
      </div>
      <Progress
        value={percentage}
        aria-label={`${label} ${Math.round(percentage)}%`}
      />
    </div>
  )
}

function SidebarQuotaDetail({
  label,
  quota,
  locale,
  nowMs,
}: {
  label: string
  quota: SidebarQuotaSummary | null
  locale: string
  nowMs: number
}) {
  if (!quota) {
    return (
      <div className="flex items-center justify-between gap-3 px-2 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
          <span className="truncate text-xs text-foreground">{label}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {locale === "zh" ? "暂无有效套餐" : "No active plan"}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border/60 px-2 py-2 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
        <span className="truncate text-xs font-medium text-foreground">
          {label}
        </span>
      </div>
      <div className="flex flex-col gap-2 pl-3.5">
        <SidebarQuotaWindowDetail
          label={locale === "zh" ? "每 5 小时累计调用" : "Every 5 hours"}
          locale={locale}
          nowMs={nowMs}
          window={quota.windows.fiveHour}
        />
        <SidebarQuotaWindowDetail
          label={locale === "zh" ? "每周累计调用" : "Weekly"}
          locale={locale}
          nowMs={nowMs}
          window={quota.windows.weekly}
        />
        <SidebarQuotaWindowDetail
          label={locale === "zh" ? "每订阅月累计调用" : "Subscription month"}
          locale={locale}
          nowMs={nowMs}
          window={quota.windows.monthly}
        />
      </div>
    </div>
  )
}

function SidebarAccountMenu({
  user,
  loading,
  onOpenSettings,
}: {
  user: SidebarAccountUser | null
  loading: boolean
  onOpenSettings: (href: string) => void
}) {
  const { locale, t } = useI18n()
  const [usageOpen, setUsageOpen] = React.useState(true)
  const [quotaNowMs, setQuotaNowMs] = React.useState(() => Date.now())
  const [loggingOut, setLoggingOut] = React.useState(false)
  const displayName =
    user?.displayName || user?.userName || user?.userEmail || t.account
  const email = user?.userEmail || user?.userName || displayName
  const accountMeta = [
    user?.companyId !== null && user?.companyId !== undefined
      ? `ID ${user.companyId}`
      : "",
    user?.level !== null && user?.level !== undefined ? `Lv.${user.level}` : "",
  ]
    .filter(Boolean)
    .join(" · ")

  React.useEffect(() => {
    const intervalId = window.setInterval(
      () => setQuotaNowMs(Date.now()),
      60_000
    )
    return () => window.clearInterval(intervalId)
  }, [])

  async function handleLogout() {
    try {
      setLoggingOut(true)
      await logout()
    } catch (error) {
      console.warn("Logout request failed.", error)
    } finally {
      window.location.replace("/login")
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={displayName}
          className="flex w-full min-w-0 items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm transition-[background-color,color,width,height,padding] group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground"
        >
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {loading ? "..." : getInitials(displayName)}
            </AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <span className="block truncate font-medium">{displayName}</span>
            <span
              className="block truncate text-[11px] text-muted-foreground tabular-nums"
              title={accountMeta || email}
            >
              {accountMeta || email}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        className="w-72 max-w-[calc(100vw-1rem)]"
      >
        <DropdownMenuLabel className="flex flex-col gap-1 py-2">
          <div className="truncate font-medium">{displayName}</div>
          {accountMeta ? (
            <div className="truncate text-[11px] font-normal text-muted-foreground tabular-nums">
              {accountMeta}
            </div>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user?.quotas ? (
          <>
            <DropdownMenuGroup>
              <Collapsible open={usageOpen} onOpenChange={setUsageOpen}>
                <CollapsibleTrigger asChild>
                  <DropdownMenuItem
                    onSelect={(event) => event.preventDefault()}
                    className="font-medium"
                  >
                    <Gauge aria-hidden />
                    {locale === "zh" ? "套餐余量" : "Plan allowance"}
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "ml-auto transition-transform",
                        usageOpen && "rotate-180"
                      )}
                    />
                  </DropdownMenuItem>
                </CollapsibleTrigger>
                <CollapsibleContent className="mx-1 mb-1 rounded-md bg-popover py-1">
                  <SidebarQuotaDetail
                    label={locale === "zh" ? "个人套餐" : "Personal"}
                    locale={locale}
                    nowMs={quotaNowMs}
                    quota={user.quotas.personal}
                  />
                  <SidebarQuotaDetail
                    label={locale === "zh" ? "团队套餐" : "Team"}
                    locale={locale}
                    nowMs={quotaNowMs}
                    quota={user.quotas.team}
                  />
                </CollapsibleContent>
              </Collapsible>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={() => onOpenSettings("/settings/profile")}
          >
            <RiUser3Line aria-hidden />
            {t.profile}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenSettings("/settings")}>
            <RiSettings3Line aria-hidden />
            {t.settings}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={loggingOut}
          onSelect={(event) => {
            event.preventDefault()
            void handleLogout()
          }}
        >
          {loggingOut ? (
            <RiLoader4Line className="animate-spin" aria-hidden />
          ) : (
            <RiLogoutBoxRLine aria-hidden />
          )}
          {t.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

async function renameStudioSession(sessionId: string, title: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to rename session")
  }
}

async function updateStudioSessionPinnedRequest(
  sessionId: string,
  pinned: boolean
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to update session pin")
  }
}

async function updateStudioSessionArchivedRequest(
  sessionId: string,
  archived: boolean
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to update session archive state")
  }
}

async function deleteStudioSessionRequest(sessionId: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "DELETE",
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown
    } | null

    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Failed to delete session"
    )
  }
}

async function deleteStudioWorkspaceRequest(workspaceId: string) {
  const response = await fetch(
    `/api/studio/workspaces/${encodeURIComponent(workspaceId)}`,
    {
      method: "DELETE",
    }
  )
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to remove workspace")
  }
}

async function touchStudioWorkspaceRequest(workspaceId: string) {
  await fetch(`/api/studio/workspaces/${encodeURIComponent(workspaceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ opened: true }),
  })
}

async function clearProjectPermissionRulesRequest(projectId: string) {
  const response = await fetch("/api/studio/local-projects", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: projectId, action: "clearPermissionRules" }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to clear permission rules")
  }

  const payload = (await response.json()) as
    | {
        ok: true
        data: { deleted: number }
      }
    | {
        ok: false
        error: unknown
      }

  if (!payload.ok) {
    throw new Error("Failed to clear permission rules")
  }

  return payload.data.deleted
}

async function openLocalProjectRequest(projectId: string) {
  const response = await fetch("/api/studio/local-projects/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: projectId }),
  })
  throwIfUnauthorized(response)

  if (!response.ok) {
    throw new Error("Failed to open project")
  }
}

function AppSidebar({ embedded = false }: { embedded?: boolean }) {
  const { t } = useI18n()
  const [confirmDestructive] = useAppPreference("confirmDestructive")
  const channelConfig = useChannelConfig()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const activeStudio = parseActiveStudioRoute(
    pathname,
    searchParams.get("mode")
  )
  const [sessions, setSessions] = React.useState<StudioSession[]>([])
  const [localProjects, setLocalProjects] = React.useState<
    StudioLocalProjectWithGitInfo[]
  >([])
  const [workspaces, setWorkspaces] = React.useState<StudioWorkspace[]>([])
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [isLoadingSessions, setIsLoadingSessions] = React.useState(true)
  const [projectsLoadFailed, setProjectsLoadFailed] = React.useState(false)
  const [isLoadingProjects, setIsLoadingProjects] = React.useState(true)
  const [workspacesLoadFailed, setWorkspacesLoadFailed] = React.useState(false)
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = React.useState(true)
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = React.useState<
    Set<string>
  >(() => new Set())
  const [showArchived] = React.useState(false)
  const [renameTarget, setRenameTarget] = React.useState<StudioSession | null>(
    null
  )
  const [renameValue, setRenameValue] = React.useState("")
  const [renameSaving, setRenameSaving] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<StudioSession | null>(
    null
  )
  const [deleteSaving, setDeleteSaving] = React.useState(false)
  const [deleteWorkspaceTarget, setDeleteWorkspaceTarget] =
    React.useState<StudioWorkspace | null>(null)
  const [deleteWorkspaceSaving, setDeleteWorkspaceSaving] =
    React.useState(false)
  const [clearPermissionTarget, setClearPermissionTarget] =
    React.useState<StudioLocalProjectWithGitInfo | null>(null)
  const [clearPermissionSaving, setClearPermissionSaving] =
    React.useState(false)
  const [remoteWorkspaceDialogOpen, setRemoteWorkspaceDialogOpen] =
    React.useState(false)
  const [accountUser, setAccountUser] =
    React.useState<SidebarAccountUser | null>(null)
  const [isAccountLoading, setIsAccountLoading] = React.useState(true)
  const activeSession = sessions.find(
    (session) => session.id === activeStudio.sessionId
  )
  const activeWorkspaceId =
    activeSession?.workspaceId ??
    (activeStudio.sessionId ? null : searchParams.get("workspace"))
  const newSessionWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null

  const redirectToLogin = React.useCallback(() => {
    window.location.replace("/login")
  }, [])

  const reloadSessions = React.useCallback(async () => {
    try {
      setLoadFailed(false)
      setIsLoadingSessions(true)
      setSessions(await fetchStudioSessions())
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
        return
      }

      setLoadFailed(true)
    } finally {
      setIsLoadingSessions(false)
    }
  }, [redirectToLogin])

  const reloadLocalProjects = React.useCallback(async () => {
    try {
      setProjectsLoadFailed(false)
      setIsLoadingProjects(true)
      setLocalProjects(await fetchLocalProjects())
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
        return
      }

      setProjectsLoadFailed(true)
    } finally {
      setIsLoadingProjects(false)
    }
  }, [redirectToLogin])

  const reloadWorkspaces = React.useCallback(async () => {
    try {
      setWorkspacesLoadFailed(false)
      setIsLoadingWorkspaces(true)
      setWorkspaces(await fetchStudioWorkspaces())
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
        return
      }

      setWorkspacesLoadFailed(true)
    } finally {
      setIsLoadingWorkspaces(false)
    }
  }, [redirectToLogin])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadSessions()
    })
  }, [reloadSessions])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadLocalProjects()
    })
  }, [reloadLocalProjects])

  React.useEffect(() => {
    queueMicrotask(() => {
      void reloadWorkspaces()
    })
  }, [reloadWorkspaces])

  React.useEffect(() => {
    function handleRemoteWorkspaceCreateRequested() {
      setRemoteWorkspaceDialogOpen(true)
    }

    window.addEventListener(
      STUDIO_REMOTE_WORKSPACE_CREATE_REQUESTED_EVENT,
      handleRemoteWorkspaceCreateRequested
    )

    return () => {
      window.removeEventListener(
        STUDIO_REMOTE_WORKSPACE_CREATE_REQUESTED_EVENT,
        handleRemoteWorkspaceCreateRequested
      )
    }
  }, [])

  React.useEffect(() => {
    function handleSessionsChanged() {
      void reloadSessions()
    }

    window.addEventListener(
      STUDIO_SESSIONS_CHANGED_EVENT,
      handleSessionsChanged
    )

    return () => {
      window.removeEventListener(
        STUDIO_SESSIONS_CHANGED_EVENT,
        handleSessionsChanged
      )
    }
  }, [reloadSessions])

  React.useEffect(() => {
    function handleLocalProjectsChanged() {
      void reloadLocalProjects()
    }

    window.addEventListener(
      STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
      handleLocalProjectsChanged
    )

    return () => {
      window.removeEventListener(
        STUDIO_LOCAL_PROJECTS_CHANGED_EVENT,
        handleLocalProjectsChanged
      )
    }
  }, [reloadLocalProjects])

  React.useEffect(() => {
    function handleWorkspacesChanged() {
      void reloadWorkspaces()
    }

    window.addEventListener(
      STUDIO_WORKSPACES_CHANGED_EVENT,
      handleWorkspacesChanged
    )

    return () => {
      window.removeEventListener(
        STUDIO_WORKSPACES_CHANGED_EVENT,
        handleWorkspacesChanged
      )
    }
  }, [reloadWorkspaces])

  const loadAccount = React.useCallback(async () => {
    try {
      setIsAccountLoading(true)
      setAccountUser(await fetchSidebarAccount())
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        setAccountUser(null)
      }
    } finally {
      setIsAccountLoading(false)
    }
  }, [redirectToLogin])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadAccount()
    })
  }, [loadAccount])

  const openSettingsPage = React.useCallback(
    (href: string) => {
      router.push(href)
    },
    [router]
  )

  const allNavItems: NavItem[] = [
    {
      feature: "models",
      href: "/explore",
      label: t.explore,
      icon: RiApps2Line,
      isActive: (currentPathname) => currentPathname.startsWith("/explore"),
    },
    {
      feature: "skills",
      href: "/skills",
      label: t.skills,
      icon: RiPuzzleLine,
      isActive: (currentPathname) => currentPathname.startsWith("/skills"),
    },
    {
      feature: "plans",
      href: "/plans",
      label: t.plans,
      icon: RiCoupon3Line,
      isActive: (currentPathname) => currentPathname.startsWith("/plans"),
    },
    {
      feature: "automations",
      href: "/automations",
      label: t.automations,
      icon: RiCalendarScheduleLine,
      isActive: (currentPathname) => currentPathname.startsWith("/automations"),
    },
    {
      feature: "mobile",
      href: "/mobile",
      label: t.mobile,
      icon: RiSmartphoneLine,
      isActive: (currentPathname) => currentPathname.startsWith("/mobile"),
    },
    {
      feature: "codebox",
      href: "/codebox",
      label: t.codebox,
      icon: RiCodeBoxLine,
      isActive: (currentPathname) => currentPathname.startsWith("/codebox"),
    },
    {
      feature: "files",
      href: "/files",
      label: t.files,
      icon: RiFileListLine,
      isActive: (currentPathname) => currentPathname.startsWith("/files"),
    },
  ]
  const navItems = allNavItems.filter((item) =>
    isChannelFeatureEnabled(channelConfig, item.feature)
  )

  function getModeLabel(mode: StudioMode) {
    switch (mode) {
      case "chat":
        return t.studioModeChat
      case "image":
        return t.studioModeImage
      case "video":
        return t.studioModeVideo
      case "audio":
        return t.studioModeAudio
    }
  }

  async function handleRenameSubmit() {
    const target = renameTarget
    const nextTitle = renameValue.trim()

    if (!target || !nextTitle) {
      return
    }

    try {
      setRenameSaving(true)
      await renameStudioSession(target.id, nextTitle)
      setRenameTarget(null)
      setRenameValue("")
      await reloadSessions()
      dispatchStudioSessionsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      }
    } finally {
      setRenameSaving(false)
    }
  }

  async function deleteSession(target: StudioSession) {
    try {
      setDeleteSaving(true)
      await deleteStudioSessionRequest(target.id)
      toast.success(t.studioDeleteSuccess)

      if (activeStudio.sessionId === target.id) {
        router.replace(getStudioModeHref(target.mode))
      }

      setDeleteTarget(null)
      await reloadSessions()
      dispatchStudioSessionsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        toast.error(t.studioDeleteFailed, {
          description: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      setDeleteSaving(false)
    }
  }

  async function handleDeleteConfirm() {
    if (deleteTarget) await deleteSession(deleteTarget)
  }

  function requestDeleteSession(session: StudioSession) {
    if (confirmDestructive) {
      setDeleteTarget(session)
      return
    }

    void deleteSession(session)
  }

  async function handleToggleSessionPinned(session: StudioSession) {
    const pinned = !session.pinnedAt

    setSessions((current) =>
      current
        .map((candidate) =>
          candidate.id === session.id
            ? {
                ...candidate,
                pinnedAt: pinned ? new Date().toISOString() : null,
              }
            : candidate
        )
        .sort((a, b) => {
          if (a.pinnedAt && !b.pinnedAt) return -1
          if (!a.pinnedAt && b.pinnedAt) return 1
          return (
            new Date(b.pinnedAt ?? b.updatedAt).getTime() -
            new Date(a.pinnedAt ?? a.updatedAt).getTime()
          )
        })
    )

    try {
      await updateStudioSessionPinnedRequest(session.id, pinned)
      await reloadSessions()
      dispatchStudioSessionsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        await reloadSessions()
      }
    }
  }

  async function handleToggleSessionArchived(session: StudioSession) {
    const archived = !session.archivedAt

    setSessions((current) =>
      current.map((candidate) =>
        candidate.id === session.id
          ? {
              ...candidate,
              archivedAt: archived ? new Date().toISOString() : null,
            }
          : candidate
      )
    )

    try {
      await updateStudioSessionArchivedRequest(session.id, archived)
      await reloadSessions()
      dispatchStudioSessionsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        await reloadSessions()
      }
    }
  }

  function prepareNewSession(workspace: StudioWorkspace) {
    setPendingWorkspaceId(workspace.id)
    setPendingProjectId(
      workspace.type === "local" ? workspace.localProjectId : null
    )
    const environment = workspace.type === "sandbox" ? "remote" : "local"
    window.localStorage.setItem(CHAT_ENVIRONMENT_STORAGE_KEY, environment)

    if (workspace.type === "sandbox") {
      window.localStorage.setItem(
        CHAT_RUNTIME_STORAGE_KEY,
        DEFAULT_CHAT_RUNTIME_ID
      )
    }

    window.dispatchEvent(new Event("storage"))
    dispatchStudioSessionsChanged()
  }

  function selectWorkspace(workspace: StudioWorkspace) {
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current)
      next.add(workspace.id)
      return next
    })
    void touchStudioWorkspaceRequest(workspace.id)
    prepareNewSession(workspace)
    router.push(getStudioWorkspaceHref(workspace.id))
  }

  function handleNewSessionClick() {
    const workspace = newSessionWorkspace

    if (!workspace) {
      setPendingWorkspaceId(null)
      setPendingProjectId(null)
      dispatchStudioSessionsChanged()
      return
    }

    prepareNewSession(workspace)
  }

  const [isMac, setIsMac] = React.useState(false)
  const newTaskShortcutRef = React.useRef(() => {})

  React.useEffect(() => {
    const platform = document.documentElement.dataset.astraflowPlatform
    const nextIsMac = platform
      ? platform === "darwin"
      : /Mac|iP(hone|ad|od)/i.test(navigator.platform || navigator.userAgent)

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMac(nextIsMac)
  }, [])

  React.useEffect(() => {
    newTaskShortcutRef.current = () => {
      handleNewSessionClick()
      const workspaceId = newSessionWorkspace?.id

      router.push(workspaceId ? getStudioWorkspaceHref(workspaceId) : "/studio")
    }
  })

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "n"
      ) {
        event.preventDefault()
        newTaskShortcutRef.current()
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  function handleNewWorkspaceSession(workspace: StudioWorkspace) {
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current)
      next.add(workspace.id)
      return next
    })
    prepareNewSession(workspace)
    router.push(getStudioWorkspaceHref(workspace.id))
  }

  function getWorkspaceSessions(workspaceId: string) {
    return sessions.filter(
      (session) =>
        session.workspaceId === workspaceId &&
        isChannelFeatureEnabled(
          channelConfig,
          session.mode as ChannelFeature
        ) &&
        (showArchived || !session.archivedAt)
    )
  }

  function renderSessionContent(session: StudioSession) {
    return (
      <>
        {session.isRunning ? (
          <RiLoader4Line className="animate-spin text-primary" aria-hidden />
        ) : session.archivedAt ? (
          <Archive aria-hidden className="size-3.5 opacity-60" />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            session.archivedAt && "opacity-60"
          )}
        >
          {session.title}
        </span>
      </>
    )
  }

  function renderSessionTime(session: StudioSession) {
    // Sits right of the pinned indicator (right-8); hides whenever the row
    // actions show (hover, focus, or an expanded row menu).
    return (
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs font-normal text-sidebar-foreground/50 transition-opacity group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0 group-has-[[aria-expanded=true]]/menu-item:opacity-0">
        {formatSessionRelativeTime(session.updatedAt)}
      </span>
    )
  }

  function renderSessionActions(session: StudioSession) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            aria-label={t.studioSessionActions}
            className="top-1/2! right-0.5! -translate-y-1/2 rounded-lg"
            showOnHover
            onClick={(event) => event.stopPropagation()}
          >
            <RiMore2Line aria-hidden />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                setRenameValue(session.title)
                setRenameTarget(session)
              }}
            >
              <RiPencilLine aria-hidden />
              {t.studioRename}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void handleToggleSessionArchived(session)}
            >
              {session.archivedAt ? (
                <ArchiveRestore aria-hidden />
              ) : (
                <Archive aria-hidden />
              )}
              {session.archivedAt ? t.studioUnarchive : t.studioArchive}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => requestDeleteSession(session)}
            >
              <RiDeleteBinLine aria-hidden />
              {t.studioDelete}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function renderSessionContextMenuContent(session: StudioSession) {
    return (
      <ContextMenuContent className="w-44">
        <ContextMenuItem
          onSelect={() => {
            setRenameValue(session.title)
            setRenameTarget(session)
          }}
        >
          <RiPencilLine aria-hidden />
          {t.studioRename}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void handleToggleSessionPinned(session)}
        >
          <Pin aria-hidden className={cn(session.pinnedAt && "fill-current")} />
          {session.pinnedAt ? t.studioSessionUnpin : t.studioSessionPin}
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void handleToggleSessionArchived(session)}
        >
          {session.archivedAt ? (
            <ArchiveRestore aria-hidden />
          ) : (
            <Archive aria-hidden />
          )}
          {session.archivedAt ? t.studioUnarchive : t.studioArchive}
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onSelect={() => requestDeleteSession(session)}
        >
          <RiDeleteBinLine aria-hidden />
          {t.studioDelete}
        </ContextMenuItem>
      </ContextMenuContent>
    )
  }

  function handleCreateWorkspace() {
    setRemoteWorkspaceDialogOpen(true)
  }

  async function handleWorkspaceCreated(workspace: StudioWorkspace) {
    await Promise.all([reloadWorkspaces(), reloadLocalProjects()])
    dispatchStudioWorkspacesChanged()
    dispatchStudioLocalProjectsChanged()
    selectWorkspace(workspace)
  }

  async function deleteWorkspace(target: StudioWorkspace) {
    try {
      setDeleteWorkspaceSaving(true)
      await deleteStudioWorkspaceRequest(target.id)
      setDeleteWorkspaceTarget(null)
      toast.success(t.studioWorkspaceRemoved)
      await Promise.all([reloadWorkspaces(), reloadSessions()])
      dispatchStudioWorkspacesChanged()
      dispatchStudioSessionsChanged()

      if (activeWorkspaceId === target.id) {
        router.replace("/studio")
      }
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        toast.error(
          error instanceof Error ? error.message : t.studioWorkspaceRemoveFailed
        )
      }
    } finally {
      setDeleteWorkspaceSaving(false)
    }
  }

  async function handleDeleteWorkspaceConfirm() {
    if (deleteWorkspaceTarget) await deleteWorkspace(deleteWorkspaceTarget)
  }

  function requestDeleteWorkspace(workspace: StudioWorkspace) {
    if (confirmDestructive) {
      setDeleteWorkspaceTarget(workspace)
      return
    }

    void deleteWorkspace(workspace)
  }

  async function handleClearPermissionConfirm() {
    const target = clearPermissionTarget

    if (!target) {
      return
    }

    try {
      setClearPermissionSaving(true)
      const deleted = await clearProjectPermissionRulesRequest(target.id)

      setClearPermissionTarget(null)
      toast.success(t.studioPermissionClearSuccess(deleted))
      await reloadLocalProjects()
      dispatchStudioLocalProjectsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        toast.error(t.studioPermissionClearFailed)
      }
    } finally {
      setClearPermissionSaving(false)
    }
  }

  async function handleOpenProject(projectId: string) {
    try {
      await openLocalProjectRequest(projectId)
      await reloadLocalProjects()
      dispatchStudioLocalProjectsChanged()
    } catch (error) {
      if (isLoginRequiredError(error)) {
        redirectToLogin()
      } else {
        toast.error(t.studioLocalProjectOpenFailed)
      }
    }
  }

  const channelSessions = sessions.filter((session) =>
    isChannelFeatureEnabled(channelConfig, session.mode as ChannelFeature)
  )
  const visibleSessions = showArchived
    ? channelSessions
    : channelSessions.filter((session) => !session.archivedAt)
  const unboundSessions = visibleSessions.filter(
    (session) => session.workspaceId === null
  )
  const localProjectById = React.useMemo(
    () => new Map(localProjects.map((project) => [project.id, project])),
    [localProjects]
  )
  const sortedWorkspaces = (() => {
    const latestByWorkspace = new Map<string, number>()

    for (const session of visibleSessions) {
      if (!session.workspaceId) {
        continue
      }

      const timestamp = new Date(session.updatedAt).getTime()

      if (
        Number.isFinite(timestamp) &&
        timestamp > (latestByWorkspace.get(session.workspaceId) ?? 0)
      ) {
        latestByWorkspace.set(session.workspaceId, timestamp)
      }
    }

    return [...workspaces].sort((a, b) => {
      const aTimestamp = Math.max(
        latestByWorkspace.get(a.id) ?? 0,
        new Date(a.lastOpenedAt ?? a.updatedAt).getTime() || 0
      )
      const bTimestamp = Math.max(
        latestByWorkspace.get(b.id) ?? 0,
        new Date(b.lastOpenedAt ?? b.updatedAt).getTime() || 0
      )

      return bTimestamp - aTimestamp
    })
  })()

  function handleStartOnboarding() {
    requestStudioOnboardingTour()

    if (!pathname.startsWith("/studio")) {
      router.push("/studio")
    }
  }

  return (
    <>
      <Sidebar
        collapsible={embedded ? "none" : "offcanvas"}
        className="w-full! border-r border-token-border-light bg-token-side-bar-background text-token-foreground"
      >
        <SidebarHeader className="p-0">
          <Titlebar
            showSidebarToggle={!embedded}
            trailing={
              embedded ? (
                <div data-tour-id="studio-sidebar-toggle" className="shrink-0">
                  <SidebarToggleButton tooltipAlign="end" />
                </div>
              ) : undefined
            }
          >
            <div className="contents group-data-[collapsible=icon]:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t.studioOnboardingOpen}
                title={t.studioOnboardingOpen}
                className="h-8 shrink-0 rounded-(--radius-md) text-token-description-foreground hover:bg-token-list-hover-background hover:text-token-foreground"
                onClick={handleStartOnboarding}
              >
                <RiQuestionLine aria-hidden />
              </Button>
              <AppInfoButton className="h-8 shrink-0 rounded-xl" />
            </div>
          </Titlebar>
        </SidebarHeader>

        <SidebarContent className="gap-0.5 bg-token-side-bar-background text-token-foreground">
          <SidebarGroup className="py-0.5">
            <SidebarGroupContent>
              <SidebarMenu>
                {isChannelFeatureEnabled(channelConfig, "chat") ? (
                  <>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        className="h-8"
                        tooltip={t.studioNewTask}
                      >
                        <Link
                          href={
                            newSessionWorkspace
                              ? getStudioWorkspaceHref(newSessionWorkspace.id)
                              : "/studio"
                          }
                          data-tour-id="studio-new-session"
                          onClick={handleNewSessionClick}
                        >
                          <MessageCirclePlus aria-hidden />
                          <span className="min-w-0 flex-1 truncate">
                            {t.studioNewTask}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] font-normal text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
                            {isMac ? "⌘N" : "Ctrl+N"}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        type="button"
                        className="h-8"
                        tooltip={t.studioOpenWorkspace}
                        onClick={handleCreateWorkspace}
                      >
                        <FolderPlus aria-hidden />
                        <span>{t.studioOpenWorkspace}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </>
                ) : null}
                {navItems.map((item) => {
                  const Icon = item.icon
                  const isActive = item.isActive(pathname)

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        className="h-8"
                        tooltip={item.label}
                      >
                        <Link href={item.href}>
                          <Icon aria-hidden />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="py-0.5">
            <SidebarGroupLabel className="h-6">{t.studio}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {studioModeDefinitions
                  .filter((mode) =>
                    isChannelFeatureEnabled(channelConfig, mode.id)
                  )
                  .map((mode) => {
                    const Icon = mode.icon
                    const label = getModeLabel(mode.id)
                    const isActive =
                      activeStudio.mode === mode.id && !activeStudio.sessionId

                    return (
                      <SidebarMenuItem key={mode.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          className="h-8"
                          tooltip={label}
                        >
                          <Link href={getStudioModeHref(mode.id)}>
                            <Icon aria-hidden />
                            <span>{label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup
            data-tour-id="studio-workspaces"
            className="gap-0.5 py-0.5"
          >
            <SidebarGroupLabel className="h-6">
              {t.studioWorkspace}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              {sortedWorkspaces.length > 0 ? (
                <SidebarMenu>
                  {sortedWorkspaces.map((workspace) => {
                    const project =
                      workspace.type === "local"
                        ? localProjectById.get(workspace.localProjectId)
                        : undefined
                    const isExpanded =
                      expandedWorkspaceIds.has(workspace.id) ||
                      activeWorkspaceId === workspace.id
                    const workspaceSessions = getWorkspaceSessions(workspace.id)
                    const Icon =
                      workspace.type === "sandbox"
                        ? Cloud
                        : isExpanded
                          ? FolderOpen
                          : project?.git.branch
                            ? FolderGit2
                            : Folder
                    const gitSummary = project
                      ? formatProjectGitSummary(project)
                      : ""

                    return (
                      <SidebarMenuItem key={workspace.id}>
                        <SidebarMenuButton
                          type="button"
                          isActive={activeWorkspaceId === workspace.id}
                          className="pr-20"
                          tooltip={workspace.name}
                          title={
                            gitSummary
                              ? `${workspace.rootPath} · ${gitSummary}`
                              : workspace.rootPath
                          }
                          onClick={() => selectWorkspace(workspace)}
                        >
                          <Icon
                            aria-hidden
                            className={cn(
                              "text-sidebar-foreground/70",
                              workspace.type === "sandbox" &&
                                "text-sky-600 dark:text-sky-400"
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate text-[13px] text-sidebar-foreground/85">
                            {workspace.name}
                          </span>
                          {workspace.type === "sandbox" ? (
                            <span className="shrink-0 rounded border border-sky-500/25 bg-sky-500/8 px-1.5 py-0.5 text-[8px] leading-none font-semibold tracking-[0.08em] text-sky-700 uppercase transition-opacity group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0 dark:text-sky-300">
                              {t.studioWorkspaceSandboxBadge}
                            </span>
                          ) : null}
                        </SidebarMenuButton>

                        <SidebarMenuAction
                          type="button"
                          aria-label={t.studioNewProjectSession}
                          title={t.studioNewProjectSession}
                          className="top-1.5! right-7 rounded-lg"
                          showOnHover
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            handleNewWorkspaceSession(workspace)
                          }}
                        >
                          <MessageCirclePlus aria-hidden />
                        </SidebarMenuAction>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <SidebarMenuAction
                              aria-label={t.studioSessionActions}
                              className="top-1.5! right-1.5 rounded-lg"
                              showOnHover
                              onClick={(event) => event.stopPropagation()}
                            >
                              <RiMore2Line aria-hidden />
                            </SidebarMenuAction>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="start"
                            side="right"
                            className="w-64"
                          >
                            <DropdownMenuGroup>
                              {workspace.type === "local" && project ? (
                                <>
                                  <DropdownMenuItem
                                    onSelect={() =>
                                      void handleOpenProject(project.id)
                                    }
                                  >
                                    <RiExternalLinkLine aria-hidden />
                                    {t.studioLocalProjectOpen}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={project.permissionRuleCount === 0}
                                    onSelect={() =>
                                      setClearPermissionTarget(project)
                                    }
                                  >
                                    <RiCheckLine aria-hidden />
                                    {t.studioPermissionClearAllowedWithCount(
                                      project.permissionRuleCount
                                    )}
                                  </DropdownMenuItem>
                                </>
                              ) : (
                                <DropdownMenuItem
                                  onSelect={() => router.push("/codebox")}
                                >
                                  <RiCodeBoxLine aria-hidden />
                                  {t.codebox}
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() =>
                                  requestDeleteWorkspace(workspace)
                                }
                              >
                                <RiDeleteBinLine aria-hidden />
                                {t.studioDelete}
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        {isExpanded ? (
                          <SidebarMenuSub className="mx-3.5 mt-0.5 border-none px-1.5 py-0.5">
                            {workspaceSessions.length > 0 ? (
                              workspaceSessions.map((session) => (
                                <ContextMenu key={session.id}>
                                  <ContextMenuTrigger asChild>
                                    <SidebarMenuSubItem className="group/menu-item relative">
                                      <SidebarMenuSubButton
                                        asChild
                                        isActive={
                                          activeStudio.sessionId === session.id
                                        }
                                        className="pr-14"
                                      >
                                        <Link
                                          href={getStudioSessionHref(session)}
                                        >
                                          {renderSessionContent(session)}
                                        </Link>
                                      </SidebarMenuSubButton>
                                      {renderSessionTime(session)}
                                      {renderSessionActions(session)}
                                    </SidebarMenuSubItem>
                                  </ContextMenuTrigger>
                                  {renderSessionContextMenuContent(session)}
                                </ContextMenu>
                              ))
                            ) : (
                              <SidebarMenuSubItem>
                                <p className="px-2 py-1 text-xs text-muted-foreground">
                                  {t.studioLocalProjectNoSessions}
                                </p>
                              </SidebarMenuSubItem>
                            )}
                          </SidebarMenuSub>
                        ) : null}
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              ) : (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {workspacesLoadFailed || projectsLoadFailed
                    ? t.studioLocalProjectLoadFailed
                    : isLoadingWorkspaces || isLoadingProjects
                      ? t.studioThinking
                      : t.studioWorkspaceEmpty}
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup className="min-h-0 flex-1 py-0.5">
            <SidebarGroupLabel className="h-6">
              {t.studioSessions}
            </SidebarGroupLabel>
            <SidebarGroupContent className="min-h-0">
              {unboundSessions.length > 0 ? (
                <SidebarMenu>
                  {unboundSessions.map((session) => {
                    const isActive = activeStudio.sessionId === session.id

                    return (
                      <ContextMenu key={session.id}>
                        <ContextMenuTrigger asChild>
                          <SidebarMenuItem>
                            <SidebarMenuButton
                              asChild
                              isActive={isActive}
                              className="pr-14"
                              tooltip={session.title}
                            >
                              <Link href={getStudioSessionHref(session)}>
                                {renderSessionContent(session)}
                              </Link>
                            </SidebarMenuButton>

                            {renderSessionTime(session)}
                            {renderSessionActions(session)}
                          </SidebarMenuItem>
                        </ContextMenuTrigger>
                        {renderSessionContextMenuContent(session)}
                      </ContextMenu>
                    )
                  })}
                </SidebarMenu>
              ) : (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  {loadFailed
                    ? t.studioLoadFailed
                    : isLoadingSessions
                      ? t.studioThinking
                      : t.studioNoSessions}
                </p>
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="gap-1.5 p-2">
          <div className="flex min-w-0 items-center gap-1">
            <div className="min-w-0 flex-1">
              <SidebarAccountMenu
                user={accountUser}
                loading={isAccountLoading}
                onOpenSettings={openSettingsPage}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t.settings}
              title={t.settings}
              className="size-8 shrink-0 rounded-xl text-sidebar-foreground/75 group-data-[collapsible=icon]:hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              onClick={() => openSettingsPage("/settings")}
            >
              <RiSettings3Line aria-hidden />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <StudioWorkspaceCreateDialog
        open={remoteWorkspaceDialogOpen}
        onOpenChange={setRemoteWorkspaceDialogOpen}
        onCreated={handleWorkspaceCreated}
      />

      <Dialog
        open={deleteWorkspaceTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteWorkspaceTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioWorkspaceRemoveTitle}</DialogTitle>
            <DialogDescription>
              {deleteWorkspaceTarget?.type === "sandbox"
                ? t.studioWorkspaceRemoveSandboxConfirm
                : t.studioWorkspaceRemoveLocalConfirm}
            </DialogDescription>
          </DialogHeader>
          {deleteWorkspaceTarget ? (
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium text-foreground">
                {deleteWorkspaceTarget.name}
              </p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {deleteWorkspaceTarget.rootPath}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteWorkspaceTarget(null)}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteWorkspaceConfirm()}
              disabled={deleteWorkspaceSaving}
            >
              {deleteWorkspaceSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiDeleteBinLine aria-hidden />
              )}
              <span>{t.studioDelete}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={clearPermissionTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setClearPermissionTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioPermissionClearTitle}</DialogTitle>
            <DialogDescription>
              {clearPermissionTarget
                ? t.studioPermissionClearConfirm(
                    clearPermissionTarget.name,
                    clearPermissionTarget.permissionRuleCount
                  )
                : t.studioPermissionClearAllowed}
            </DialogDescription>
          </DialogHeader>
          {clearPermissionTarget ? (
            <div className="min-w-0 text-sm">
              <p className="truncate font-medium text-foreground">
                {clearPermissionTarget.name}
              </p>
              <p className="truncate text-muted-foreground">
                {clearPermissionTarget.path}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearPermissionTarget(null)}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleClearPermissionConfirm()}
              disabled={clearPermissionSaving}
            >
              {clearPermissionSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiDeleteBinLine aria-hidden />
              )}
              <span>{t.studioPermissionClearAllowed}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null)
            setRenameValue("")
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioRenameTitle}</DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={renameValue}
            placeholder={t.studioRenamePlaceholder}
            maxLength={120}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleRenameSubmit()
              }
            }}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRenameTarget(null)
                setRenameValue("")
              }}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              onClick={() => void handleRenameSubmit()}
              disabled={renameSaving || renameValue.trim().length === 0}
            >
              {renameSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiCheckLine aria-hidden />
              )}
              <span>{t.studioSave}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.studioDeleteTitle}</DialogTitle>
            <DialogDescription>{t.studioDeleteConfirm}</DialogDescription>
          </DialogHeader>
          {deleteTarget ? (
            <p className="truncate text-sm font-medium text-foreground">
              {deleteTarget.title}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              {t.studioCancel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDeleteConfirm()}
              disabled={deleteSaving}
            >
              {deleteSaving ? (
                <RiLoader4Line className="animate-spin" aria-hidden />
              ) : (
                <RiDeleteBinLine aria-hidden />
              )}
              <span>{t.studioDelete}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { AppSidebar }
