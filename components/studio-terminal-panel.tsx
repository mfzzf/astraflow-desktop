"use client"

import * as React from "react"
import { RiAddLine, RiCloseLine } from "@remixicon/react"
import { SquareTerminal } from "lucide-react"
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit"
import type { Terminal as XTermTerminal } from "@xterm/xterm"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import type { StudioLocalProjectWithGitInfo } from "@/lib/studio-types"
import { cn, createClientId } from "@/lib/utils"

import { REMOTE_STUDIO_WORKSPACE_PATH } from "./studio-chat/remote-workspace-api"

const TERMINAL_PANEL_HEIGHT_STORAGE_KEY =
  "astraflow.studio.terminal-panel-height"
const TERMINAL_PANEL_DEFAULT_HEIGHT = 320
const TERMINAL_PANEL_MIN_HEIGHT = 220
const TERMINAL_PANEL_MAX_HEIGHT_RATIO = 0.58

type StudioTerminalTab = {
  id: string
  cwd: string | null
  sequence: number
  title: string
  resolvedCwd?: string
}

type TerminalPanelResizeDrag = {
  pointerId: number
  startHeight: number
  startY: number
}

type RemoteTerminalSession = {
  terminalId: string
  cwd: string
  websocketUrl: string
}

type RemoteTerminalControlEvent = {
  type: string
  exitCode?: number | null
  message?: string
}

function parseRemoteTerminalControlEvent(value: string) {
  try {
    return JSON.parse(value) as RemoteTerminalControlEvent
  } catch {
    return null
  }
}

function getPathTail(path: string | null | undefined) {
  const normalized = path?.replace(/\/+$/, "").trim()

  if (!normalized) {
    return ""
  }

  return normalized.split("/").filter(Boolean).at(-1) ?? normalized
}

function formatTerminalTabTitle(title: string, sequence: number) {
  return sequence > 1 ? `${title} ${sequence}` : title
}

function createStudioTerminalTab(
  project: StudioLocalProjectWithGitInfo | null,
  fallbackTitle: string,
  sequence = 1
): StudioTerminalTab {
  const cwd = REMOTE_STUDIO_WORKSPACE_PATH
  const title = project?.name || getPathTail(cwd) || fallbackTitle

  return {
    id: createClientId(),
    cwd,
    sequence,
    title: formatTerminalTabTitle(title, sequence),
  }
}

function getTerminalPanelMaximumHeight() {
  return typeof window === "undefined"
    ? TERMINAL_PANEL_DEFAULT_HEIGHT
    : Math.max(
        TERMINAL_PANEL_MIN_HEIGHT,
        Math.round(window.innerHeight * TERMINAL_PANEL_MAX_HEIGHT_RATIO)
      )
}

function clampTerminalPanelHeight(
  value: number,
  maximumHeight = getTerminalPanelMaximumHeight()
) {
  const nextValue = Number.isFinite(value)
    ? value
    : TERMINAL_PANEL_DEFAULT_HEIGHT

  return Math.min(
    maximumHeight,
    Math.max(TERMINAL_PANEL_MIN_HEIGHT, nextValue)
  )
}

function readStoredPanelHeight(maximumHeight: number) {
  if (typeof window === "undefined") {
    return TERMINAL_PANEL_DEFAULT_HEIGHT
  }

  const stored = window.localStorage.getItem(TERMINAL_PANEL_HEIGHT_STORAGE_KEY)

  if (stored == null || stored.trim() === "") {
    return clampTerminalPanelHeight(
      TERMINAL_PANEL_DEFAULT_HEIGHT,
      maximumHeight
    )
  }

  return clampTerminalPanelHeight(Number(stored), maximumHeight)
}

