"use client"

import * as React from "react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { SettingsProfilePage } from "@/components/settings-profile-page"
import {
  SettingsEmptyRow,
  SettingsPage,
  SettingsPageHeader,
  SettingsRow,
  SettingsSection,
  SettingsSegmented,
} from "@/components/settings-ui"
import { useTheme } from "@/components/theme-provider"
import { SynaraButton } from "@/components/ui/synara-button"
import { Switch } from "@/components/ui/switch"
import { useAppPreference } from "@/lib/app-preferences"
import {
  isDesktopNotificationSupported,
  requestDesktopNotificationPermission,
  showDesktopNotification,
} from "@/lib/desktop-notifications"
import type {
  StudioProfileModelUsage,
  StudioProfileStats,
} from "@/lib/studio-profile-stats"

type SynaraSettingsSection =
  | "general"
  | "appearance"
  | "notifications"
  | "behavior"
  | "appsnap"
  | "shortcuts"
  | "worktrees"
  | "archived"
  | "skills"
  | "usage"

const en = {
  generalTitle: "General",
  generalDescription: "Account, project, application, and session defaults.",
  appearanceTitle: "Appearance",
  appearanceDescription:
    "Theme, language, and the visual language used across CompShare.",
  notificationsTitle: "Notifications",
  notificationsDescription: "In-app toasts and desktop alerts.",
  behaviorTitle: "Behavior",
  behaviorDescription: "Streaming, confirmations, and conversation behavior.",
  appsnapTitle: "AppSnap",
  appsnapDescription: "Snap another app’s window straight into a task.",
  shortcutsTitle: "Keyboard Shortcuts",
  shortcutsDescription:
    "Keyboard shortcuts available in CompShare, grouped by context.",
  worktreesTitle: "Worktrees",
  worktreesDescription:
    "Review the local and sandbox workspaces used by CompShare.",
  archivedTitle: "Archived",
  archivedDescription: "View and restore archived conversations.",
  skillsTitle: "Skills",
  skillsDescription: "Installed skills available to agents.",
  usageTitle: "Usage",
  usageDescription: "Local token and prompt totals across your conversations.",
  themeLanguage: "Theme & language",
  theme: "Theme",
  themeDescription: "Use the system appearance or keep one theme selected.",
  light: "Light",
  dark: "Dark",
  system: "System",
  language: "Language",
  languageDescription: "Language used by CompShare navigation and settings.",
  taskCompletion: "Task completion",
  desktopNotifications: "Desktop notifications",
  desktopNotificationsDescription:
    "Show an operating-system notification when an agent finishes or needs tool approval.",
  notificationSounds: "Notification sounds",
  notificationSoundsDescription:
    "Play a sound for task and approval notifications.",
  testNotification: "Send test notification",
  testNotificationDescription:
    "Verify that CompShare can surface desktop alerts.",
  test: "Test",
  testNotificationBody: "Notification test for agent tasks.",
  testNotificationReadyTitle: "Notification test",
  testNotificationReadyDescription: "Agent task notifications are ready.",
  notificationUnavailable: "Desktop notifications are unavailable or blocked.",
  conversationBehavior: "Conversation behavior",
  followLiveOutput: "Follow live output",
  followLiveOutputDescription:
    "Keep the newest agent activity visible while a turn is running.",
  confirmDestructive: "Confirm destructive actions",
  confirmDestructiveDescription:
    "Ask before deleting conversations or workspaces.",
  screenCapture: "Screen capture",
  enableAppSnap: "Enable AppSnap",
  appSnapSupportedDescription:
    "Capture another app’s active window and attach it to a new task.",
  appSnapUnsupportedDescription:
    "AppSnap requires the CompShare desktop app on macOS.",
  appSnapCaptureNow: "Capture now",
  appSnapCaptureNowDescription:
    "Capture the frontmost non-CompShare window and attach it in Chat.",
  appSnapCaptureFailed: "AppSnap could not capture a window.",
  shortcut: "Shortcut",
  shortcutDescription: "Press this key chord while another app is active.",
  application: "Application",
  toggleSidebar: "Toggle sidebar",
  newConversation: "New conversation",
  openWorkspace: "Open workspace",
  openTerminal: "Open terminal",
  openBrowser: "Open browser",
  openFiles: "Open files",
  openSettings: "Open settings",
  managedWorkspaces: "Managed workspaces",
  archivedConversations: "Archived conversations",
  installedSkills: "Installed skills",
  loading: "Loading…",
  noWorkspaces: "No managed workspaces yet.",
  noArchived: "No archived conversations.",
  noSkills: "No installed skills yet.",
  untitled: "Untitled",
  loadFailed: "Failed to load settings.",
  restore: "Restore",
  restoreFailed: "Could not restore the conversation.",
  restoreSucceeded: "Conversation restored.",
  localActivity: "Local activity",
  lifetimeTokens: "Lifetime tokens",
  peakDay: "Peak day",
  totalPrompts: "Total prompts",
  totalThreads: "Total threads",
  modelBreakdown: "Usage by model",
  modelBreakdownDescription:
    "Recorded for every local run. Input includes cache details, so cache columns should not be added again.",
  model: "Model",
  runs: "Runs",
  sessions: "sessions",
  inputTokens: "Input",
  outputTokens: "Output",
  cacheReadTokens: "Cache read",
  cacheWriteTokens: "Cache write",
  reasoningTokens: "Reasoning",
  totalTokens: "Total",
  context: "context",
  lastUsed: "Last used",
  noModelUsage: "No model usage has been reported yet.",
  retry: "Try again",
} as const

