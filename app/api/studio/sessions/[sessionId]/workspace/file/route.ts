import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  ensureStudioRemoteWorkspace,
  fetchStudioRemoteWorkspaceGateway,
  getStudioRemoteWorkspaceErrorStatus,
  StudioWorkspaceTypeMismatchError,
  toStudioRemoteRelativePath,
} from "@/lib/studio-remote-workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ sessionId: string }>
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

async function proxyFile(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const requestedPath = new URL(request.url).searchParams.get("path")

  if (!requestedPath) {
    return NextResponse.json(
      { ok: false, message: "Query parameter path is required." },
      { status: 400 }
    )
  }

  try {
    const { sessionId } = await context.params
    const normalizedSessionId = decodeURIComponent(sessionId)
    const workspace = await ensureStudioRemoteWorkspace(normalizedSessionId)
    const search = new URLSearchParams({
      path: toStudioRemoteRelativePath(
        requestedPath,
        workspace.workspacePath,
        workspace.gatewayPath
      ),
    })
    const headers = new Headers()
    const range = request.headers.get("range")

    if (range) {
      headers.set("range", range)
    }

    const upstream = await fetchStudioRemoteWorkspaceGateway({
      sessionId: normalizedSessionId,
      workspace,
      path: `/v1/fs/file?${search}`,
      init: { method: request.method, headers },
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
    return NextResponse.json(
      {
        ok: false,
        code:
          error instanceof StudioWorkspaceTypeMismatchError
            ? error.code
            : undefined,
        message:
          error instanceof Error
            ? error.message
            : "Remote workspace is unavailable.",
      },
      { status: getStudioRemoteWorkspaceErrorStatus(error) }
    )
  }
}

export const GET = proxyFile
export const HEAD = proxyFile