export function StudioTerminalPanel({
  open,
  project,
  sessionId,
  onOpenChange,
}: {
  open: boolean
  project: StudioLocalProjectWithGitInfo | null
  sessionId: string
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const [height, setHeight] = React.useState(TERMINAL_PANEL_DEFAULT_HEIGHT)
  const [maximumHeight, setMaximumHeight] = React.useState(
    TERMINAL_PANEL_DEFAULT_HEIGHT
  )
  const [heightRestored, setHeightRestored] = React.useState(false)
  const [isResizing, setIsResizing] = React.useState(false)
  const [terminalBootEnabled, setTerminalBootEnabled] = React.useState(open)
  const resizeHandleRef = React.useRef<HTMLDivElement | null>(null)
  const resizeDragRef = React.useRef<TerminalPanelResizeDrag | null>(null)
  const [terminalState, setTerminalState] = React.useState(() => {
    const tab = createStudioTerminalTab(project, t.studioTerminalTab)

    return {
      tabs: [tab],
      activeTabId: tab.id,
      nextTabSequence: 2,
    }
  })
  const { activeTabId, tabs } = terminalState
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]
  const shouldMountTerminals = terminalBootEnabled || open

  const finishResize = React.useCallback((updateState = true) => {
    const drag = resizeDragRef.current
    const handle = resizeHandleRef.current

    resizeDragRef.current = null

    if (drag && handle?.hasPointerCapture(drag.pointerId)) {
      try {
        handle.releasePointerCapture(drag.pointerId)
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }

    if (updateState) {
      setIsResizing(false)
    }
  }, [])

  React.useEffect(() => {
    const nextMaximumHeight = getTerminalPanelMaximumHeight()

    // Browser viewport and localStorage values are restored only after the
    // stable SSR/client hydration pass.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMaximumHeight(nextMaximumHeight)
    setHeight(readStoredPanelHeight(nextMaximumHeight))
    setHeightRestored(true)
  }, [])

  React.useEffect(() => {
    if (!heightRestored) {
      return
    }

    window.localStorage.setItem(
      TERMINAL_PANEL_HEIGHT_STORAGE_KEY,
      String(height)
    )
  }, [height, heightRestored])

  React.useEffect(() => {
    function handleWindowResize() {
      const nextMaximumHeight = getTerminalPanelMaximumHeight()

      setMaximumHeight(nextMaximumHeight)
      setHeight((current) => {
        const next = clampTerminalPanelHeight(current, nextMaximumHeight)
        return next === current ? current : next
      })
    }

    window.addEventListener("resize", handleWindowResize)

    return () => window.removeEventListener("resize", handleWindowResize)
  }, [])

  React.useEffect(() => {
    if (!open || terminalBootEnabled) {
      return
    }

    // This is a one-way lifecycle latch: delay PTY creation until the panel is
    // first opened, then keep the mounted terminal session alive across hides.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTerminalBootEnabled(true)
  }, [open, terminalBootEnabled])

  React.useEffect(() => {
    function handleWindowBlur() {
      finishResize()
    }

    window.addEventListener("blur", handleWindowBlur)

    return () => {
      window.removeEventListener("blur", handleWindowBlur)
      finishResize(false)
    }
  }, [finishResize])

  function handleResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!open || event.button !== 0) {
      return
    }

    event.preventDefault()
    finishResize()

    resizeDragRef.current = {
      pointerId: event.pointerId,
      startHeight: height,
      startY: event.clientY,
    }
    resizeHandleRef.current = event.currentTarget
    setIsResizing(true)

    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      finishResize()
    }
  }

  function handleResizePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    setHeight(
      clampTerminalPanelHeight(drag.startHeight + drag.startY - event.clientY)
    )
  }

  function handleResizePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (resizeDragRef.current?.pointerId === event.pointerId) {
      finishResize()
    }
  }

  function handleResizeLostPointerCapture(
    event: React.PointerEvent<HTMLDivElement>
  ) {
    if (resizeDragRef.current?.pointerId === event.pointerId) {
      finishResize()
    }
  }

  function handleAddTerminal() {
    setTerminalState((current) => {
      const tab = createStudioTerminalTab(
        project,
        t.studioTerminalTab,
        current.nextTabSequence
      )

      return {
        tabs: [...current.tabs, tab],
        activeTabId: tab.id,
        nextTabSequence: current.nextTabSequence + 1,
      }
    })
  }

  function handleCloseTab(tabId: string) {
    setTerminalState((current) => {
      if (current.tabs.length <= 1) {
        return current
      }

      const closingIndex = current.tabs.findIndex((tab) => tab.id === tabId)
      const nextTabs = current.tabs.filter((tab) => tab.id !== tabId)
      const nextActiveTabId =
        current.activeTabId === tabId
          ? (nextTabs[Math.max(0, closingIndex - 1)]?.id ??
            nextTabs[0]?.id ??
            current.activeTabId)
          : current.activeTabId

      return {
        tabs: nextTabs,
        activeTabId: nextActiveTabId,
        nextTabSequence: current.nextTabSequence,
      }
    })
  }

  function handleResolvedCwd(tabId: string, resolvedCwd: string) {
    setTerminalState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab
        }

        const title =
          tab.cwd === null
            ? formatTerminalTabTitle(
                getPathTail(resolvedCwd) || t.studioTerminalTab,
                tab.sequence
              )
            : tab.title

        return {
          ...tab,
          resolvedCwd,
          title,
        }
      }),
    }))
  }

  return (
    <div
      data-testid="studio-terminal-panel"
      aria-hidden={!open}
      inert={!open ? true : undefined}
      className={cn(
        "shrink-0 overflow-hidden bg-background",
        open ? "border-t border-border" : "pointer-events-none border-0",
        isResizing
          ? "select-none transition-none"
          : "transition-[height,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      )}
      style={{ height: open ? height : 0 }}
    >
      <div
        className={cn(
          "h-full transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          open ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
        )}
      >
        <div
          ref={resizeHandleRef}
          role="separator"
          aria-orientation="horizontal"
          aria-label={t.studioTerminalPanelResize}
          aria-valuemax={maximumHeight}
          aria-valuemin={TERMINAL_PANEL_MIN_HEIGHT}
          aria-valuenow={height}
          className="group relative z-20 h-2 cursor-row-resize touch-none bg-transparent"
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onLostPointerCapture={handleResizeLostPointerCapture}
        >
          <div
            aria-hidden
            className={cn(
              "absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors",
              isResizing ? "bg-primary/35" : "group-hover:bg-primary/25"
            )}
          />
        </div>

        <div className="flex h-8 items-center justify-between px-3">
          <div className="flex min-w-0 [scrollbar-width:none] items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab?.id
              const tabTitle =
                tab.resolvedCwd ?? tab.cwd ?? t.studioTerminalHome

              return (
                <div
                  key={tab.id}
                  className={cn(
                    "group flex h-7 max-w-56 min-w-0 items-center rounded-lg text-xs leading-none transition-colors",
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  )}
                >
                  <button
                    type="button"
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left"
                    title={tabTitle}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() =>
                      setTerminalState((current) => ({
                        ...current,
                        activeTabId: tab.id,
                      }))
                    }
                  >
                    <SquareTerminal
                      aria-hidden
                      className="size-3.5 shrink-0 stroke-[2.1]"
                    />
                    <span className="truncate">{tab.title}</span>
                  </button>

                  {tabs.length > 1 ? (
                    <button
                      type="button"
                      className={cn(
                        "mr-1 grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-75 group-hover:opacity-75 hover:bg-background/80 hover:text-foreground"
                      )}
                      aria-label={t.studioTerminalCloseTab}
                      title={t.studioTerminalCloseTab}
                      onClick={() => handleCloseTab(tab.id)}
                    >
                      <RiCloseLine aria-hidden className="size-3" />
                    </button>
                  ) : null}
                </div>
              )
            })}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
              aria-label={t.studioTerminalNew}
              title={t.studioTerminalNew}
              onClick={handleAddTerminal}
            >
              <RiAddLine aria-hidden className="size-4" />
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-7 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label={t.studioTerminalPanelClose}
            title={t.studioTerminalPanelClose}
            onClick={() => onOpenChange(false)}
          >
            <RiCloseLine aria-hidden className="size-4" />
          </Button>
        </div>

        <div className="relative h-[calc(100%-2.5rem)] min-h-0 bg-background">
          {shouldMountTerminals
            ? tabs.map((tab) => (
                <StudioTerminalSurface
                  key={tab.id}
                  active={tab.id === activeTab?.id}
                  cwd={tab.cwd}
                  fitEnabled={open && tab.id === activeTab?.id}
                  sessionId={sessionId}
                  onResolvedCwd={(resolvedCwd) =>
                    handleResolvedCwd(tab.id, resolvedCwd)
                  }
                />
              ))
            : null}
        </div>
      </div>
    </div>
  )
}

