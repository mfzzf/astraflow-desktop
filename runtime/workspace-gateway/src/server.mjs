import { randomBytes, timingSafeEqual } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, readdir, realpath } from "node:fs/promises"
import http from "node:http"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { WebSocket, WebSocketServer } from "ws"

import { AGENT_RUNTIME_IDS, AgentManager } from "./agent-manager.mjs"
import {
  WorkspacePathError,
  resolveExistingWorkspacePath,
} from "./path-policy.mjs"
import { readWorkspaceGitReview } from "./git-review.mjs"
import { TerminalManager } from "./terminal-manager.mjs"

export const WORKSPACE_GATEWAY_PROTOCOL_VERSION = 1
export const WORKSPACE_GATEWAY_VERSION = "0.5.0"

const DEFAULT_PORT = 8787
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_JSON_BODY_BYTES = 64 * 1024
const MAX_WEBSOCKET_PAYLOAD_BYTES = 32 * 1024 * 1024
const CONNECTION_TICKET_TTL_MS = 30_000
const DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS = 15_000
const WORKSPACE_FILE_SEARCH_CACHE_TTL_MS = 5_000
const WORKSPACE_FILE_SEARCH_CACHE_MAX_ENTRIES = 256
const WORKSPACE_FILE_CACHE_DIRECTORY = ".astraflow/file-cache"
const workspaceFileSearchCache = new Map()
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

