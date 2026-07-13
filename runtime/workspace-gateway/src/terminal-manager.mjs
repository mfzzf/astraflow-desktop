import { randomUUID } from "node:crypto"

import nodePty from "node-pty"
import { WebSocket } from "ws"

import { resolveExistingWorkspacePath } from "./path-policy.mjs"

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const MAX_INPUT_BYTES = 64 * 1024
const MAX_BACKLOG_BYTES = 64 * 1024

function clampTerminalSize(cols, rows) {
  return {
    cols: Math.max(20, Math.min(400, Math.round(Number(cols)) || DEFAULT_COLS)),
    rows: Math.max(6, Math.min(160, Math.round(Number(rows)) || DEFAULT_ROWS)),
  }
}

function isOpen(socket) {
  return socket?.readyState === WebSocket.OPEN
}

function sendJson(socket, payload) {
  if (isOpen(socket)) {
    socket.send(JSON.stringify(payload))
  }
}

function buildTerminalEnvironment() {
  const environment = {
    ...process.env,
    TERM: "xterm-256color",
  }

  delete environment.ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN

  return environment
}

export class TerminalManager {
  constructor({
    workspaceRoot,
    shell = process.env.ASTRAFLOW_WORKSPACE_SHELL || "/bin/bash",
    disposeDelayMs = 60_000,
    detachedDisposeDelayMs = 60_000,
  }) {
    this.workspaceRoot = workspaceRoot
    this.shell = shell
    this.disposeDelayMs = disposeDelayMs
    this.detachedDisposeDelayMs = detachedDisposeDelayMs
    this.sessions = new Map()
  }

  async create({ cwd = "", cols, rows } = {}) {
    const resolved = await resolveExistingWorkspacePath(this.workspaceRoot, cwd, {
      kind: "directory",
    })
    const size = clampTerminalSize(cols, rows)
    const terminalId = randomUUID()
    const processHandle = nodePty.spawn(this.shell, ["-l"], {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      cwd: resolved.absolutePath,
      env: buildTerminalEnvironment(),
    })
    const session = {
      terminalId,
      processHandle,
      cwd: resolved.relativePath,
      cols: size.cols,
      rows: size.rows,
      socket: null,
      backlog: Buffer.alloc(0),
      exit: null,
      disposeTimer: null,
      detachTimer: null,
      dataSubscription: null,
      exitSubscription: null,
    }

    session.dataSubscription = processHandle.onData((data) => {
      const chunk = Buffer.from(data)

      if (isOpen(session.socket)) {
        session.socket.send(chunk, { binary: true })
        return
      }

      session.backlog = Buffer.concat([session.backlog, chunk]).subarray(
        -MAX_BACKLOG_BYTES
      )
    })
    session.exitSubscription = processHandle.onExit(({ exitCode, signal }) => {
      session.exit = { exitCode, signal }
      sendJson(session.socket, {
        v: 1,
        type: "terminal.exit",
        terminalId,
        exitCode,
        signal,
      })
      session.disposeTimer = setTimeout(() => {
        this.dispose(terminalId, { kill: false })
      }, this.disposeDelayMs)
      session.disposeTimer.unref?.()
    })

    this.sessions.set(terminalId, session)

    return this.toInfo(session)
  }

  toInfo(session) {
    return {
      terminalId: session.terminalId,
      pid: session.processHandle.pid,
      cwd: session.cwd,
      cols: session.cols,
      rows: session.rows,
      websocketPath: `/v1/ws/terminals/${session.terminalId}`,
    }
  }

  has(terminalId) {
    return this.sessions.has(terminalId)
  }

  attach(terminalId, socket) {
    const session = this.sessions.get(terminalId)

    if (!session) {
      return false
    }

    if (isOpen(session.socket)) {
      session.socket.close(1012, "Terminal attached from another connection")
    }

    if (session.detachTimer) {
      clearTimeout(session.detachTimer)
      session.detachTimer = null
    }

    session.socket = socket
    sendJson(socket, {
      v: 1,
      type: "terminal.ready",
      ...this.toInfo(session),
    })

    if (session.backlog.length > 0) {
      socket.send(session.backlog, { binary: true })
      session.backlog = Buffer.alloc(0)
    }

    if (session.exit) {
      sendJson(socket, {
        v: 1,
        type: "terminal.exit",
        terminalId,
        ...session.exit,
      })
    }

    socket.on("message", (data, isBinary) => {
      try {
        this.handleMessage(session, data, isBinary)
      } catch (error) {
        sendJson(socket, {
          v: 1,
          type: "connection.error",
          code: "INVALID_TERMINAL_MESSAGE",
          message:
            error instanceof Error ? error.message : "Invalid terminal message.",
        })
      }
    })
    socket.on("close", () => {
      if (session.socket === socket) {
        session.socket = null
      }

      if (
        !session.exit &&
        session.socket === null &&
        this.sessions.get(terminalId) === session &&
        !session.detachTimer
      ) {
        session.detachTimer = setTimeout(() => {
          this.dispose(terminalId, { kill: true })
        }, this.detachedDisposeDelayMs)
        session.detachTimer.unref?.()
      }
    })

    return true
  }

  handleMessage(session, data, isBinary) {
    if (session.exit) {
      return
    }

    if (isBinary) {
      const input = Buffer.from(data)

      if (input.length > MAX_INPUT_BYTES) {
        throw new Error("Terminal input exceeds the maximum frame size.")
      }

      session.processHandle.write(input.toString("utf8"))
      return
    }

    const message = JSON.parse(Buffer.from(data).toString("utf8"))

    if (message?.type === "terminal.input" && typeof message.data === "string") {
      if (Buffer.byteLength(message.data) > MAX_INPUT_BYTES) {
        throw new Error("Terminal input exceeds the maximum frame size.")
      }

      session.processHandle.write(message.data)
      return
    }

    if (message?.type === "terminal.resize") {
      const size = clampTerminalSize(message.cols, message.rows)

      session.processHandle.resize(size.cols, size.rows)
      session.cols = size.cols
      session.rows = size.rows
      return
    }

    throw new Error("Unsupported terminal message type.")
  }

  close(terminalId) {
    return this.dispose(terminalId, { kill: true })
  }

  dispose(terminalId, { kill }) {
    const session = this.sessions.get(terminalId)

    if (!session) {
      return false
    }

    this.sessions.delete(terminalId)

    if (session.disposeTimer) {
      clearTimeout(session.disposeTimer)
    }

    if (session.detachTimer) {
      clearTimeout(session.detachTimer)
    }

    session.dataSubscription?.dispose()
    session.exitSubscription?.dispose()

    if (isOpen(session.socket)) {
      session.socket.close(1000, "Terminal closed")
    }

    if (kill && !session.exit) {
      try {
        session.processHandle.kill()
      } catch {
        // The PTY may have exited between the state check and kill.
      }
    }

    return true
  }

  closeAll() {
    for (const terminalId of this.sessions.keys()) {
      this.close(terminalId)
    }
  }
}
