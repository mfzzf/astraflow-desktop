import * as React from "react"
import type { Terminal as XTermTerminal } from "@xterm/xterm"
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit"

import { RiAddLine, RiCloseLine, RiTerminalBoxLine } from "@remixicon/react"

import { Button } from "@/components/ui/button"
import { useI18n } from "@/components/i18n-provider"
import {
  DEFAULT_CODEBOX_WORKSPACE_PATH,
  type CodeBoxSandbox,
  type CodeBoxTerminalEvent,
  type CodeBoxTerminalSession,
} from "../types"
import { apiRequest, getRepoName } from "../utils"
import { cn } from "@/lib/utils"

function parseTerminalEvent(event: MessageEvent<string>) {
  try {
    return JSON.parse(event.data) as CodeBoxTerminalEvent
  } catch {
    return null
  }
}

export function CodeBoxTerminalPanel({
  sandbox,
  onClose,
}: {
  sandbox: CodeBoxSandbox | null
  onClose: () => void
}) {
  const { t } = useI18n()
  const [terminalKey, setTerminalKey] = React.useState(0)
  const sandboxLabel =
    sandbox?.name ||
    (sandbox?.repoUrl ? getRepoName(sandbox.repoUrl) : sandbox?.sandboxId) ||
    ""

  return (
    <div
      data-testid="codebox-terminal-panel"
      aria-hidden={!sandbox}
      className={cn(
        "shrink-0 overflow-hidden border-t bg-background transition-[height,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        sandbox ? "border-border" : "pointer-events-none border-transparent"
      )}
      style={{ height: sandbox ? "min(44vh, 440px)" : 0 }}
    >
      <div
        className={cn(
          "h-full transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          sandbox ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
        )}
      >
        <div className="flex h-10 items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-1">
            <div
              className="flex h-8 min-w-0 max-w-72 items-center gap-2 rounded-xl bg-muted px-3 text-sm font-medium"
              title={sandboxLabel || t.codeboxTerminal}
            >
              <RiTerminalBoxLine className="size-4 shrink-0" aria-hidden />
              <span className="truncate">{t.codeboxTerminal}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
              aria-label={t.codeboxTerminalNew}
              title={t.codeboxTerminalNew}
              disabled={!sandbox}
              onClick={() => setTerminalKey((current) => current + 1)}
            >
              <RiAddLine aria-hidden className="size-4" />
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
            aria-label={t.codeboxTerminalClose}
            title={t.codeboxTerminalClose}
            onClick={onClose}
          >
            <RiCloseLine aria-hidden className="size-4" />
          </Button>
        </div>

        <div className="relative h-[calc(100%-2.5rem)] min-h-0 bg-background">
          {sandbox ? (
            <CodeBoxTerminalSurface
              key={`${sandbox.sandboxId}:${terminalKey}`}
              sandbox={sandbox}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function CodeBoxTerminalSurface({ sandbox }: { sandbox: CodeBoxSandbox }) {
  const { t } = useI18n()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const terminalRef = React.useRef<XTermTerminal | null>(null)
  const fitAddonRef = React.useRef<XTermFitAddon | null>(null)
  const sessionIdRef = React.useRef<string | null>(null)
  const tRef = React.useRef(t)

  React.useEffect(() => {
    tRef.current = t
  }, [t])

  const fitAndResize = React.useCallback(() => {
    const container = containerRef.current
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current

    if (
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

    const sessionId = sessionIdRef.current

    if (!sessionId) {
      return
    }

    void fetch(
      `/api/codebox/sandboxes/${encodeURIComponent(
        sandbox.sandboxId
      )}/terminal/${encodeURIComponent(sessionId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      }
    ).catch(() => undefined)
  }, [sandbox.sandboxId])

  React.useEffect(() => {
    let disposed = false
    let eventSource: EventSource | null = null
    let dataSubscription: { dispose: () => void } | null = null
    let resizeObserver: ResizeObserver | null = null
    let inputQueue = Promise.resolve()

    function terminalEndpoint(sessionId: string) {
      return `/api/codebox/sandboxes/${encodeURIComponent(
        sandbox.sandboxId
      )}/terminal/${encodeURIComponent(sessionId)}`
    }

    function enqueueTerminalInput(data: string) {
      const sessionId = sessionIdRef.current

      if (!sessionId) {
        return
      }

      inputQueue = inputQueue
        .then(async () => {
          if (disposed) {
            return
          }

          const response = await fetch(terminalEndpoint(sessionId), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              type: "input",
              data,
            }),
          })

          if (!response.ok) {
            throw new Error(tRef.current.codeboxTerminalInputFailed)
          }
        })
        .catch((error) => {
          if (!disposed) {
            terminalRef.current?.writeln(
              `\r\n${error instanceof Error ? error.message : tRef.current.codeboxTerminalInputFailed}`
            )
          }
        })
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

      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.2,
        scrollback: 10_000,
        theme: {
          background: "#ffffff",
          foreground: "#24292f",
          cursor: "#24292f",
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

      requestAnimationFrame(fitAndResize)

      resizeObserver = new ResizeObserver(() => {
        fitAndResize()
      })
      resizeObserver.observe(container)

      const created = await apiRequest<CodeBoxTerminalSession>(
        `/api/codebox/sandboxes/${encodeURIComponent(
          sandbox.sandboxId
        )}/terminal`,
        {
          method: "POST",
          body: JSON.stringify({
            cwd: sandbox.workspacePath || DEFAULT_CODEBOX_WORKSPACE_PATH,
            cols: terminal.cols,
            rows: terminal.rows,
          }),
        },
        tRef.current.codeboxTerminalStartFailed
      )

      if (disposed) {
        await fetch(terminalEndpoint(created.terminalId), {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined)
        return
      }

      sessionIdRef.current = created.terminalId
      terminal.writeln(tRef.current.codeboxTerminalConnected)
      fitAndResize()

      eventSource = new EventSource(
        `${terminalEndpoint(created.terminalId)}/events`
      )
      eventSource.addEventListener("output", (message) => {
        const event = parseTerminalEvent(message as MessageEvent<string>)

        if (event?.type === "output") {
          terminal.write(event.data)
        }
      })
      eventSource.addEventListener("exit", (message) => {
        const event = parseTerminalEvent(message as MessageEvent<string>)

        if (event?.type === "exit") {
          terminal.writeln("")
          terminal.writeln(tRef.current.codeboxTerminalExited(event.exitCode ?? 0))
        }
      })
      eventSource.addEventListener("failure", (message) => {
        const event = parseTerminalEvent(message as MessageEvent<string>)

        if (event?.type === "error") {
          terminal.writeln("")
          terminal.writeln(event.message)
        }
      })

      dataSubscription = terminal.onData(enqueueTerminalInput)
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
      const sessionId = sessionIdRef.current

      eventSource?.close()
      dataSubscription?.dispose()
      resizeObserver?.disconnect()

      if (sessionId) {
        void fetch(terminalEndpoint(sessionId), {
          method: "DELETE",
          keepalive: true,
        }).catch(() => undefined)
      }

      sessionIdRef.current = null
      terminalRef.current?.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [fitAndResize, sandbox.sandboxId, sandbox.workspacePath])

  return (
    <div
      ref={containerRef}
      className="size-full overflow-hidden bg-background px-4 py-1 font-mono text-xs"
    />
  )
}

export { parseTerminalEvent }