async function listWorkspaceEntries(
  workspaceRoot,
  requestedPath,
  { includeHidden = false } = {}
) {
  const directory = await resolveExistingWorkspacePath(
    workspaceRoot,
    requestedPath,
    { kind: "directory" }
  )
  const children = await readdir(directory.absolutePath, { withFileTypes: true })
  const entries = (
    await Promise.all(
      children.filter(
        (entry) => includeHidden || isVisibleWorkspaceEntry(entry.name)
      ).map(
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

function workspaceFileReferenceSegments(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment && segment !== ".")
}

function matchingWorkspaceFileSuffixLength(candidatePath, referencePath) {
  const candidate = workspaceFileReferenceSegments(candidatePath).map(
    (segment) => segment.toLocaleLowerCase("en-US")
  )
  const reference = workspaceFileReferenceSegments(referencePath).map(
    (segment) => segment.toLocaleLowerCase("en-US")
  )
  let score = 0

  while (
    score < candidate.length &&
    score < reference.length &&
    candidate[candidate.length - score - 1] ===
      reference[reference.length - score - 1]
  ) {
    score += 1
  }

  return score
}

// Build a fresh workspace index on demand. File references are normally exact;
// this exhaustive fallback is reserved for stale absolute paths, partial tails,
// and bare filenames emitted by an agent. Scanning in the Gateway avoids one
// HTTP round-trip per directory and guarantees that a file is not missed merely
// because it lives deeper than a UI traversal budget.
async function findWorkspaceFileByReferenceUncached(
  workspaceRoot,
  referencePath,
  { signal } = {}
) {
  const referenceSegments = workspaceFileReferenceSegments(referencePath)
  const targetName = referenceSegments.at(-1) ?? ""
  const comparableTargetName = targetName.toLocaleLowerCase("en-US")

  if (!targetName) {
    throw new GatewayHttpError(400, "INVALID_PATH", "Query parameter reference is required.")
  }

  const directories = [""]
  const matches = []
  const visitedDirectories = new Set()

  for (let index = 0; index < directories.length; index += 1) {
    if (signal?.aborted) {
      throw new GatewayHttpError(499, "SEARCH_CANCELLED", "File search was cancelled.")
    }

    if (
      directories[index] === WORKSPACE_FILE_CACHE_DIRECTORY ||
      directories[index].startsWith(`${WORKSPACE_FILE_CACHE_DIRECTORY}/`)
    ) {
      continue
    }

    let realDirectory
    try {
      realDirectory = await realpath(
        path.resolve(workspaceRoot, directories[index])
      )
    } catch (error) {
      if (index === 0) {
        throw error
      }
      continue
    }

    if (visitedDirectories.has(realDirectory)) {
      continue
    }
    visitedDirectories.add(realDirectory)

    let listing
    try {
      listing = await listWorkspaceEntries(workspaceRoot, directories[index], {
        includeHidden: true,
      })
    } catch (error) {
      if (index === 0) {
        throw error
      }
      continue
    }

    for (const entry of listing.entries) {
      if (
        entry.kind === "file" &&
        entry.name.toLocaleLowerCase("en-US") === comparableTargetName
      ) {
        matches.push({
          path: entry.path,
          exactName: entry.name === targetName,
          score: matchingWorkspaceFileSuffixLength(entry.path, referencePath),
          modifiedAt: entry.modifiedAt,
        })
      } else if (entry.kind === "directory") {
        directories.push(entry.path)
      }
    }
  }

  matches.sort(
    (left, right) =>
      Number(right.exactName) - Number(left.exactName) ||
      right.score - left.score ||
      right.modifiedAt - left.modifiedAt ||
      left.path.length - right.path.length ||
      left.path.localeCompare(right.path)
  )

  const best = matches[0]
  const equallyStrong = best
    ? matches.filter(
        (match) =>
          match.exactName === best.exactName && match.score === best.score
      )
    : []

  return {
    path: equallyStrong.length === 1 ? equallyStrong[0].path : null,
    candidates: matches.map((match) => match.path),
  }
}

async function findWorkspaceFileByReference(
  workspaceRoot,
  referencePath,
  options = {}
) {
  const key = `${workspaceRoot}\0${referencePath}`
  const cached = workspaceFileSearchCache.get(key)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.result
  }

  const result = await findWorkspaceFileByReferenceUncached(
    workspaceRoot,
    referencePath,
    options
  )
  workspaceFileSearchCache.set(key, {
    expiresAt: Date.now() + WORKSPACE_FILE_SEARCH_CACHE_TTL_MS,
    result,
  })
  while (
    workspaceFileSearchCache.size > WORKSPACE_FILE_SEARCH_CACHE_MAX_ENTRIES
  ) {
    workspaceFileSearchCache.delete(
      workspaceFileSearchCache.keys().next().value
    )
  }

  return result
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
  const agentManager = new AgentManager({
    workspaceRoot,
    commands: options.agentCommands,
  })
  const webSocketServer = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES,
  })
  const webSocketHeartbeatIntervalMs = readInteger(
    options.webSocketHeartbeatIntervalMs,
    DEFAULT_WEBSOCKET_HEARTBEAT_INTERVAL_MS
  )
  const webSocketHeartbeat = setInterval(() => {
    for (const client of webSocketServer.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.ping()
      }
    }
  }, webSocketHeartbeatIntervalMs)

  webSocketHeartbeat.unref()
  const connectionTickets = new Map()
  const server = http.createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (response.destroyed) {
        return
      }

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
      const agentRuntimes = agentManager.listRuntimes()

      writeJson(response, 200, {
        ok: true,
        data: {
          status: "ok",
          protocolVersion: WORKSPACE_GATEWAY_PROTOCOL_VERSION,
          gatewayVersion: WORKSPACE_GATEWAY_VERSION,
          templateVersion: config.templateVersion,
          workspaceId: config.workspaceId,
          sandboxId: config.sandboxId,
          agentRuntimes,
        },
      })
      return
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/workspace") {
      const agentRuntimes = agentManager.listRuntimes()

      writeJson(response, 200, {
        ok: true,
        data: {
          workspaceId: config.workspaceId,
          sandboxId: config.sandboxId,
          root: config.workspaceRoot,
          capabilities: [
            "fs.entries",
            "fs.search",
            "fs.read",
            "git.review",
            "terminal.pty",
            "terminal.websocket-ticket",
            ...(agentRuntimes.some((runtime) => runtime.available)
              ? ["agent.acp.websocket"]
              : []),
          ],
          agentRuntimes,
        },
      })
      return
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/fs/entries") {
      const requestedPath = requestUrl.searchParams.get("path") ?? ""
      const listing = await listWorkspaceEntries(
        config.workspaceRoot,
        requestedPath,
        { includeHidden: requestUrl.searchParams.get("includeHidden") === "1" }
      )

      writeJson(response, 200, { ok: true, data: listing })
      return
    }

    if (request.method === "GET" && requestUrl.pathname === "/v1/fs/search") {
      const referencePath = requestUrl.searchParams.get("reference") ?? ""
      const abortController = new AbortController()
      const handleAborted = () => abortController.abort()
      request.once("aborted", handleAborted)
      let result
      try {
        result = await findWorkspaceFileByReference(
          config.workspaceRoot,
          referencePath,
          { signal: abortController.signal }
        )
      } finally {
        request.off("aborted", handleAborted)
      }

      writeJson(response, 200, { ok: true, data: result })
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

    if (request.method === "GET" && requestUrl.pathname === "/v1/git/review") {
      const requestedPath = requestUrl.searchParams.get("path") ?? ""
      const gitRoot = await resolveExistingWorkspacePath(
        config.workspaceRoot,
        requestedPath,
        { kind: "directory" }
      )
      const review = await readWorkspaceGitReview(gitRoot.absolutePath)

      writeJson(response, 200, { ok: true, data: review })
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
        throw new GatewayHttpError(404, "TERMINAL_NOT_FOUND", "Terminal was not found.")
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
        scope: "terminal",
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

    if (
      request.method === "POST" &&
      requestUrl.pathname === "/v1/agent-connections"
    ) {
      const body = await readJsonBody(request)
      const runtimeId = typeof body.runtimeId === "string" ? body.runtimeId : ""
      let prepared

      try {
        prepared = agentManager.prepare(runtimeId, body.env)
      } catch (error) {
        throw new GatewayHttpError(
          400,
          "INVALID_AGENT_ENVIRONMENT",
          error instanceof Error
            ? error.message
            : "Agent environment is invalid."
        )
      }

      if (!prepared) {
        throw new GatewayHttpError(
          409,
          "AGENT_RUNTIME_UNAVAILABLE",
          "The requested Agent runtime is unavailable in this Sandbox template."
        )
      }

      const ticket = randomBytes(24).toString("base64url")
      const now = Date.now()
      const expiresAt = now + CONNECTION_TICKET_TTL_MS
      const websocketPath = `/v1/ws/agents/${encodeURIComponent(runtimeId)}?ticket=${encodeURIComponent(ticket)}`

      for (const [candidate, value] of connectionTickets) {
        if (value.expiresAt <= now) {
          connectionTickets.delete(candidate)
        }
      }

      connectionTickets.set(ticket, {
        scope: "agent",
        prepared,
        expiresAt,
      })
      const expirationTimer = setTimeout(() => {
        if (connectionTickets.get(ticket)?.expiresAt === expiresAt) {
          connectionTickets.delete(ticket)
        }
      }, CONNECTION_TICKET_TTL_MS)

      expirationTimer.unref()
      writeJson(response, 201, {
        ok: true,
        data: {
          expiresAt: new Date(expiresAt).toISOString(),
          runtimeVersion: prepared.runtimeVersion,
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
        throw new GatewayHttpError(
          404,
          "TERMINAL_NOT_FOUND",
          "Terminal was not found."
        )
      }

      writeJson(response, 200, { ok: true })
      return
    }

    throw new GatewayHttpError(404, "NOT_FOUND", "Gateway endpoint was not found.")
  }

  server.on("upgrade", (request, socket, head) => {
    const requestUrl = new URL(request.url || "/", "http://workspace-gateway")
    const terminalMatch = requestUrl.pathname.match(
      /^\/v1\/ws\/terminals\/([a-f0-9-]+)$/i
    )
    const agentMatch = requestUrl.pathname.match(/^\/v1\/ws\/agents\/([^/]+)$/)

    if (agentMatch && !AGENT_RUNTIME_IDS.includes(agentMatch[1])) {
      rejectUpgrade(socket, 404, "Agent runtime was not found.")
      return
    }

    if (!terminalMatch && !agentMatch) {
      rejectUpgrade(socket, 404, "WebSocket endpoint was not found.")
      return
    }

    const ticket = requestUrl.searchParams.get("ticket")
    const ticketRecord = ticket ? connectionTickets.get(ticket) : null
    const terminalTicketIsValid = Boolean(
      terminalMatch &&
      ticketRecord &&
      ticketRecord.scope !== "agent" &&
      ticketRecord.terminalId === terminalMatch[1] &&
      ticketRecord.expiresAt > Date.now()
    )
    const agentTicketIsValid = Boolean(
      agentMatch &&
      ticketRecord?.scope === "agent" &&
      ticketRecord.prepared?.runtimeId === agentMatch[1] &&
      ticketRecord.expiresAt > Date.now()
    )
    const ticketIsValid = terminalTicketIsValid || agentTicketIsValid

    if (agentMatch && !agentTicketIsValid) {
      rejectUpgrade(socket, 401, "A valid one-time Agent ticket is required.")
      return
    }

    if (terminalMatch && !isAuthorized(request, token) && !ticketIsValid) {
      rejectUpgrade(socket, 401, "Bearer token is required.")
      return
    }

    if (ticket && ticketIsValid) {
      connectionTickets.delete(ticket)
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      if (agentMatch && ticketRecord?.scope === "agent") {
        void agentManager
          .attach(ticketRecord.prepared, webSocket)
          .then((attached) => {
            if (!attached && webSocket.readyState === WebSocket.OPEN) {
              webSocket.close(1011, "Agent runtime failed to start")
            }
          })
          .catch(() => {
            if (webSocket.readyState === WebSocket.OPEN) {
              webSocket.close(1011, "Agent runtime failed to start")
            }
          })
        return
      }

      if (terminalMatch && !terminalManager.attach(terminalMatch[1], webSocket)) {
        webSocket.close(1008, "Terminal was not found")
      }
    })
  })

  return {
    config,
    server,
    terminalManager,
    agentManager,
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
      clearInterval(webSocketHeartbeat)
      terminalManager.closeAll()
      agentManager.closeAll()

      for (const client of webSocketServer.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1001, "Gateway shutting down")
        }
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