type SynaraSettingsCopy = Record<keyof typeof en, string>

const zh = {
  generalTitle: "通用",
  generalDescription: "账户、项目、应用和会话的默认设置。",
  appearanceTitle: "外观",
  appearanceDescription: "设置 CompShare 的主题、语言和视觉风格。",
  notificationsTitle: "通知",
  notificationsDescription: "应用内提示和桌面通知。",
  behaviorTitle: "行为",
  behaviorDescription: "流式输出、操作确认和会话行为。",
  appsnapTitle: "AppSnap",
  appsnapDescription: "捕获其他应用窗口并直接添加到任务。",
  shortcutsTitle: "键盘快捷键",
  shortcutsDescription: "按使用场景查看 CompShare 的键盘快捷键。",
  worktreesTitle: "工作树",
  worktreesDescription: "查看 CompShare 使用的本地和沙箱工作区。",
  archivedTitle: "已归档",
  archivedDescription: "查看并恢复已归档的会话。",
  skillsTitle: "技能",
  skillsDescription: "Agent 可以使用的已安装技能。",
  usageTitle: "使用情况",
  usageDescription: "查看本机会话的 Token 和提示词统计。",
  themeLanguage: "主题与语言",
  theme: "主题",
  themeDescription: "跟随系统外观，或固定使用一个主题。",
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
  language: "语言",
  languageDescription: "CompShare 导航和设置页面使用的语言。",
  taskCompletion: "任务完成",
  desktopNotifications: "桌面通知",
  desktopNotificationsDescription:
    "Agent 完成任务或工具调用需要批准时显示系统通知。",
  notificationSounds: "通知声音",
  notificationSoundsDescription: "任务及批准通知出现时播放提示音。",
  testNotification: "发送测试通知",
  testNotificationDescription: "验证 CompShare 能否显示桌面通知。",
  test: "测试",
  testNotificationBody: "Agent 任务通知测试。",
  testNotificationReadyTitle: "通知测试",
  testNotificationReadyDescription: "Agent 任务通知已可用。",
  notificationUnavailable: "桌面通知不可用或已被系统阻止。",
  conversationBehavior: "会话行为",
  followLiveOutput: "跟随实时输出",
  followLiveOutputDescription: "任务运行时始终显示最新的 Agent 活动。",
  confirmDestructive: "确认破坏性操作",
  confirmDestructiveDescription: "删除会话或工作区前要求确认。",
  screenCapture: "屏幕捕获",
  enableAppSnap: "启用 AppSnap",
  appSnapSupportedDescription: "捕获其他应用的活动窗口并附加到新任务。",
  appSnapUnsupportedDescription:
    "AppSnap 需要在 macOS 版 CompShare 桌面应用中使用。",
  appSnapCaptureNow: "立即捕获",
  appSnapCaptureNowDescription:
    "捕获最前方的非 CompShare 窗口，并将图片附加到聊天。",
  appSnapCaptureFailed: "AppSnap 无法捕获窗口。",
  shortcut: "快捷键",
  shortcutDescription: "其他应用处于活动状态时按下此组合键。",
  application: "应用",
  toggleSidebar: "切换侧边栏",
  newConversation: "新建会话",
  openWorkspace: "打开工作区",
  openTerminal: "打开终端",
  openBrowser: "打开浏览器",
  openFiles: "打开文件",
  openSettings: "打开设置",
  managedWorkspaces: "托管工作区",
  archivedConversations: "已归档会话",
  installedSkills: "已安装技能",
  loading: "加载中…",
  noWorkspaces: "还没有托管工作区。",
  noArchived: "没有已归档会话。",
  noSkills: "还没有安装技能。",
  untitled: "未命名",
  loadFailed: "无法加载设置。",
  restore: "恢复",
  restoreFailed: "无法恢复该会话。",
  restoreSucceeded: "会话已恢复。",
  localActivity: "本地活动",
  lifetimeTokens: "累计 Token",
  peakDay: "单日峰值",
  totalPrompts: "提示词总数",
  totalThreads: "会话总数",
  modelBreakdown: "各模型用量",
  modelBreakdownDescription:
    "按每次本地运行记录。输入量已包含缓存明细，请勿与缓存列重复相加。",
  model: "模型",
  runs: "运行次数",
  sessions: "个会话",
  inputTokens: "输入",
  outputTokens: "输出",
  cacheReadTokens: "缓存读取",
  cacheWriteTokens: "缓存写入",
  reasoningTokens: "推理",
  totalTokens: "总计",
  context: "上下文",
  lastUsed: "最近使用",
  noModelUsage: "还没有模型上报用量。",
  retry: "重试",
} satisfies SynaraSettingsCopy

