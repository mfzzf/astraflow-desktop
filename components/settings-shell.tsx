"use client"

import { usePathname, useRouter } from "next/navigation"
import * as React from "react"

import {
  SettingsSecondarySidebar,
  SettingsTwoColumnShell,
  type SettingsSidebarGroup,
} from "@/components/desktop-shell/settings-secondary-sidebar"
import { useChannelConfig } from "@/components/channel-config-provider"
import { useI18n } from "@/components/i18n-provider"
import { COMPSHARE_PRODUCT_NAME } from "@/lib/channel-config-shared"
import { ShellThemeProvider } from "@/lib/app-shell/theme"
import { SETTINGS_RETURN_PATH_KEY } from "@/lib/settings-return-path"

function SettingsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { locale, t } = useI18n()
  const channel = useChannelConfig()
  const labels = React.useMemo(
    () =>
      locale === "zh"
        ? {
            app: "应用",
            general: "通用",
            profile: "个人资料",
            appearance: "外观",
            notifications: "通知",
            behavior: "行为",
            appsnap: "AppSnap",
            shortcuts: "键盘快捷键",
            worktrees: "工作树",
            archived: "已归档",
            models: "模型",
            providers: "提供方",
            skills: "技能",
            usage: "使用情况",
            advanced: "高级",
            advancedKeywords: [
              "Python",
              "pip",
              "Node.js",
              "npm",
              "依赖包",
              "运行环境",
            ],
          }
        : {
            app: "App",
            general: "General",
            profile: "Profile",
            appearance: "Appearance",
            notifications: "Notifications",
            behavior: "Behavior",
            appsnap: "AppSnap",
            shortcuts: "Keyboard Shortcuts",
            worktrees: "Worktrees",
            archived: "Archived",
            models: "Models",
            providers: "Providers",
            skills: "Skills",
            usage: "Usage",
            advanced: "Advanced",
            advancedKeywords: [
              "Python",
              "pip",
              "Node.js",
              "npm",
              "packages",
              "environment",
            ],
          },
    [locale]
  )

  const groups = React.useMemo<SettingsSidebarGroup[]>(
    () => [
      {
        id: "app",
        label: labels.app,
        items: [
          {
            id: "general",
            href: "/settings/general",
            label: labels.general,
            icon: "settings-gear-1",
          },
          {
            id: "profile",
            href: "/settings/profile",
            label: labels.profile,
            icon: "user",
          },
          {
            id: "appearance",
            href: "/settings/appearance",
            label: labels.appearance,
            icon: "color-palette",
          },
          {
            id: "notifications",
            href: "/settings/notifications",
            label: labels.notifications,
            icon: "bell",
          },
          {
            id: "behavior",
            href: "/settings/behavior",
            label: labels.behavior,
            icon: "settings-slider-hor",
          },
          {
            id: "appsnap",
            href: "/settings/appsnap",
            label: labels.appsnap,
            icon: "screen-capture",
          },
          {
            id: "shortcuts",
            href: "/settings/shortcuts",
            label: labels.shortcuts,
            icon: "shortcut",
          },
          {
            id: "worktrees",
            href: "/settings/worktrees",
            label: labels.worktrees,
            icon: "branch-simple",
          },
          {
            id: "archived",
            href: "/settings/archived",
            label: labels.archived,
            icon: "archive",
          },
        ],
      },
      {
        id: "astraflow",
        label:
          channel.slug.trim().toLowerCase() === "compshare"
            ? COMPSHARE_PRODUCT_NAME
            : channel.name || "AstraFlow",
        items: [
          {
            id: "models",
            href: "/settings/agents",
            label: labels.models,
            icon: "brain",
          },
          {
            id: "providers",
            href: "/settings/api-keys",
            label: labels.providers,
            icon: "puzzle",
          },
          {
            id: "skills",
            href: "/settings/skills",
            label: labels.skills,
            icon: "building-blocks",
          },
          {
            id: "usage",
            href: "/settings/usage",
            label: labels.usage,
            icon: "gauge",
          },
          {
            id: "advanced",
            href: "/settings/environment",
            label: labels.advanced,
            icon: "toolbox",
            keywords: labels.advancedKeywords,
          },
        ],
      },
    ],
    [channel.name, channel.slug, labels]
  )

  const activeId =
    groups
      .flatMap((group) => group.items)
      .find((item) => {
        return (
          item.href != null &&
          (pathname === item.href || pathname.startsWith(`${item.href}/`))
        )
      })?.id ?? "profile"

  function backToApp() {
    let returnPath: string | null = null

    try {
      returnPath = window.sessionStorage.getItem(SETTINGS_RETURN_PATH_KEY)
    } catch {
      returnPath = null
    }

    router.push(
      returnPath && !returnPath.startsWith("/settings") ? returnPath : "/studio"
    )
  }

  return (
    <ShellThemeProvider>
      <SettingsTwoColumnShell
        sidebar={
          <SettingsSecondarySidebar
            activeId={activeId}
            backLabel={t.settingsBackToApp}
            groups={groups}
            title={null}
            onBack={backToApp}
          />
        }
      >
        {children}
      </SettingsTwoColumnShell>
    </ShellThemeProvider>
  )
}

export { SettingsShell }
