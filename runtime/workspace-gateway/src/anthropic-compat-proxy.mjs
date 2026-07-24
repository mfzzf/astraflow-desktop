import { timingSafeEqual } from "node:crypto"
import http from "node:http"
import https from "node:https"

import {
  createPinnedOutboundLookup,
  resolveSafeOutboundTarget,
} from "./safe-outbound.mjs"

const DEFAULT_HOST = "127.0.0.1"
const MAX_REQUEST_BYTES = 32 * 1024 * 1024
const MESSAGES_PATH = /^\/v1\/messages\/?$/
const TOKEN_COUNT_PATH = /^\/v1\/messages\/count_tokens\/?$/
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

function writeJson(response, status, payload) {
  const body = JSON.stringify(payload)

  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  })
  response.end(body)
}

function tokensMatch(left, right) {
  const supplied = Buffer.from(left, "utf8")
  const expected = Buffer.from(right, "utf8")

  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  )
}

function isAuthorized(request, clientToken) {
  const authorization = request.headers.authorization
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null
  const apiKeyHeader = request.headers["x-api-key"]
  const apiKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader

  return Boolean(
    (bearer && tokensMatch(bearer, clientToken)) ||
      (apiKey && tokensMatch(apiKey, clientToken))
  )
}

function normalizeUpstreamBaseUrl(value) {
  const url = new URL(value)

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Anthropic upstream URL must use HTTP or HTTPS.")
  }

  if (url.username || url.password) {
    throw new Error("Anthropic upstream URL must not contain credentials.")
  }

  url.hash = ""
  url.search = ""
  return url
}

function resolveUpstreamUrl(baseUrl, requestUrl) {
  const incoming = new URL(requestUrl || "/", "http://anthropic-compat-proxy")
  const target = new URL(baseUrl)
  const basePath = target.pathname.replace(/\/+$/, "")

  target.pathname = `${basePath}${incoming.pathname}` || "/"
  target.search = incoming.search
  return target
}

function createUpstreamHeaders(headers, target, authToken) {
  const forwarded = {}

  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase()

    if (
      value === undefined ||
      HOP_BY_HOP_HEADERS.has(normalizedName) ||
      normalizedName === "authorization" ||
      normalizedName === "host" ||
      normalizedName === "x-api-key"
    ) {
      continue
    }

    forwarded[name] = value
  }

  forwarded.authorization = `Bearer ${authToken}`
  forwarded.host = target.host
  return forwarded
}

function createDownstreamHeaders(headers) {
  const forwarded = {}

  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      forwarded[name] = value
    }
  }

  return forwarded
}

async function readBoundedBody(request) {
  const chunks = []
  let received = 0

  for await (const chunk of request) {
    received += chunk.length

    if (received > MAX_REQUEST_BYTES) {
      const error = new Error("Anthropic proxy request is too large.")
      error.code = "REQUEST_TOO_LARGE"
      throw error
    }

    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

function estimateInputTokens(body) {
  return Math.max(1, Math.ceil(body.length / 4))
}

function withoutContextManagementBeta(value) {
  if (value === undefined) {
    return undefined
  }

  const filtered = (Array.isArray(value) ? value.join(",") : value)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry && !/^context-management-/i.test(entry))

  return filtered.length > 0 ? filtered.join(",") : undefined
}

function createMessagesCompatibilityRequest(headers, body) {
  let parsed

  try {
    parsed = JSON.parse(body.toString("utf8"))
  } catch {
    return { headers, body }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { headers, body }
  }

  delete parsed.context_management
  const compatibleBody = Buffer.from(JSON.stringify(parsed), "utf8")
  const compatibleHeaders = { ...headers }
  const compatibleBeta = withoutContextManagementBeta(
    compatibleHeaders["anthropic-beta"]
  )

  if (compatibleBeta) {
    compatibleHeaders["anthropic-beta"] = compatibleBeta
  } else {
    delete compatibleHeaders["anthropic-beta"]
  }

  compatibleHeaders["content-length"] = String(compatibleBody.length)
  return { headers: compatibleHeaders, body: compatibleBody }
}

function forwardRequest({
  activeRequests,
  authToken,
  baseUrl,
  body,
  headers: requestHeaders,
  lookup,
  request,
  response,
}) {
  const target = resolveUpstreamUrl(baseUrl, request.url)
  const transport = target.protocol === "https:" ? https : http
  const headers = requestHeaders
    ? { ...requestHeaders }
    : body
      ? { ...request.headers }
      : request.headers

  if (body) {
    headers["content-length"] = String(body.length)
  }

  const declaredLength = Number.parseInt(headers["content-length"] ?? "", 10)

  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    request.resume()
    writeJson(response, 413, {
      error: {
        type: "request_too_large",
        message: "Anthropic proxy request is too large.",
      },
    })
    return
  }

  const upstreamRequest = transport.request(
    target,
    {
      method: request.method,
      headers: createUpstreamHeaders(headers, target, authToken),
      lookup,
    },
    (upstreamResponse) => {
      if (response.headersSent) {
        upstreamResponse.destroy()
        return
      }

      response.writeHead(
        upstreamResponse.statusCode ?? 502,
        createDownstreamHeaders(upstreamResponse.headers)
      )
      upstreamResponse.pipe(response)
    }
  )
  let received = 0
  let requestTooLarge = false

  activeRequests.add(upstreamRequest)
  upstreamRequest.once("close", () => activeRequests.delete(upstreamRequest))
  upstreamRequest.once("error", () => {
    if (!response.headersSent) {
      writeJson(response, requestTooLarge ? 413 : 502, {
        error: {
          type: requestTooLarge ? "request_too_large" : "upstream_unavailable",
          message: requestTooLarge
            ? "Anthropic proxy request is too large."
            : "Anthropic upstream is unavailable.",
        },
      })
    } else {
      response.destroy()
    }
  })
  response.once("close", () => upstreamRequest.destroy())
  request.once("error", () => upstreamRequest.destroy())

  if (body) {
    upstreamRequest.end(body)
    return
  }

  request.on("data", (chunk) => {
    if (requestTooLarge) {
      return
    }

    received += chunk.length

    if (received > MAX_REQUEST_BYTES) {
      requestTooLarge = true
      upstreamRequest.destroy()
      return
    }

    upstreamRequest.write(chunk)
  })
  request.once("end", () => {
    if (!requestTooLarge) {
      upstreamRequest.end()
    }
  })
}

