"use client"

import * as React from "react"
import { Provider, useAtomValue } from "jotai"
import { AnimatePresence, motion, useMotionTemplate } from "motion/react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  AppShellLayoutMotionProvider,
  SHELL_SPRING,
  useAppShellLayoutMotion,
} from "@/lib/app-shell/layout-motion"
import {
  appShellStore,
  clampSidebarWidth,
  floatingSidebarVisibleAtom,
  initializeStoreDefaults,
  setFloatingSidebarVisible,
  setSidebarOpen,
  setSidebarWidth,
  sidebarOpenAtom,
  toggleSidebar,
  SIDEBAR_RESIZE_COLLAPSE,
} from "@/lib/app-shell/store"
import { ShellThemeProvider } from "@/lib/app-shell/theme"

const FLOATING_LEFT_PANEL_EDGE = 12

type ShellSlotProps = {
  children?: React.ReactNode
}

type ResizeEdge = "left" | "right" | "top" | "bottom"

type DesktopAppShellProps = {
  children: React.ReactNode
  leftPanel?: React.ReactNode
  rightPanel?: React.ReactNode
  bottomPanel?: React.ReactNode
  header?: React.ReactNode
  leftPanelStorageKey?: string
  leftPanelDefaultOpen?: boolean
  leftPanelDefaultWidth?: number
  className?: string
  contentClassName?: string
  mainSurfaceClassName?: string
}

function ResizeHandle({
  edge,
  disabled,
  onDrag,
  onDragEnd,
  onResizingChange,
}: {
  edge: ResizeEdge
  disabled?: boolean
  onDrag: (delta: number) => void
  onDragEnd?: (lastDelta: number) => void
  onResizingChange?: (resizing: boolean) => void
}) {
  const startRef = React.useRef<{ last: number; total: number } | null>(null)

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) {
      return
    }

    event.preventDefault()
    const origin =
      edge === "top" || edge === "bottom" ? event.clientY : event.clientX
    startRef.current = { last: origin, total: 0 }
    onResizingChange?.(true)

    function handleMove(moveEvent: PointerEvent) {
      const point =
        edge === "top" || edge === "bottom"
          ? moveEvent.clientY
          : moveEvent.clientX
      const start = startRef.current

      if (!start) {
        return
      }

      const rawDelta = point - start.last
      const delta = edge === "left" || edge === "top" ? -rawDelta : rawDelta
      start.last = point
      start.total += delta
      onDrag(delta)
    }

    function handleUp() {
      const total = startRef.current?.total ?? 0
      startRef.current = null
      onResizingChange?.(false)
      onDragEnd?.(total)
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
      window.removeEventListener("pointercancel", handleUp)
    }

    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    window.addEventListener("pointercancel", handleUp)
  }

  return (
    <div
      role="separator"
      aria-disabled={disabled || undefined}
      aria-orientation={
        edge === "top" || edge === "bottom" ? "horizontal" : "vertical"
      }
      className={cn(
        "group absolute z-40 flex touch-none select-none",
        disabled && "pointer-events-none",
        edge === "left" &&
          "top-0 bottom-0 left-0 w-3 -translate-x-1.5 cursor-col-resize",
        edge === "right" &&
          "top-0 right-0 bottom-0 w-3 translate-x-1.5 cursor-col-resize",
        edge === "top" &&
          "top-0 right-0 left-0 h-3 -translate-y-1.5 cursor-row-resize",
        edge === "bottom" &&
          "right-0 bottom-0 left-0 h-3 translate-y-1.5 cursor-row-resize"
      )}
      onPointerDown={handlePointerDown}
    >
      <div
        className={cn(
          "m-auto opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-active:opacity-100",
          edge === "top" || edge === "bottom"
            ? "h-px w-full bg-gradient-to-r from-transparent via-border to-transparent"
            : "h-full w-px bg-gradient-to-b from-transparent via-border to-transparent"
        )}
      />
    </div>
  )
}