function getSettingsCopy(locale: string): SynaraSettingsCopy {
  return locale === "zh" ? zh : en
}

function getSectionMeta(copy: SynaraSettingsCopy) {
  return {
    appearance: {
      title: copy.appearanceTitle,
      description: copy.appearanceDescription,
    },
    notifications: {
      title: copy.notificationsTitle,
      description: copy.notificationsDescription,
    },
    behavior: {
      title: copy.behaviorTitle,
      description: copy.behaviorDescription,
    },
    appsnap: {
      title: copy.appsnapTitle,
      description: copy.appsnapDescription,
    },
    shortcuts: {
      title: copy.shortcutsTitle,
      description: copy.shortcutsDescription,
    },
    worktrees: {
      title: copy.worktreesTitle,
      description: copy.worktreesDescription,
    },
    archived: {
      title: copy.archivedTitle,
      description: copy.archivedDescription,
    },
    skills: {
      title: copy.skillsTitle,
      description: copy.skillsDescription,
    },
    usage: {
      title: copy.usageTitle,
      description: copy.usageDescription,
    },
  }
}

function AppearancePanel({ copy }: { copy: SynaraSettingsCopy }) {
  const { theme, setTheme } = useTheme()
  const { locale, setLocale } = useI18n()

  return (
    <SettingsSection title={copy.themeLanguage}>
      <SettingsRow label={copy.theme} description={copy.themeDescription}>
        <SettingsSegmented
          ariaLabel={copy.theme}
          value={theme}
          onChange={setTheme}
          options={[
            { id: "light" as const, label: copy.light },
            { id: "dark" as const, label: copy.dark },
            { id: "system" as const, label: copy.system },
          ]}
        />
      </SettingsRow>
      <SettingsRow label={copy.language} description={copy.languageDescription}>
        <SettingsSegmented
          ariaLabel={copy.language}
          value={locale}
          onChange={setLocale}
          options={[
            { id: "zh" as const, label: "中文" },
            { id: "en" as const, label: "English" },
          ]}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

function NotificationsPanel({ copy }: { copy: SynaraSettingsCopy }) {
  const [desktop, setDesktop] = useAppPreference("desktopNotifications")
  const [sounds, setSounds] = useAppPreference("notificationSounds")

  const handleDesktopChange = React.useCallback(
    async (next: boolean) => {
      if (!next) {
        setDesktop(false)
        return
      }

      const supported = await isDesktopNotificationSupported()
      const permission = supported
        ? await requestDesktopNotificationPermission()
        : "unsupported"

      if (permission !== "granted") {
        setDesktop(false)
        toast.error(copy.notificationUnavailable)
        return
      }

      setDesktop(true)
    },
    [copy.notificationUnavailable, setDesktop]
  )

  const handleTestNotification = React.useCallback(async () => {
    const supported = await isDesktopNotificationSupported()
    const permission = supported
      ? await requestDesktopNotificationPermission()
      : "unsupported"

    if (permission !== "granted") {
      toast.error(copy.notificationUnavailable)
      return
    }

    const shown = await showDesktopNotification({
      id: "astraflow-settings-notification-test",
      title: copy.testNotificationReadyTitle,
      body: copy.testNotificationBody,
      silent: !sounds,
      path: "/settings/notifications",
    })

    if (!shown) {
      toast.error(copy.notificationUnavailable)
      return
    }

    toast.success(copy.testNotificationReadyTitle, {
      description: copy.testNotificationReadyDescription,
    })
  }, [copy, sounds])

  return (
    <SettingsSection title={copy.taskCompletion}>
      <SettingsRow
        label={copy.desktopNotifications}
        description={copy.desktopNotificationsDescription}
      >
        <Switch checked={desktop} onCheckedChange={handleDesktopChange} />
      </SettingsRow>
      <SettingsRow
        label={copy.notificationSounds}
        description={copy.notificationSoundsDescription}
      >
        <Switch
          checked={sounds}
          disabled={!desktop}
          onCheckedChange={setSounds}
        />
      </SettingsRow>
      <SettingsRow
        label={copy.testNotification}
        description={copy.testNotificationDescription}
      >
        <SynaraButton
          size="sm"
          variant="outline"
          onClick={() => void handleTestNotification()}
        >
          {copy.test}
        </SynaraButton>
      </SettingsRow>
    </SettingsSection>
  )
}

function BehaviorPanel({ copy }: { copy: SynaraSettingsCopy }) {
  const [followOutput, setFollowOutput] = useAppPreference("followLiveOutput")
  const [confirmDestructive, setConfirmDestructive] =
    useAppPreference("confirmDestructive")

  return (
    <SettingsSection title={copy.conversationBehavior}>
      <SettingsRow
        label={copy.followLiveOutput}
        description={copy.followLiveOutputDescription}
      >
        <Switch checked={followOutput} onCheckedChange={setFollowOutput} />
      </SettingsRow>
      <SettingsRow
        label={copy.confirmDestructive}
        description={copy.confirmDestructiveDescription}
      >
        <Switch
          checked={confirmDestructive}
          onCheckedChange={setConfirmDestructive}
        />
      </SettingsRow>
    </SettingsSection>
  )
}

function AppSnapPanel({ copy }: { copy: SynaraSettingsCopy }) {
  const bridge =
    typeof window === "undefined" ? undefined : window.astraflowDesktop
  const [state, setState] = React.useState<AstraFlowAppSnapState | null>(null)

  React.useEffect(() => {
    if (!bridge?.getAppSnapState) return

    let active = true
    void bridge
      .getAppSnapState()
      .then((next) => {
        if (active) setState(next)
      })
      .catch(() => {
        if (active) toast.error(copy.appSnapCaptureFailed)
      })
    const dispose = bridge.onAppSnapStateChanged((next) => {
      setState(next)
    })

    return () => {
      active = false
      dispose()
    }
  }, [bridge, copy.appSnapCaptureFailed])

  const supported = state?.supported ?? false

  const handleEnabledChange = React.useCallback(
    async (enabled: boolean) => {
      if (!bridge?.setAppSnapEnabled) return

      try {
        const next = await bridge.setAppSnapEnabled(enabled)
        setState(next)
        if (enabled && !next.registered) {
          toast.error(next.error || copy.appSnapCaptureFailed)
        }
      } catch {
        toast.error(copy.appSnapCaptureFailed)
      }
    },
    [bridge, copy.appSnapCaptureFailed]
  )

  const handleCapture = React.useCallback(async () => {
    if (!bridge?.captureAppSnap) return

    try {
      const capture = await bridge.captureAppSnap()
      if (!capture) toast.error(copy.appSnapCaptureFailed)
    } catch {
      toast.error(copy.appSnapCaptureFailed)
    }
  }, [bridge, copy.appSnapCaptureFailed])

  return (
    <SettingsSection title={copy.screenCapture}>
      <SettingsRow
        label={copy.enableAppSnap}
        description={
          supported
            ? copy.appSnapSupportedDescription
            : copy.appSnapUnsupportedDescription
        }
      >
        <Switch
          checked={supported && Boolean(state?.enabled)}
          disabled={!supported || !state}
          onCheckedChange={(next) => void handleEnabledChange(next)}
        />
      </SettingsRow>
      <SettingsRow label={copy.shortcut} description={copy.shortcutDescription}>
        <kbd className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
          {state?.shortcut ?? "⌘ ⇧ 2"}
        </kbd>
      </SettingsRow>
      <SettingsRow
        label={copy.appSnapCaptureNow}
        description={copy.appSnapCaptureNowDescription}
      >
        <SynaraButton
          size="sm"
          variant="outline"
          disabled={!supported || !state?.enabled}
          onClick={() => void handleCapture()}
        >
          {copy.appSnapCaptureNow}
        </SynaraButton>
      </SettingsRow>
    </SettingsSection>
  )
}

function ShortcutsPanel({ copy }: { copy: SynaraSettingsCopy }) {
  const shortcuts = [
    [copy.toggleSidebar, "⌘ B"],
    [copy.newConversation, "⌘ N"],
    [copy.openWorkspace, "⌘ O"],
    [copy.openTerminal, "⌘ J"],
    [copy.openBrowser, "⌘ T"],
    [copy.openFiles, "⌘ P"],
    [copy.openSettings, "⌘ ,"],
  ] as const

  return (
    <SettingsSection title={copy.application}>
      {shortcuts.map(([label, shortcut]) => (
        <SettingsRow key={label} label={label}>
          <kbd className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
            {shortcut}
          </kbd>
        </SettingsRow>
      ))}
    </SettingsSection>
  )
}

function AsyncCollectionPanel({
  copy,
  section,
}: {
  copy: SynaraSettingsCopy
  section: "worktrees" | "archived" | "skills"
}) {
  const [result, setResult] = React.useState<{
    section: typeof section
    items: Record<string, unknown>[]
  } | null>(null)
  const items = result?.section === section ? result.items : []
  const loading = result?.section !== section

  React.useEffect(() => {
    let active = true
    const endpoint =
      section === "worktrees"
        ? "/api/studio/workspaces"
        : section === "archived"
          ? "/api/studio/sessions"
          : "/api/skills/installed"

    void fetch(endpoint, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as {
          ok: boolean
          data?: unknown
        }
        const data = Array.isArray(payload.data) ? payload.data : []
        const nextItems =
          section === "archived"
            ? data.filter(
                (item): item is Record<string, unknown> =>
                  typeof item === "object" &&
                  item !== null &&
                  typeof (item as Record<string, unknown>).archivedAt ===
                    "string"
              )
            : data.filter(
                (item): item is Record<string, unknown> =>
                  typeof item === "object" && item !== null
              )

        if (active) setResult({ section, items: nextItems })
      })
      .catch((error) => {
        if (!active) return
        setResult({ section, items: [] })
        toast.error(error instanceof Error ? error.message : copy.loadFailed)
      })

    return () => {
      active = false
    }
  }, [copy.loadFailed, section])

  const title =
    section === "worktrees"
      ? copy.managedWorkspaces
      : section === "archived"
        ? copy.archivedConversations
        : copy.installedSkills

  return (
    <SettingsSection title={title}>
      {loading ? (
        <SettingsEmptyRow>{copy.loading}</SettingsEmptyRow>
      ) : items.length === 0 ? (
        <SettingsEmptyRow>
          {section === "worktrees"
            ? copy.noWorkspaces
            : section === "archived"
              ? copy.noArchived
              : copy.noSkills}
        </SettingsEmptyRow>
      ) : (
        items.map((item, index) => {
          const id = String(item.id ?? item.slug ?? index)
          const label = String(
            item.name ?? item.title ?? item.slug ?? copy.untitled
          )
          const description = String(
            item.rootPath ?? item.installPath ?? item.archivedAt ?? ""
          )

          return (
            <SettingsRow key={id} label={label} description={description}>
              {section === "archived" ? (
                <SynaraButton
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const response = await fetch(
                      `/api/studio/sessions/${encodeURIComponent(id)}`,
                      {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ archived: false }),
                      }
                    )

                    if (!response.ok) {
                      toast.error(copy.restoreFailed)
                      return
                    }

                    toast.success(copy.restoreSucceeded)
                    setResult((current) =>
                      current?.section === section
                        ? {
                            ...current,
                            items: current.items.filter(
                              (candidate, candidateIndex) =>
                                String(
                                  candidate.id ??
                                    candidate.slug ??
                                    candidateIndex
                                ) !== id
                            ),
                          }
                        : current
                    )
                  }}
                >
                  {copy.restore}
                </SynaraButton>
              ) : null}
            </SettingsRow>
          )
        })
      )}
    </SettingsSection>
  )
}

