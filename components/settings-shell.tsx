"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ArrowLeft,
  Bot,
  CircleUserRound,
  KeyRound,
  Search,
  UserRound,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { useI18n } from "@/components/i18n-provider"
import { Input } from "@/components/ui/input"
import { SETTINGS_RETURN_PATH_KEY } from "@/lib/settings-return-path"
import { cn } from "@/lib/utils"

type SettingsNavItem = {
  href: string
  label: string
  icon: LucideIcon
}

function SettingsNavLink({
  item,
  active,
}: {
  item: SettingsNavItem
  active: boolean
}) {
  const Icon = item.icon

  return (
    <Link
      className={cn(
        "no-drag flex h-8 items-center gap-2 rounded-md px-2.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent text-sidebar-accent-foreground"
      )}
      href={item.href}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  )
}

function SettingsShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { t } = useI18n()

  const personalItems: SettingsNavItem[] = [
    {
      href: "/settings/profile",
      label: t.settingsProfileNav,
      icon: UserRound,
    },
    {
      href: "/settings/account",
      label: t.settingsAccountNav,
      icon: CircleUserRound,
    },
  ]
  const integrationItems: SettingsNavItem[] = [
    {
      href: "/settings/api-keys",
      label: t.settingsApiKeysNav,
      icon: KeyRound,
    },
    {
      href: "/settings/agents",
      label: t.settingsAgentsNav,
      icon: Bot,
    },
  ]

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

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
    <div className="flex h-dvh min-h-0 bg-background text-foreground">
      <aside
        className="flex w-68 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        data-electron-drag-header
      >
        <div className="h-(--titlebar-height) shrink-0" aria-hidden />
        <div className="flex min-h-0 flex-1 flex-col gap-4 px-3 pb-5">
          <button
            type="button"
            className="no-drag flex h-8 w-fit items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            onClick={backToApp}
          >
            <ArrowLeft className="size-4" aria-hidden />
            <span>{t.settingsBackToApp}</span>
          </button>

          <div className="no-drag relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              aria-label={t.settingsSearchPlaceholder}
              className="h-8 rounded-md border-sidebar-border bg-background/70 pl-8 text-sm shadow-none"
              placeholder={t.settingsSearchPlaceholder}
              readOnly
            />
          </div>

          <nav className="grid gap-5">
            <div className="grid gap-1">
              <div className="px-2.5 text-xs text-muted-foreground">
                {t.settingsPersonalGroup}
              </div>
              {personalItems.map((item) => (
                <SettingsNavLink
                  active={isActive(item.href)}
                  item={item}
                  key={item.href}
                />
              ))}
            </div>

            <div className="grid gap-1">
              <div className="px-2.5 text-xs text-muted-foreground">
                {t.settingsIntegrationsGroup}
              </div>
              {integrationItems.map((item) => (
                <SettingsNavLink
                  active={isActive(item.href)}
                  item={item}
                  key={item.href}
                />
              ))}
            </div>
          </nav>
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
        <div className="mx-auto w-full max-w-5xl px-8 py-10 lg:px-12">
          {children}
        </div>
      </main>
    </div>
  )
}

export { SettingsShell }
