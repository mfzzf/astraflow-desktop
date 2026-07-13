import { randomBytes, timingSafeEqual } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, realpath } from "node:fs/promises"
import http from "node:http"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { WebSocketServer } from "ws"

import {
  WorkspacePathError,
  resolveExistingWorkspacePath,
} from "./path-policy.mjs"
import { TerminalManager } from "./terminal-manager.mjs"

export const WORKSPACE_GATEWAY_PROTOCOL_VERSION = 1
export const WORKSPACE_GATEWAY_VERSION = "0.1.0"

const DEFAULT_PORT = 8787
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_JSON_BODY_BYTES = 64 * 1024
const CONNECTION_TICKET_TTL_MS = 30_000
const VISIBLE_DOTFILES = new Set([
  ".editorconfig",
  ".env",
  ".eslintrc",
  ".gitignore",
  ".npmrc",
  ".prettierrc",
])
const VISIBLE_DOTFILE_PREFIXES = [".env.", ".eslintrc.", ".prettierrc."]

class GatewayHttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message)
    this.name = "GatewayHttpError"
    this.status = status
    this.code = code
    this.headers = headers
  }
}

function readInteger(value, fallback, { allowZero = false } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  const minimum = allowZero ? 0 : 1

  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback
}

function writeJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload)

  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
    ...headers,
  })
  response.end(body)
}

function writeError(response, error) {
  if (error instanceof WorkspacePathError) {
    writeJson(response, error.status, {
      ok: false,
      error: { code: error.code, message: error.message },
    })
    return
  }

  if (error instanceof GatewayHttpError) {
    writeJson(
      response,
      error.status,
      {
        ok: false,
        error: { code: error.code, message: error.message },
      },
      error.headers
    )
    return
  }

  console.error("[workspace-gateway] request failed", error)
  writeJson(response, 500, {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Workspace Gateway request failed.",
    },
  })
}

function isAuthorized(request, expectedToken) {
  const authorization = request.headers.authorization

  if (!authorization?.startsWith("Bearer ")) {
    return false
  }

  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8")
  const expected = Buffer.from(expectedToken, "utf8")

  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

async function readJsonBody(request) {
  const chunks = []
  let received = 0

  for await (const chunk of request) {
    received += chunk.length

    if (received > MAX_JSON_BODY_BYTES) {
      throw new GatewayHttpError(
        413,
        "REQUEST_TOO_LARGE",
        "Request body exceeds the maximum size."
      )
    }

    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new GatewayHttpError(400, "INVALID_JSON", "Request body is not JSON.")
  }
}

function parseRangeHeader(value, size, maxBytes) {
  if (!value) {
    if (size > maxBytes) {
      throw new GatewayHttpError(
        413,
        "FILE_TOO_LARGE",
        "File is too large for a single response; request a byte range."
      )
    }

    return null
  }

  const match = value.match(/^bytes=(\d*)-(\d*)$/)

  if (!match || (!match[1] && !match[2])) {
    throw new GatewayHttpError(416, "INVALID_RANGE", "Byte range is invalid.", {
      "content-range": `bytes */${size}`,
    })
  }

  let start
  let end

  if (!match[1]) {
    const suffixLength = Number.parseInt(match[2], 10)

    if (!suffixLength) {
      throw new GatewayHttpError(416, "INVALID_RANGE", "Byte range is invalid.", {
        "content-range": `bytes */${size}`,
      })
    }

    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number.parseInt(match[1], 10)
    end = match[2] ? Number.parseInt(match[2], 10) : size - 1
  }

  if (start >= size || end < start) {
    throw new GatewayHttpError(416, "INVALID_RANGE", "Byte range is invalid.", {
      "content-range": `bytes */${size}`,
    })
  }

  end = Math.min(end, size - 1)

  if (end - start + 1 > maxBytes) {
    throw new GatewayHttpError(
      413,
      "RANGE_TOO_LARGE",
      "Requested byte range exceeds the maximum response size."
    )
  }

  return { start, end }
}

function pipeFile(response, absolutePath, stats, range, method) {
  const etag = `W/\"${stats.size.toString(16)}-${Math.trunc(stats.mtimeMs).toString(16)}\"`
  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, stats.size - 1)
  const contentLength = stats.size === 0 ? 0 : end - start + 1
  const headers = {
    "accept-ranges": "bytes",
    "cache-control": "no-store",
    "content-length": contentLength,
    "content-type": "application/octet-stream",
    etag,
    "last-modified": stats.mtime.toUTCString(),
  }

  if (range) {
    headers["content-range"] = `bytes ${start}-${end}/${stats.size}`
  }

  response.writeHead(range ? 206 : 200, headers)

  if (method === "HEAD" || stats.size === 0) {
    response.end()
    return
  }

  const stream = createReadStream(absolutePath, { start, end })

  stream.on("error", (error) => {
    console.error("[workspace-gateway] file stream failed", error)
    response.destroy(error)
  })
  response.on("close", () => stream.destroy())
  stream.pipe(response)
}

