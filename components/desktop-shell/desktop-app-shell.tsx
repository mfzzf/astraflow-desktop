"use client"

import * as React from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const DEFAULT_LEFT_WIDTH = 300
const MIN_LEFT_WIDTH = 240
const MAX_LEFT_WIDTH = 520
const COLLAPSE_LEFT_WIDTH = 240
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function readStoredNumber(key: string | undefined, fallback: number) {
  if (!key || typeof window === "undefined") {
    return fallback
  }

  const stored = Number.parseFloat(window.localStorage.getItem(key) ?? "")

  return Number.isFinite(stored) ? stored : fallback
}

function useStoredNumber(key: string | undefined, fallback: number) {
  const [value, setValue] = React.useState(() => readStoredNumber(key, fallback))

  React.useEffect(() => {
    if (!key) {
      return
    }

    window.localStorage.setItem(key, String(value))
  }, [key, value])

  return [value, setValue] as const
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
    const origin = edge === "top" || edge === "bottom" ? event.clientY : event.clientX
    startRef.current = { last: origin, total: 0 }
    onResizingChange?.(true)

    function handleMove(moveEvent: PointerEvent) {
      const point =
        edge === "top" || edge === "bottom" ? moveEvent.clientY : moveEvent.clientX
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
      aria-orientation={edge === "top" || edge === "bottom" ? "horizontal" : "vertical"}
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
  leftPanelStorageKey = "astraflow.desktop-shell.left-width",
  leftPanelDefaultOpen = true,
  leftPanelDefaultWidth = DEFAULT_LEFT_WIDTH,
  className,
  contentClassName,
  mainSurfaceClassName,
}: DesktopAppShellProps) {
  const shouldReduceMotion = useReducedMotion()
  const slots = React.useMemo(() => collectShellSlots(children), [children])
  const [leftWidth, setLeftWidth] = useStoredNumber(
    leftPanelStorageKey,
    leftPanelDefaultWidth
  )
  const [leftOpen, setLeftOpen] = React.useState(leftPanelDefaultOpen)
  const [isResizingLeft, setIsResizingLeft] = React.useState(false)
  const [floatingLeftPanelOpen, setFloatingLeftPanelOpen] = React.useState(false)
  const constrainedLeftWidth = clamp(leftWidth, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH)
  const currentLeftPanel = leftPanel ?? slots.leftPanel
  const currentRightPanel = rightPanel ?? slots.rightPanel
  const currentBottomPanel = bottomPanel ?? slots.bottomPanel
  const hasLeftPanel = currentLeftPanel != null

  function resizeLeft(delta: number) {
    const next = constrainedLeftWidth + delta

    if (next < COLLAPSE_LEFT_WIDTH) {
      setLeftOpen(false)
      setFloatingLeftPanelOpen(false)
      return
    }

    setLeftOpen(true)
    setLeftWidth(clamp(next, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH))
  }

  function resizeFloatingLeft(delta: number) {
    setLeftWidth((current) => clamp(current + delta, MIN_LEFT_WIDTH, MAX_LEFT_WIDTH))
  }

  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, duration: 0.36, bounce: 0.06 }

  return (
    <div
      className={cn(
        "relative flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background text-foreground",
        isResizingLeft && "cursor-col-resize select-none",
        className
      )}
      style={
        {
          "--desktop-shell-left-width": `${constrainedLeftWidth}px`,
        } as React.CSSProperties
      }
    >
      {header ? <div className="shrink-0">{header}</div> : null}

      <div className="relative isolate flex min-h-0 flex-1">
        {hasLeftPanel ? (
          <AnimatePresence initial={false}>
            {leftOpen ? (
              <motion.aside
                key="left-panel"
                className="relative z-20 flex min-h-0 shrink-0 overflow-visible bg-sidebar/85 text-sidebar-foreground backdrop-blur-xl after:pointer-events-none after:absolute after:inset-y-0 after:-right-4 after:w-4 after:bg-inherit"
                initial={shouldReduceMotion ? false : { width: 0, opacity: 0 }}
                animate={{ width: constrainedLeftWidth, opacity: 1 }}
                exit={shouldReduceMotion ? { width: 0 } : { width: 0, opacity: 0 }}
                transition={transition}
              >
                <div
                  className="h-full max-w-full min-h-0 overflow-hidden"
                  style={{ minWidth: constrainedLeftWidth, width: constrainedLeftWidth }}
                >
                  {currentLeftPanel}
                </div>
                <ResizeHandle
                  edge="right"
                  onDrag={resizeLeft}
                  onResizingChange={setIsResizingLeft}
                />
              </motion.aside>
            ) : null}
          </AnimatePresence>
        ) : null}

        {hasLeftPanel && !leftOpen ? (
          <>
            <div
              aria-hidden
              className="fixed top-0 bottom-0 left-0 z-30"
              style={{ width: FLOATING_LEFT_PANEL_EDGE }}
              onPointerEnter={() => setFloatingLeftPanelOpen(true)}
            />
            <AnimatePresence initial={false}>
              {floatingLeftPanelOpen ? (
                <motion.div
                  key="floating-left-panel"
                  className="fixed top-0 bottom-0 left-0 z-50 min-h-0 overflow-visible p-2 pr-0"
                  data-pip-obstacle="desktop-shell-floating-left-panel"
                  initial={shouldReduceMotion ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: -8 }}
                  style={{ width: constrainedLeftWidth }}
                  transition={transition}
                  onPointerLeave={() => {
                    if (!isResizingLeft) {
                      setFloatingLeftPanelOpen(false)
                    }
                  }}
                >
                  <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background shadow-2xl">
                    <div className="flex h-11 shrink-0 items-center justify-end border-b px-2">
                      <ShellIconButton
                        label="Show sidebar"
                        onClick={() => {
                          setLeftOpen(true)
                          setFloatingLeftPanelOpen(false)
                        }}
                      >
                        <PanelLeftOpen className="size-4" aria-hidden />
                      </ShellIconButton>
                    </div>
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
            "relative isolate flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
            "shadow-[0_0_0_0.5px_var(--border),0_4px_18px_rgb(0_0_0/0.05)]",
            mainSurfaceClassName
          )}
        >
          {hasLeftPanel && leftOpen ? (
            <div className="absolute top-2 left-2 z-40">
              <ShellIconButton
                label="Hide sidebar"
                pressed
                onClick={() => setLeftOpen(false)}
              >
                <PanelLeftClose className="size-4" aria-hidden />
              </ShellIconButton>
            </div>
          ) : null}

          <div
            className={cn(
              "relative isolate min-h-0 min-w-0 flex-1 overflow-hidden",
              contentClassName
            )}
          >
            {slots.contentChildren.length > 0 ? slots.contentChildren : children}
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