export function StudioTerminalSurface({
  active,
  cwd,
  fitEnabled,
  sessionId,
  onResolvedCwd,
}: {
  active: boolean
  cwd: string | null
  fitEnabled: boolean
  sessionId: string
  onResolvedCwd: (cwd: string) => void
}) {
  const { t } = useI18n()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const terminalRef = React.useRef<XTermTerminal | null>(null)
  const fitAddonRef = React.useRef<XTermFitAddon | null>(null)
  const sessionIdRef = React.useRef<string | null>(null)
  const socketRef = React.useRef<WebSocket | null>(null)
  const onResolvedCwdRef = React.useRef(onResolvedCwd)
  const fitEnabledRef = React.useRef(fitEnabled)
  const tRef = React.useRef(t)

  React.useEffect(() => {
    onResolvedCwdRef.current = onResolvedCwd
  }, [onResolvedCwd])

  React.useEffect(() => {
    fitEnabledRef.current = fitEnabled
  }, [fitEnabled])

  React.useEffect(() => {
    tRef.current = t
  }, [t])

  const fitAndResize = React.useCallback(() => {
    const container = containerRef.current
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current

    if (
      !fitEnabledRef.current ||
      !container ||
      !terminal ||
      !fitAddon ||
      container.offsetParent === null ||
      container.clientWidth < 16 ||
      container.clientHeight < 16
    ) {
      return
    }

    try {
      fitAddon.fit()
    } catch {
      return
    }

    const socket = socketRef.current

    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "terminal.resize",
          cols: terminal.cols,
          rows: terminal.rows,
        })
      )
    }
  }, [])

  React.useEffect(() => {
    if (!fitEnabled) {
      return
    }

    const frame = requestAnimationFrame(fitAndResize)

    return () => cancelAnimationFrame(frame)
  }, [fitAndResize, fitEnabled])

  React.useEffect(() => {
    let disposed = false
    let socket: WebSocket | null = null
    let dataSubscription: { dispose: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null
    let terminalExited = false

    function terminalEndpoint(terminalId?: string) {
      const base = `/api/studio/sessions/${encodeURIComponent(
        sessionId
      )}/workspace/terminal`

      return terminalId
        ? `${base}/${encodeURIComponent(terminalId)}`
        : base
    }

    async function bootTerminal() {
      const container = containerRef.current

      if (!container) {
        return
      }

      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ])

      if (disposed || !containerRef.current) {
        return
      }

      const containerStyles = window.getComputedStyle(container)
      const terminalBackground =
        containerStyles.backgroundColor || "rgb(250, 250, 250)"
      const terminalForeground = containerStyles.color || "rgb(36, 41, 47)"

      const terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        cursorWidth: 1,
        convertEol: true,
        // xterm measures glyphs via canvas, which cannot resolve the
        // ui-monospace keyword — lead with concrete family names.
        fontFamily:
          '"SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
        fontSize: 12,
        lineHeight: 1.3,
        scrollback: 10_000,
        theme: {
          background: terminalBackground,
          foreground: terminalForeground,
          cursor: terminalForeground,
          black: "#24292f",
          blue: "#4f8df7",
          brightBlack: "#8a9099",
          brightBlue: "#4f8df7",
          brightCyan: "#4f8df7",
          brightGreen: "#2f9e44",
          brightRed: "#d1242f",
          brightYellow: "#9a6700",
          cyan: "#4f8df7",
          green: "#2f9e44",
          red: "#d1242f",
          selectionBackground: "#d9e4ff",
          yellow: "#9a6700",
        },
      })
      const fitAddon = new FitAddon()

      terminal.loadAddon(fitAddon)
      terminal.open(container)
      terminalRef.current = terminal
      fitAddonRef.current = fitAddon
      terminal.writeln(tRef.current.codeboxTerminalConnecting)

      fitAndResize()

      requestAnimationFrame(() => {
        if (disposed) {
          return
        }

        fitAndResize()
      })

      resizeObserver = new ResizeObserver(() => {
        fitAndResize()
      })
      resizeObserver.observe(container)

      if (!sessionId) {
        throw new Error("Create a chat session before opening the remote terminal.")
      }

      const response = await fetch(terminalEndpoint(), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cwd: cwd || REMOTE_STUDIO_WORKSPACE_PATH,
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      })
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean
        data?: RemoteTerminalSession
        message?: string
      } | null

      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(
          payload?.message || tRef.current.codeboxTerminalStartFailed
        )
      }

      const created = payload.data

      if (disposed) {
        await fetch(terminalEndpoint(created.terminalId), {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined)
        return
      }

      sessionIdRef.current = created.terminalId
      onResolvedCwdRef.current(created.cwd)
      socket = new WebSocket(created.websocketUrl)
      socket.binaryType = "arraybuffer"
      socketRef.current = socket
      socket.addEventListener("message", (message) => {
        if (typeof message.data !== "string") {
          if (message.data instanceof ArrayBuffer) {
            terminal.write(new Uint8Array(message.data))
          }
          return
        }

        const event = parseRemoteTerminalControlEvent(message.data)

        if (event?.type === "terminal.exit") {
          terminalExited = true
          terminal.writeln("")
          terminal.writeln(tRef.current.studioTerminalExited(event.exitCode ?? 0))
        } else if (event?.type === "connection.error") {
          terminal.writeln("")
          terminal.writeln(
            event.message || tRef.current.codeboxTerminalInputFailed
          )
        }
      })
      socket.addEventListener("close", () => {
        if (!disposed && !terminalExited) {
          terminal.writeln("")
          terminal.writeln(tRef.current.codeboxTerminalInputFailed)
        }
      })

      await new Promise<void>((resolve, reject) => {
        socket?.addEventListener("open", () => resolve(), { once: true })
        socket?.addEventListener(
          "error",
          () => reject(new Error(tRef.current.codeboxTerminalStartFailed)),
          { once: true }
        )
      })

      if (disposed) {
        socket.close()
        return
      }

      terminal.writeln(tRef.current.codeboxTerminalConnected)
      dataSubscription = terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "terminal.input", data }))
        }
      })
      fitAndResize()
    }

    void bootTerminal().catch((error) => {
      if (!disposed) {
        terminalRef.current?.writeln("")
        terminalRef.current?.writeln(
          error instanceof Error
            ? error.message
            : tRef.current.codeboxTerminalStartFailed
        )
      }
    })

    return () => {
      disposed = true
      const terminalId = sessionIdRef.current

      socket?.close()
      socketRef.current = null

      dataSubscription?.dispose()
      resizeObserver?.disconnect()

      if (terminalId) {
        void fetch(terminalEndpoint(terminalId), {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined)
      }

      sessionIdRef.current = null
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [cwd, fitAndResize, sessionId])

  return (
    <div
      data-testid="studio-terminal-surface"
      className={cn(
        "absolute inset-0 min-h-0 bg-background px-3 py-1",
        !active && "hidden"
      )}
    >
      <div
        ref={containerRef}
        className="size-full overflow-hidden bg-background font-mono text-[11px] text-foreground"
      />
    </div>
  )
}