function formatUsageDate(value: string, locale: string) {
  const timestamp = Date.parse(value)

  if (!Number.isFinite(timestamp)) {
    return "—"
  }

  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
  }).format(new Date(timestamp))
}

function formatContextWindow(value: number | null) {
  if (!value) return null

  if (value >= 1_000_000) {
    const millions = Math.round((value / 1_000_000) * 10) / 10
    return `${millions}m`
  }

  if (value >= 1_000) {
    const thousands = Math.round(value / 1_000)
    return `${thousands}k`
  }

  return value.toLocaleString()
}

function UsageValue({ value }: { value: number }) {
  return (
    <span className="text-xs tabular-nums select-text">
      {value.toLocaleString()}
    </span>
  )
}

function ModelUsageTable({
  copy,
  locale,
  models,
}: {
  copy: SynaraSettingsCopy
  locale: string
  models: StudioProfileModelUsage[]
}) {
  if (models.length === 0) {
    return <SettingsEmptyRow>{copy.noModelUsage}</SettingsEmptyRow>
  }

  const columnClass =
    "grid min-w-[940px] grid-cols-[minmax(210px,1.7fr)_minmax(88px,0.65fr)_repeat(6,minmax(92px,0.72fr))] items-center"

  return (
    <div
      aria-label={copy.modelBreakdown}
      className="overflow-x-auto"
      role="table"
    >
      <div className={`${columnClass} bg-token-foreground/[0.025]`} role="row">
        {[
          copy.model,
          copy.runs,
          copy.inputTokens,
          copy.outputTokens,
          copy.cacheReadTokens,
          copy.cacheWriteTokens,
          copy.reasoningTokens,
          copy.totalTokens,
        ].map((label, index) => (
          <div
            className={`px-3 py-2 text-[11px] font-medium text-token-text-tertiary ${
              index === 0 ? "text-left" : "text-right"
            }`}
            key={label}
            role="columnheader"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="divide-y divide-token-border" role="rowgroup">
        {models.map((entry) => {
          const contextWindow = formatContextWindow(entry.contextWindow)
          const metadata = [
            entry.runtimes.join(" · "),
            contextWindow ? `${contextWindow} ${copy.context}` : null,
            `${copy.lastUsed} ${formatUsageDate(entry.lastUsedAt, locale)}`,
          ]
            .filter(Boolean)
            .join(" · ")

          return (
            <div
              className={`${columnClass} group`}
              key={entry.model}
              role="row"
            >
              <div
                className="flex min-w-0 flex-col gap-1.5 px-3 py-3"
                role="cell"
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <span className="truncate text-xs font-medium select-text">
                    {entry.model}
                  </span>
                  <span className="shrink-0 text-[11px] text-token-text-tertiary tabular-nums">
                    {entry.percent}%
                  </span>
                </div>
                <div className="h-0.5 overflow-hidden rounded-full bg-token-foreground/[0.06]">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                    style={{ width: `${Math.max(entry.percent, 1)}%` }}
                  />
                </div>
                <span className="truncate text-[10px] text-token-text-tertiary">
                  {metadata}
                </span>
              </div>
              <div className="flex flex-col items-end px-3 py-3" role="cell">
                <UsageValue value={entry.runs} />
                <span className="text-[10px] text-token-text-tertiary">
                  {entry.sessions.toLocaleString()} {copy.sessions}
                </span>
              </div>
              {[
                entry.inputTokens,
                entry.outputTokens,
                entry.cachedInputTokens,
                entry.cacheWriteInputTokens,
                entry.reasoningOutputTokens,
                entry.totalTokens,
              ].map((value, index) => (
                <div
                  className="px-3 py-3 text-right"
                  key={`${entry.model}-${index}`}
                  role="cell"
                >
                  <UsageValue value={value} />
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UsagePanel({ copy }: { copy: SynaraSettingsCopy }) {
  const { locale } = useI18n()
  const [stats, setStats] = React.useState<StudioProfileStats | null>(null)
  const [error, setError] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)

  React.useEffect(() => {
    const controller = new AbortController()

    void fetch("/api/studio/profile-stats", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: StudioProfileStats
        }

        if (!response.ok || !payload.data) {
          throw new Error("profile_stats_failed")
        }

        setStats(payload.data)
      })
      .catch((loadError: unknown) => {
        if ((loadError as { name?: string })?.name !== "AbortError") {
          setError(true)
        }
      })

    return () => controller.abort()
  }, [reloadKey])

  if (error) {
    return (
      <SettingsSection title={copy.localActivity}>
        <SettingsEmptyRow>
          <span>{copy.loadFailed}</span>
          <SynaraButton
            className="mt-2"
            onClick={() => {
              setError(false)
              setReloadKey((current) => current + 1)
            }}
            size="sm"
            variant="outline"
          >
            {copy.retry}
          </SynaraButton>
        </SettingsEmptyRow>
      </SettingsSection>
    )
  }

  return (
    <>
      <SettingsSection title={copy.localActivity}>
        <SettingsRow label={copy.lifetimeTokens}>
          <span className="text-sm tabular-nums">
            {stats?.lifetimeTokens.toLocaleString() ?? "—"}
          </span>
        </SettingsRow>
        <SettingsRow label={copy.peakDay}>
          <span className="text-sm tabular-nums">
            {stats?.peakDayTokens.toLocaleString() ?? "—"}
          </span>
        </SettingsRow>
        <SettingsRow label={copy.totalPrompts}>
          <span className="text-sm tabular-nums">
            {stats?.totalPrompts.toLocaleString() ?? "—"}
          </span>
        </SettingsRow>
        <SettingsRow label={copy.totalThreads}>
          <span className="text-sm tabular-nums">
            {stats?.totalThreads.toLocaleString() ?? "—"}
          </span>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection
        description={copy.modelBreakdownDescription}
        title={copy.modelBreakdown}
      >
        {stats ? (
          <ModelUsageTable
            copy={copy}
            locale={locale}
            models={stats.modelUsageDetails}
          />
        ) : (
          <SettingsEmptyRow>{copy.loading}</SettingsEmptyRow>
        )}
      </SettingsSection>
    </>
  )
}

function SettingsSynaraSectionPage({
  section,
}: {
  section: SynaraSettingsSection
}) {
  const { locale } = useI18n()
  const copy = getSettingsCopy(locale)

  if (section === "general") {
    return (
      <SettingsProfilePage
        title={copy.generalTitle}
        description={copy.generalDescription}
      />
    )
  }

  const meta = getSectionMeta(copy)[section]

  return (
    <SettingsPage>
      <SettingsPageHeader title={meta.title} description={meta.description} />
      {section === "appearance" ? <AppearancePanel copy={copy} /> : null}
      {section === "notifications" ? <NotificationsPanel copy={copy} /> : null}
      {section === "behavior" ? <BehaviorPanel copy={copy} /> : null}
      {section === "appsnap" ? <AppSnapPanel copy={copy} /> : null}
      {section === "shortcuts" ? <ShortcutsPanel copy={copy} /> : null}
      {section === "worktrees" ||
      section === "archived" ||
      section === "skills" ? (
        <AsyncCollectionPanel copy={copy} section={section} />
      ) : null}
      {section === "usage" ? <UsagePanel copy={copy} /> : null}
    </SettingsPage>
  )
}

export { SettingsSynaraSectionPage }
export type { SynaraSettingsSection }
