import { NextResponse } from "next/server"
import { Agent, fetch as undiciFetch } from "undici"

import { resolveAgentProviderProxyCredential } from "@/lib/agent/provider-proxy"
import {
  createPinnedLookupForSafeWebFetch,
  resolveSafeWebFetchTarget,
} from "@/lib/network/safe-web-fetch"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_PROVIDER_REQUEST_BYTES = 32 * 1024 * 1024
const REQUEST_HEADER_ALLOWLIST = [
  "accept",
  "anthropic-beta",
  "anthropic-version",
  "content-type",
  "openai-organization",
  "openai-project",
  "user-agent",
] as const

type RouteContext = {
  params: Promise<{ token: string; path: string[] }>
}

function presentedProxyToken(request: Request, routeToken: string) {
  if (routeToken !== "credential") {
    return null
  }

  const authorization = request.headers.get("authorization")?.trim() ?? ""
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization)?.[1]
  const apiKey = request.headers.get("x-api-key")?.trim() ?? ""
  const headerToken = /^[A-Za-z0-9_-]{43}$/.test(apiKey) ? apiKey : null

  if (bearer && headerToken && bearer !== headerToken) {
    return null
  }

  return bearer ?? headerToken
}

function createTargetUrl(
  baseUrl: string,
  pathSegments: string[],
  requestUrl: string
) {
  const target = new URL(baseUrl)
  const suffix = pathSegments.map(encodeURIComponent).join("/")
  const basePath = target.pathname.replace(/\/+$/, "")

  target.pathname = `${basePath}/${suffix}`
  target.search = new URL(requestUrl).search
  return target
}

async function proxyProviderRequest(
  request: Request,
  context: RouteContext
) {
  const params = await context.params
  const presentedToken = presentedProxyToken(request, params.token)
  const credential = presentedToken
    ? resolveAgentProviderProxyCredential(presentedToken)
    : null

  if (!credential) {
    return NextResponse.json(
      { ok: false, error: "Provider proxy credential is invalid or expired." },
      { status: 401 }
    )
  }

  if (!["GET", "POST"].includes(request.method)) {
    return NextResponse.json(
      { ok: false, error: "Provider proxy method is not allowed." },
      { status: 405 }
    )
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0")

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_REQUEST_BYTES
  ) {
    return NextResponse.json(
      { ok: false, error: "Provider request is too large." },
      { status: 413 }
    )
  }

  const body =
    request.method === "POST"
      ? Buffer.from(await request.arrayBuffer())
      : undefined

  if (body && body.byteLength > MAX_PROVIDER_REQUEST_BYTES) {
    return NextResponse.json(
      { ok: false, error: "Provider request is too large." },
      { status: 413 }
    )
  }

  const headers = new Headers()

  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = request.headers.get(name)

    if (value) {
      headers.set(name, value)
    }
  }

  if (credential.authMode === "x-api-key") {
    headers.set("x-api-key", credential.apiKey)
    headers.delete("authorization")
  } else {
    headers.set("authorization", `Bearer ${credential.apiKey}`)
    headers.delete("x-api-key")
  }

  let dispatcher: Agent | null = null

  try {
    const target = await resolveSafeWebFetchTarget(
      createTargetUrl(credential.baseUrl, params.path, request.url)
    )
    dispatcher = new Agent({
      connections: 1,
      connect: {
        lookup: createPinnedLookupForSafeWebFetch(target),
      },
      pipelining: 1,
    })
    const upstream = await (
      globalThis.fetch as unknown as typeof undiciFetch
    )(
      target.url,
      {
        dispatcher,
        method: request.method,
        headers,
        body,
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(5 * 60 * 1000),
        ]),
      }
    )

    if (upstream.status >= 300 && upstream.status < 400) {
      await upstream.body?.cancel().catch(() => undefined)
      await dispatcher.close().catch(() => undefined)
      dispatcher = null
      return NextResponse.json(
        { ok: false, error: "Provider redirects are not allowed." },
        { status: 502 }
      )
    }

    const responseHeaders = new Headers({
      "Cache-Control": "private, no-store",
    })

    for (const [name, value] of upstream.headers) {
      const normalized = name.toLowerCase()

      if (
        normalized === "content-type" ||
        normalized === "retry-after" ||
        normalized === "request-id" ||
        normalized === "x-request-id" ||
        normalized.startsWith("x-ratelimit-") ||
        normalized.startsWith("anthropic-ratelimit-")
      ) {
        responseHeaders.set(name, value)
      }
    }

    const upstreamBody = upstream.body
    const responseBody = upstreamBody
      ? (() => {
          const reader = upstreamBody.getReader()

          return new ReadableStream<Uint8Array>({
            async cancel(reason) {
              try {
                await reader.cancel(reason)
              } finally {
                await dispatcher?.close().catch(() => undefined)
                dispatcher = null
              }
            },
            async pull(controller) {
              try {
                const result = await reader.read()

                if (result.done) {
                  controller.close()
                  await dispatcher?.close().catch(() => undefined)
                  dispatcher = null
                } else {
                  controller.enqueue(result.value)
                }
              } catch (error) {
                controller.error(error)
                await dispatcher?.close().catch(() => undefined)
                dispatcher = null
              }
            },
          })
        })()
      : null

    if (!responseBody) {
      await dispatcher.close().catch(() => undefined)
      dispatcher = null
    }

    return new Response(responseBody, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch {
    await dispatcher?.close().catch(() => undefined)
    return NextResponse.json(
      { ok: false, error: "The Agent provider request failed." },
      { status: 502 }
    )
  }
}

export async function GET(request: Request, context: RouteContext) {
  return proxyProviderRequest(request, context)
}

export async function POST(request: Request, context: RouteContext) {
  return proxyProviderRequest(request, context)
}