function isVisibleWorkspaceEntry(name) {
  const normalized = name.toLowerCase()

  return (
    !name.startsWith(".") ||
    VISIBLE_DOTFILES.has(normalized) ||
    VISIBLE_DOTFILE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  )
}

async function listWorkspaceEntries(workspaceRoot, requestedPath) {
  const directory = await resolveExistingWorkspacePath(
    workspaceRoot,
    requestedPath,
    { kind: "directory" }
  )
  const children = await readdir(directory.absolutePath, { withFileTypes: true })
  const entries = (
    await Promise.all(
      children.filter((entry) => isVisibleWorkspaceEntry(entry.name)).map(
        async (entry) => {
          const childPath = path.posix.join(directory.relativePath, entry.name)

          try {
            const child = await resolveExistingWorkspacePath(
              workspaceRoot,
              childPath,
              { allowRoot: false }
            )
            const kind = child.stats.isDirectory()
              ? "directory"
              : child.stats.isFile()
                ? "file"
                : null

            if (!kind) {
              return null
            }

            return {
              name: entry.name,
              path: childPath,
              kind,
              extension:
                kind === "file"
                  ? path.posix.extname(entry.name).replace(/^\./, "").toLowerCase()
                  : "",
              size: kind === "file" ? child.stats.size : null,
              modifiedAt: child.stats.mtimeMs,
            }
          } catch (error) {
            if (error instanceof WorkspacePathError) {
              return null
            }

            throw error
          }
        }
      )
    )
  )
    .filter(Boolean)
    .sort((left, right) => {
      if (left.kind !== right.kind) {
        return left.kind === "directory" ? -1 : 1
      }

      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      })
    })
  const parent = directory.relativePath
    ? path.posix.dirname(directory.relativePath)
    : null

  return {
    path: directory.relativePath,
    name: directory.relativePath
      ? path.posix.basename(directory.relativePath)
      : path.posix.basename(workspaceRoot),
    parent: parent === "." ? "" : parent,
    entries,
  }
}

function rejectUpgrade(socket, status, message) {
  const body = JSON.stringify({
    ok: false,
    error: { code: status === 401 ? "UNAUTHORIZED" : "NOT_FOUND", message },
  })

  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Not Found"}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body
  )
  socket.destroy()
}

