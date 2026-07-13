import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { fetchCodeBoxWorkspaceGateway } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

type GatewayFileRouteContext = {
  params: Promise<{ sandboxId: string }>
}

const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const

function gatewayErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : ""

  if (message === "Sandbox was not found.") {
    return NextResponse.json(
      { ok: false, message: "Sandbox was not found." },
      { status: 404 }
    )
  }

  if (message.includes("does not include AstraFlow Workspace Gateway")) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Sandbox template does not include AstraFlow Workspace Gateway.",
      },
      { status: 409 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Workspace Gateway is unavailable." },
    { status: 502 }
  )
}

async function proxyFileRequest(
  request: Request,
  context: GatewayFileRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const requestedPath = new URL(request.url).searchParams.get("path")

  if (requestedPath === null) {
    return NextResponse.json(
      { ok: false, message: "Query parameter path is required." },
      { status: 400 }
    )
  }

  const { sandboxId } = await context.params
  const upstreamHeaders = new Headers()
  const range = request.headers.get("range")

  if (range) {
    upstreamHeaders.set("range", range)
  }

  try {
    const search = new URLSearchParams({ path: requestedPath })
    const upstream = await fetchCodeBoxWorkspaceGateway({
      sandboxId: decodeURIComponent(sandboxId),
      path: `/v1/fs/file?${search}`,
      init: {
        method: request.method,
        headers: upstreamHeaders,
      },
    })
    const responseHeaders = new Headers()

    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)

      if (value !== null) {
        responseHeaders.set(name, value)
      }
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    return gatewayErrorResponse(error)
  }
}

export const GET = proxyFileRequest
export const HEAD = proxyFileRequest
