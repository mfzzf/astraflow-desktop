"use client"

import { usePathname, useRouter } from "next/navigation"
import * as React from "react"
import { Bot, KeyRound, UserRound } from "lucide-react"

import {
  SettingsSecondarySidebar,
  SettingsTwoColumnShell,
  type SettingsSidebarGroup,
} from "@/components/desktop-shell/settings-secondary-sidebar"
import { useI18n } from "@/components/i18n-provider"
import { SETTINGS_RETURN_PATH_KEY } from "@/lib/settings-return-path"

function SettingsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useI18n()

  const groups = React.useMemo<SettingsSidebarGroup[]>(
    () => [
      {
        id: "personal",
        label: t.settingsPersonalGroup,
        items: [
          {
            id: "profile",
            href: "/settings/profile",
            label: t.settingsProfileNav,
            icon: UserRound,
          },
        ],
      },
      {
        id: "integrations",
        label: t.settingsIntegrationsGroup,
        items: [
          {
            id: "api-keys",
            href: "/settings/api-keys",
            label: t.settingsApiKeysNav,
            icon: KeyRound,
          },
          {
            id: "agents",
            href: "/settings/agents",
            label: t.settingsAgentsNav,
            icon: Bot,
          },
        ],
      },
    ],
    [t],
  )

  const activeId =
    groups.flatMap((group) => group.items).find((item) => {
      return item.href != null && (pathname === item.href || pathname.startsWith(`${item.href}/`))
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
    <SettingsTwoColumnShell
      sidebar={
        <SettingsSecondarySidebar
          activeId={activeId}
          backLabel={t.settingsBackToApp}
          groups={groups}
          title={t.settings}
          onBack={backToApp}
        />
      }
    >
      {children}
    </SettingsTwoColumnShell>
  )
}

export { SettingsShell }