export async function createWorkspaceGateway(options = {}) {
  const configuredRoot =
    options.workspaceRoot || process.env.ASTRAFLOW_WORKSPACE_ROOT || "/workspace"
  const token =
    options.token || process.env.ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN?.trim()

  if (!token || token.length < 24) {
    throw new Error(
      "ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN must contain at least 24 characters."
    )
  }

  await mkdir(configuredRoot, { recursive: true })

  const workspaceRoot = await realpath(configuredRoot)
  const config = {
    host:
      options.host || process.env.ASTRAFLOW_WORKSPACE_GATEWAY_HOST || "127.0.0.1",
    port: readInteger(
      options.port ?? process.env.ASTRAFLOW_WORKSPACE_GATEWAY_PORT,
      DEFAULT_PORT,
      { allowZero: true }
    ),
    workspaceRoot,
    workspaceId:
      options.workspaceId || process.env.ASTRAFLOW_WORKSPACE_ID || "unknown",
    sandboxId:
      options.sandboxId || process.env.ASTRAFLOW_SANDBOX_ID || "unknown",
    templateVersion:
      options.templateVersion ||
      process.env.ASTRAFLOW_TEMPLATE_VERSION ||
      "unknown",
    maxFileBytes: readInteger(
      options.maxFileBytes ?? process.env.ASTRAFLOW_GATEWAY_MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES
    ),
  }
  const terminalManager = new TerminalManager({
    workspaceRoot,
    disposeDelayMs: options.terminalDisposeDelayMs,
    detachedDisposeDelayMs: options.terminalDetachedDisposeDelayMs,
  })
  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_JSON_BODY_BYTES,
  })
  const connectionTickets = new Map()
  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (!response.headersSent) {
        writeError(response, error)
      } else {
        response.destroy(error instanceof Error ? error : undefined)
      }
    })
  })

  async function handleRequest(request, response) {
    const requestUrl = new URL(request.url || "/", "http://workspace-gateway")

    if (request.method === "GET" && requestUrl.pathname === "/healthz") {
      writeJson(response, 200, { ok: true, status: "ok" })
      return
    }

    if (!isAuthorized(request, token)) {
      throw new GatewayHttpError(401, "UNAUTHORIZED", "Bearer token is required.", {
        "www-authenticate": "Bearer",
      })
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/health") {
      writeJson(response, 200, {
        ok: true,
        data: {
          status: "ok",
          protocolVersion: WORKSPACE_GATEWAY_PROTOCOL_VERSION,
          gatewayVersion: WORKSPACE_GATEWAY_VERSION,
          templateVersion: config.templateVersion,
          workspaceId: config.workspaceId,
          sandboxId: config.sandboxId,
        },
      })
      return
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/workspace") {
      writeJson(response, 200, {
        ok: true,
        data: {
          workspaceId: config.workspaceId,
          sandboxId: config.sandboxId,
          root: config.workspaceRoot,
          capabilities: [
            "fs.entries",
            "fs.read",
            "terminal.pty",
            "terminal.websocket-ticket",
          ],
        },
      })
      return
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/fs/entries") {
      const requestedPath = requestUrl.searchParams.get("path") ?? ""
      const listing = await listWorkspaceEntries(
        config.workspaceRoot,
        requestedPath
      )

      writeJson(response, 200, { ok: true, data: listing })
      return
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      requestUrl.pathname === "/v1/fs/file"
    ) {
      const requestedPath = requestUrl.searchParams.get("path")

      if (requestedPath === null) {
        throw new GatewayHttpError(400, "INVALID_PATH", "Query parameter path is required.")
      }

      const resolved = await resolveExistingWorkspacePath(
        config.workspaceRoot,
        requestedPath,
        { allowRoot: false, kind: "file" }
      )
      const maxFileBytes =
        request.method === "HEAD"
          ? Number.MAX_SAFE_INTEGER
          : config.maxFileBytes
      const range = parseRangeHeader(
        request.headers.range,
        resolved.stats.size,
        maxFileBytes
      )

      pipeFile(
        response,
        resolved.absolutePath,
        resolved.stats,
        range,
        request.method
      )
      return
    }

    if (request.method === "POST" && requestUrl.pathname === "/v1/terminals") {
      const body = await readJsonBody(request)
      const terminal = await terminalManager.create({
        cwd: typeof body.cwd === "string" ? body.cwd : "",
        cols: body.cols,
        rows: body.rows,
      })

      writeJson(response, 201, { ok: true, data: terminal })
      return
    }

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/v1/connection-tickets"
    ) {
      const body = await readJsonBody(request)

      if (
        body.scope !== "terminal" ||
        typeof body.terminalId !== "string" ||
        !terminalManager.has(body.terminalId)
      ) {
        throw new GatewayHttpError(
          404,
          "TERMINAL_NOT_FOUND",
          "Terminal was not found."
        )
      }

      const now = Date.now()

      for (const [ticket, value] of connectionTickets) {
        if (value.expiresAt <= now || value.terminalId === body.terminalId) {
          connectionTickets.delete(ticket)
        }
      }

      const ticket = randomBytes(24).toString("base64url")
      const expiresAt = now + CONNECTION_TICKET_TTL_MS
      const websocketPath = `/v1/ws/terminals/${body.terminalId}?ticket=${encodeURIComponent(ticket)}`

      connectionTickets.set(ticket, {
        terminalId: body.terminalId,
        expiresAt,
      })
      writeJson(response, 201, {
        ok: true,
        data: {
          ticket,
          expiresAt: new Date(expiresAt).toISOString(),
          websocketPath,
        },
      })
      return
    }

    const terminalMatch = requestUrl.pathname.match(
      /^\/v1\/terminals\/([a-f0-9-]+)$/i
    )

    if (request.method === "DELETE" && terminalMatch) {
      const closed = terminalManager.close(terminalMatch[1])

      if (!closed) {
        throw new GatewayHttpError(404, "TERMINAL_NOT_FOUND", "Terminal was not found.")
      }

      writeJson(response, 200, { ok: true })
      return
    }

    throw new GatewayHttpError(404, "NOT_FOUND", "Gateway endpoint was not found.")
  }

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url || "/", "http://workspace-gateway")
    const match = requestUrl.pathname.match(
      /^\/v1\/ws\/terminals\/([a-f0-9-]+)$/i
    )

    if (!match) {
      rejectUpgrade(socket, 404, "WebSocket endpoint was not found.")
      return
    }

    const ticket = requestUrl.searchParams.get("ticket")
    const ticketRecord = ticket ? connectionTickets.get(ticket) : null
    const ticketIsValid = Boolean(
      ticketRecord &&
        ticketRecord.terminalId === match[1] &&
        ticketRecord.expiresAt > Date.now()
    )

    if (!isAuthorized(request, token) && !ticketIsValid) {
      rejectUpgrade(socket, 401, "Bearer token is required.")
      return
    }

    if (ticket && ticketIsValid) {
      connectionTickets.delete(ticket)
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      if (!terminalManager.attach(match[1], webSocket)) {
        webSocket.close(1008, "Terminal was not found")
      }
    })
  })

  return {
    config,
    server,
    terminalManager,
    async listen() {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          server.off("listening", onListening)
          reject(error)
        }
        const onListening = () => {
          server.off("error", onError)
          resolve()
        }

        server.once("error", onError)
        server.once("listening", onListening)
        server.listen(config.port, config.host)
      })

      return server.address()
    },
    async close() {
      terminalManager.closeAll()

      for (const client of webSocketServer.clients) {
        client.close(1001, "Gateway shutting down")
      }

      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections?.()
      })
      webSocketServer.close()
    },
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null

if (entryPath === fileURLToPath(import.meta.url)) {
  const gateway = await createWorkspaceGateway()
  const address = await gateway.listen()

  console.log(
    JSON.stringify({
      event: "workspace-gateway.ready",
      host: typeof address === "object" && address ? address.address : null,
      port: typeof address === "object" && address ? address.port : null,
      protocolVersion: WORKSPACE_GATEWAY_PROTOCOL_VERSION,
      gatewayVersion: WORKSPACE_GATEWAY_VERSION,
    })
  )

  let closing = false
  const close = async () => {
    if (closing) {
      return
    }

    closing = true
    await gateway.close()
    process.exit(0)
  }

  process.once("SIGINT", () => void close())
  process.once("SIGTERM", () => void close())
}