export async function createAnthropicCompatProxy({
  authToken,
  clientToken,
  host = DEFAULT_HOST,
  resolveUpstreamTarget = resolveSafeOutboundTarget,
  upstreamBaseUrl,
} = {}) {
  if (typeof authToken !== "string" || !authToken.trim()) {
    throw new Error("Anthropic auth token is required.")
  }

  if (typeof clientToken !== "string" || !clientToken.trim()) {
    throw new Error("Model API proxy client token is required.")
  }

  if (typeof upstreamBaseUrl !== "string" || !upstreamBaseUrl.trim()) {
    throw new Error("Anthropic upstream URL is required.")
  }

  const normalizedBaseUrl = normalizeUpstreamBaseUrl(upstreamBaseUrl)
  const upstreamTarget = await resolveUpstreamTarget(normalizedBaseUrl)
  const baseUrl = upstreamTarget.url
  const upstreamLookup = createPinnedOutboundLookup(upstreamTarget)
  const activeRequests = new Set()
  const sockets = new Set()
  const server = http.createServer((request, response) => {
    if (!isAuthorized(request, clientToken)) {
      request.resume()
      writeJson(response, 401, {
        error: {
          type: "unauthorized",
          message: "Model API proxy authorization is required.",
        },
      })
      return
    }

    const requestUrl = new URL(
      request.url || "/",
      "http://anthropic-compat-proxy"
    )

    if (
      request.method === "POST" &&
      TOKEN_COUNT_PATH.test(requestUrl.pathname)
    ) {
      void readBoundedBody(request)
        .then((body) => {
          writeJson(response, 200, {
            input_tokens: estimateInputTokens(body),
          })
        })
        .catch((error) => {
          writeJson(response, error?.code === "REQUEST_TOO_LARGE" ? 413 : 400, {
            error: {
              type:
                error?.code === "REQUEST_TOO_LARGE"
                  ? "request_too_large"
                  : "invalid_request",
              message: "Unable to count Anthropic input tokens.",
            },
          })
        })
      return
    }

    if (request.method === "POST" && MESSAGES_PATH.test(requestUrl.pathname)) {
      void readBoundedBody(request)
        .then((body) => {
          const compatible = createMessagesCompatibilityRequest(
            request.headers,
            body
          )

          forwardRequest({
            activeRequests,
            authToken,
            baseUrl,
            body: compatible.body,
            headers: compatible.headers,
            lookup: upstreamLookup,
            request,
            response,
          })
        })
        .catch((error) => {
          writeJson(response, error?.code === "REQUEST_TOO_LARGE" ? 413 : 400, {
            error: {
              type:
                error?.code === "REQUEST_TOO_LARGE"
                  ? "request_too_large"
                  : "invalid_request",
              message: "Unable to proxy the Anthropic Messages request.",
            },
          })
        })
      return
    }

    forwardRequest({
      activeRequests,
      authToken,
      baseUrl,
      lookup: upstreamLookup,
      request,
      response,
    })
  })

  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n")
  })

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
    server.listen(0, host)
  })

  server.unref()
  const address = server.address()

  if (!address || typeof address === "string") {
    server.close()
    throw new Error("Anthropic compatibility proxy did not bind a TCP port.")
  }

  let closePromise = null

  return {
    baseUrl: `http://${host}:${address.port}`,
    close() {
      if (closePromise) {
        return closePromise
      }

      closePromise = new Promise((resolve) => {
        server.close(resolve)

        for (const request of activeRequests) {
          request.destroy()
        }

        for (const socket of sockets) {
          socket.destroy()
        }
      })
      return closePromise
    },
  }
}
