"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"

const SIDEBAR_MIN_WIDTH = 208
const SIDEBAR_MAX_WIDTH = 420
const SIDEBAR_DEFAULT_WIDTH = 288
// Below this drag position the logo no longer fits, so the sidebar collapses.
const SIDEBAR_COLLAPSE_AT = 176
const SIDEBAR_WIDTH_STORAGE_KEY = "astraflow.sidebar-width"

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value))
}

function SidebarResizeHandle({
  width,
  onWidthChange,
  onResizingChange,
}: {
  width: number
  onWidthChange: (width: number) => void
  onResizingChange: (resizing: boolean) => void
}) {
  const { open, setOpen, isMobile } = useSidebar()
  const openRef = React.useRef(open)

  React.useEffect(() => {
    openRef.current = open
  }, [open])

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    onResizingChange(true)

    function handleMove(moveEvent: PointerEvent) {
      const pointerX = moveEvent.clientX

      if (pointerX < SIDEBAR_COLLAPSE_AT) {
        if (openRef.current) {
          setOpen(false)
        }
        return
      }

      if (!openRef.current) {
        setOpen(true)
      }
      onWidthChange(clampSidebarWidth(pointerX))
    }

    function handleUp() {
      onResizingChange(false)
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
  }

  if (isMobile) {
    return null
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="fixed inset-y-0 z-20 hidden w-2 -translate-x-1/2 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px hover:after:bg-border md:block"
      style={{ left: open ? width : 6 }}
      onPointerDown={handlePointerDown}
    />
  )
}

function CollapsedSidebarTrigger() {
  const { isMobile, state } = useSidebar()

  if (!isMobile && state === "expanded") {
    return null
  }

  return (
    <div className="absolute top-2 left-2 z-30">
      <SidebarTrigger />
    </div>
  )
}

function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = React.useState(false)

  React.useEffect(() => {
    queueMicrotask(() => {
      const stored = Number.parseInt(
        window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY) ?? "",
        10
      )

      if (Number.isFinite(stored)) {
        setSidebarWidth(clampSidebarWidth(stored))
      }
    })
  }, [])

  React.useEffect(() => {
    window.localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(sidebarWidth)
    )
  }, [sidebarWidth])

  if (pathname === "/login") {
    return <>{children}</>
  }

  return (
    <SidebarProvider
      className={
        isResizing
          ? "select-none **:data-[slot=sidebar-container]:transition-none **:data-[slot=sidebar-gap]:transition-none"
          : undefined
      }
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--sidebar-width-mobile": "19rem",
        } as React.CSSProperties
      }
    >
      <React.Suspense fallback={null}>
        <AppSidebar />
      </React.Suspense>
      <SidebarResizeHandle
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        onResizingChange={setIsResizing}
      />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <CollapsedSidebarTrigger />
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export { AppShell }