function ShellIconButton({
  label,
  children,
  onClick,
  pressed,
  className,
}: {
  label: string
  children: React.ReactNode
  onClick: () => void
  pressed?: boolean
  className?: string
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            className={cn("shadow-sm", className)}
            size="icon-sm"
            variant={pressed ? "secondary" : "ghost"}
            onClick={onClick}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DesktopShellLeftPanel(props: ShellSlotProps) {
  void props.children
  return null
}

function DesktopShellRightPanel(props: ShellSlotProps) {
  void props.children
  return null
}

function DesktopShellBottomPanel(props: ShellSlotProps) {
  void props.children
  return null
}

function DesktopShellContent({ children }: ShellSlotProps) {
  return <>{children}</>
}

function collectShellSlots(children: React.ReactNode) {
  const content: React.ReactNode[] = []
  let leftPanel: React.ReactNode
  let rightPanel: React.ReactNode
  let bottomPanel: React.ReactNode

  React.Children.forEach(children, (child) => {
    if (React.isValidElement<ShellSlotProps>(child)) {
      if (child.type === DesktopShellLeftPanel) {
        leftPanel = child.props.children
        return
      }

      if (child.type === DesktopShellRightPanel) {
        rightPanel = child.props.children
        return
      }

      if (child.type === DesktopShellBottomPanel) {
        bottomPanel = child.props.children
        return
      }

      if (child.type === DesktopShellContent) {
        content.push(child.props.children)
        return
      }
    }

    content.push(child)
  })

  return {
    bottomPanel,
    contentChildren: content,
    leftPanel,
    rightPanel,
  }
}

function DesktopAppShell({
  children,
  leftPanel,
  rightPanel,
  bottomPanel,
  header,
  leftPanelStorageKey: _leftPanelStorageKey,
  leftPanelDefaultOpen: _leftPanelDefaultOpen,
  leftPanelDefaultWidth: _leftPanelDefaultWidth,
  className,
  contentClassName,
  mainSurfaceClassName,
}: DesktopAppShellProps) {
  void _leftPanelStorageKey
  void _leftPanelDefaultOpen
  void _leftPanelDefaultWidth

  return (
    <Provider store={appShellStore}>
      <ShellThemeProvider>
        <AppShellLayoutMotionProvider
          className={cn(
            "app-shell-root relative flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-token-main-surface-primary text-token-foreground",
            className
          )}
        >
          <DesktopAppShellInner
            bottomPanel={bottomPanel}
            contentClassName={contentClassName}
            header={header}
            leftPanel={leftPanel}
            mainSurfaceClassName={mainSurfaceClassName}
            rightPanel={rightPanel}
          >
            {children}
          </DesktopAppShellInner>
        </AppShellLayoutMotionProvider>
      </ShellThemeProvider>
    </Provider>
  )
}

function DesktopAppShellInner({
  children,
  leftPanel,
  rightPanel,
  bottomPanel,
  header,
  contentClassName,
  mainSurfaceClassName,
}: Omit<
  DesktopAppShellProps,
  | "className"
  | "leftPanelStorageKey"
  | "leftPanelDefaultOpen"
  | "leftPanelDefaultWidth"
>) {
  const slots = React.useMemo(() => collectShellSlots(children), [children])
  const [isResizingLeft, setIsResizingLeft] = React.useState(false)
  const leftOpen = useAtomValue(sidebarOpenAtom, { store: appShellStore })
  const floatingLeftPanelOpen = useAtomValue(floatingSidebarVisibleAtom, {
    store: appShellStore,
  })
  const { leftPanelWidth, leftPanelAnimatedWidth, isMounted } =
    useAppShellLayoutMotion()
  const leftPanelWidthTemplate = useMotionTemplate`${leftPanelWidth}px`
  const currentLeftPanel = leftPanel ?? slots.leftPanel
  const currentRightPanel = rightPanel ?? slots.rightPanel
  const currentBottomPanel = bottomPanel ?? slots.bottomPanel
  const hasLeftPanel = currentLeftPanel != null

  React.useEffect(() => {
    initializeStoreDefaults()
  }, [])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        event.preventDefault()
        toggleSidebar(appShellStore, "keyboard")
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  function resizeLeft(delta: number) {
    const next = leftPanelWidth.get() + delta

    if (next < SIDEBAR_RESIZE_COLLAPSE) {
      setSidebarOpen(appShellStore, false)
      return
    }

    const width = clampSidebarWidth(next)
    leftPanelWidth.set(width)
    setSidebarOpen(appShellStore, true, { animate: false })
    setSidebarWidth(appShellStore, width, { persist: false })
  }

  function resizeFloatingLeft(delta: number) {
    const width = clampSidebarWidth(leftPanelWidth.get() + delta)
    leftPanelWidth.set(width)
    setSidebarWidth(appShellStore, width, { persist: false })
  }

  return (
    <div
      className={cn(
        "relative flex min-h-0 w-full flex-1 flex-col overflow-hidden",
        isResizingLeft && "cursor-col-resize select-none"
      )}
    >
      {header ? <div className="shrink-0">{header}</div> : null}

      <div className="relative isolate flex max-h-full min-h-0 w-full flex-1">
        {hasLeftPanel ? (
          <motion.aside
            className="app-shell-left-panel pointer-events-auto relative z-20 flex min-h-0 shrink-0 overflow-visible bg-token-side-bar-background text-token-foreground"
            style={{ width: leftPanelAnimatedWidth }}
          >
            <div className="h-full min-h-0 w-full min-w-0 overflow-hidden">
              {isMounted ? (
                <motion.div
                  className="h-full min-h-0 overflow-hidden"
                  style={{
                    minWidth: leftPanelWidthTemplate,
                    width: leftPanelWidthTemplate,
                  }}
                >
                  {currentLeftPanel}
                </motion.div>
              ) : null}
            </div>
            {leftOpen ? (
              <ResizeHandle
                edge="right"
                onDrag={resizeLeft}
                onDragEnd={() =>
                  setSidebarWidth(appShellStore, leftPanelWidth.get(), {
                    persist: true,
                  })
                }
                onResizingChange={setIsResizingLeft}
              />
            ) : null}
          </motion.aside>
        ) : null}

        {hasLeftPanel && !leftOpen ? (
          <>
            <div
              aria-hidden
              className="fixed top-0 bottom-0 left-0 z-30"
              style={{ width: FLOATING_LEFT_PANEL_EDGE }}
              onPointerEnter={() =>
                setFloatingSidebarVisible(appShellStore, true)
              }
            />
            <AnimatePresence initial={false}>
              {floatingLeftPanelOpen ? (
                <motion.div
                  key="floating-left-panel"
                  className="fixed top-0 bottom-0 left-0 z-50 min-h-0 overflow-visible p-2 pr-0"
                  data-pip-obstacle="desktop-shell-floating-left-panel"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  style={{ width: leftPanelWidthTemplate }}
                  transition={SHELL_SPRING}
                  onPointerLeave={() => {
                    if (!isResizingLeft) {
                      setFloatingSidebarVisible(appShellStore, false)
                    }
                  }}
                >
                  <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-(--radius-lg) border border-token-border-light bg-token-side-bar-background shadow-2xl">
                    <div className="min-h-0 flex-1 overflow-hidden">
                      {currentLeftPanel}
                    </div>
                  </aside>
                  <ResizeHandle
                    edge="right"
                    onDrag={resizeFloatingLeft}
                    onResizingChange={setIsResizingLeft}
                  />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </>
        ) : null}

        <main
          className={cn(
            "main-surface relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t-[0.5px] border-token-border-light bg-token-main-surface-primary",
            mainSurfaceClassName
          )}
        >
          <div
            className={cn(
              "relative isolate min-h-0 min-w-0 flex-1 overflow-hidden",
              contentClassName
            )}
          >
            {slots.contentChildren.length > 0
              ? slots.contentChildren
              : children}
          </div>

          {currentBottomPanel ? (
            <div className="relative z-30 shrink-0 overflow-hidden border-t bg-background">
              {currentBottomPanel}
            </div>
          ) : null}
        </main>

        {currentRightPanel}
      </div>
    </div>
  )
}

const DesktopShell = {
  Root: DesktopAppShell,
  LeftPanel: DesktopShellLeftPanel,
  Content: DesktopShellContent,
  RightPanel: DesktopShellRightPanel,
  BottomPanel: DesktopShellBottomPanel,
}

export {
  DesktopAppShell,
  DesktopShell,
  DesktopShellBottomPanel,
  DesktopShellContent,
  DesktopShellLeftPanel,
  DesktopShellRightPanel,
  ResizeHandle,
  ShellIconButton,
}
