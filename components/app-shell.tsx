"use client"

import * as React from "react"
import { useAtomValue } from "jotai"
import { usePathname, useRouter } from "next/navigation"
import { toast } from "sonner"

import { AppSidebar } from "@/components/app-sidebar"
import { AuthSessionGuard } from "@/components/auth-session-guard"
import { DesktopAppShell } from "@/components/desktop-shell/desktop-app-shell"
import { useI18n } from "@/components/i18n-provider"
import { StudioOnboardingTour } from "@/components/onboarding-tour"
import { StudioTaskNotifications } from "@/components/studio-task-notifications"
import { Titlebar } from "@/components/titlebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { createLocalWorkspaceForComposer } from "@/components/studio-chat/api"
import {
  appShellStore,
  setSidebarOpen,
  sidebarOpenAtom,
} from "@/lib/app-shell/store"
import {
  dispatchStudioLocalProjectsChanged,
  dispatchStudioSessionsChanged,
  dispatchStudioWorkspacesChanged,
} from "@/lib/studio-session-events"
import { setPendingProjectId } from "@/lib/studio-pending-project"
import { setPendingWorkspaceId } from "@/lib/studio-pending-workspace"
import { SETTINGS_RETURN_PATH_KEY } from "@/lib/settings-return-path"
import { CHAT_ENVIRONMENT_STORAGE_KEY } from "@/components/studio-chat/constants"

function LocalWorkspaceShortcut() {
  const router = useRouter()
  const { t } = useI18n()
  const openingRef = React.useRef(false)

  const openLocalWorkspace = React.useCallback(async () => {
    const pickFolder = window.astraflowDesktop?.pickFolder

    if (!pickFolder || openingRef.current) {
      return
    }

    openingRef.current = true

    try {
      const path = await pickFolder()

      if (!path) {
        return
      }

      const workspace = await createLocalWorkspaceForComposer(path)

      if (workspace.origin !== "selected_local") {
        throw new Error("The selected folder did not create a local workspace.")
      }

      setPendingWorkspaceId(workspace.id)
      setPendingProjectId(workspace.localProjectId)
      window.localStorage.setItem(CHAT_ENVIRONMENT_STORAGE_KEY, "local")
      window.dispatchEvent(new Event("storage"))
      dispatchStudioWorkspacesChanged()
      dispatchStudioLocalProjectsChanged()
      dispatchStudioSessionsChanged()
      router.push(`/studio?workspace=${encodeURIComponent(workspace.id)}`)
    } catch (error) {
      toast.error(t.studioLocalProjectOpenFailed, {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      openingRef.current = false
    }
  }, [router, t.studioLocalProjectOpenFailed])

  React.useEffect(() => {
    const disposeDesktopListener =
      window.astraflowDesktop?.onOpenLocalWorkspaceCommand?.(() => {
        void openLocalWorkspace()
      })

    function handleKeyDown(event: KeyboardEvent) {
      if (
        !window.astraflowDesktop?.pickFolder ||
        event.repeat ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== "o"
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      void openLocalWorkspace()
    }

    window.addEventListener("keydown", handleKeyDown, true)

    return () => {
      disposeDesktopListener?.()
      window.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [openLocalWorkspace])

  return null
}

function SettingsShortcut() {
  const pathname = usePathname()
  const router = useRouter()

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.repeat ||
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key !== ","
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (pathname === "/settings" || pathname.startsWith("/settings/")) {
        return
      }

      try {
        window.sessionStorage.setItem(SETTINGS_RETURN_PATH_KEY, pathname)
      } catch {
        // Private-mode storage failures fall back to the settings default.
      }
      router.push("/settings")
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [pathname, router])

  return null
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const sidebarOpen = useAtomValue(sidebarOpenAtom, { store: appShellStore })
  const handleSidebarOpenChange = React.useCallback((open: boolean) => {
    setSidebarOpen(appShellStore, open)
  }, [])

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
      <div className="relative h-svh min-h-0 overflow-hidden bg-background">
        <AuthSessionGuard />
        <div className="h-full min-h-0 overflow-hidden">{children}</div>
        <Titlebar className="absolute inset-x-0 top-0 z-10 bg-transparent" />
      </div>
    )
  }

  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return (
      <div className="flex h-svh min-h-0 flex-col bg-background">
        <AuthSessionGuard />
        <LocalWorkspaceShortcut />
        <SettingsShortcut />
        <StudioTaskNotifications />
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    )
  }

  return (
    <SidebarProvider
      className="h-svh min-h-0 flex-col"
      open={sidebarOpen}
      onOpenChange={handleSidebarOpenChange}
      style={{ "--sidebar-width": "100%" } as React.CSSProperties}
    >
      <AuthSessionGuard />
      <LocalWorkspaceShortcut />
      <SettingsShortcut />
      <StudioTaskNotifications />
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
