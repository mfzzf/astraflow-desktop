"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { AuthSessionGuard } from "@/components/auth-session-guard"
import { DesktopAppShell } from "@/components/desktop-shell/desktop-app-shell"
import { StudioOnboardingTour } from "@/components/onboarding-tour"
import { Titlebar } from "@/components/titlebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { SETTINGS_RETURN_PATH_KEY } from "@/lib/settings-return-path"

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  React.useEffect(() => {
    if (
      pathname === "/login" ||
      pathname === "/settings" ||
      pathname.startsWith("/settings/")
    ) {
      return
    }

    try {
      window.sessionStorage.setItem(SETTINGS_RETURN_PATH_KEY, pathname)
    } catch {
      // Private-mode storage failures just fall back to /studio on return.
    }
  }, [pathname])

  if (pathname === "/login") {
    return (
      <div className="flex h-svh min-h-0 flex-col bg-background">
        <AuthSessionGuard />
        <Titlebar className="bg-background" />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    )
  }

  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return (
      <div className="flex h-svh min-h-0 flex-col bg-background">
        <AuthSessionGuard />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    )
  }

  return (
    <SidebarProvider className="h-svh min-h-0 flex-col" style={{ "--sidebar-width": "100%" } as React.CSSProperties}>
      <AuthSessionGuard />
      <DesktopAppShell
        leftPanel={
          <React.Suspense fallback={null}>
            <AppSidebar embedded />
          </React.Suspense>
        }
      >
        <StudioOnboardingTour />
        <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </DesktopAppShell>
    </SidebarProvider>
  )
}

export { AppShell }
