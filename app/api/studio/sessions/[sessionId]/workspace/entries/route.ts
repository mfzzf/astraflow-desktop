import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  fetchStudioRemoteWorkspaceGateway,
  toStudioRemoteAbsolutePath,
  toStudioRemoteRelativePath,
} from "@/lib/studio-remote-workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

type GatewayEntry = {
  name: string
  path: string
  kind: "directory" | "file"
  extension: string
  size: number | null
  modifiedAt: number
}

type GatewayListing = {
  path: string
  name: string
  parent: string | null
  entries: GatewayEntry[]
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const { sessionId } = await context.params
    const requestedPath = new URL(request.url).searchParams.get("path")
    const search = new URLSearchParams({
      path: toStudioRemoteRelativePath(requestedPath),
    })
    const upstream = await fetchStudioRemoteWorkspaceGateway({
      sessionId: decodeURIComponent(sessionId),
      path: `/v1/fs/entries?${search}`,
    })
    const payload = (await upstream.json()) as {
      ok?: boolean
      data?: GatewayListing
      error?: { code?: string; message?: string }
    }

    if (!upstream.ok || !payload.ok || !payload.data) {
      return NextResponse.json(payload, { status: upstream.status })
    }

    return NextResponse.json({
      ok: true,
      data: {
        cwd: toStudioRemoteAbsolutePath(payload.data.path),
        name: payload.data.name,
        parent:
          payload.data.parent === null
            ? null
            : toStudioRemoteAbsolutePath(payload.data.parent),
        entries: payload.data.entries.map((entry) => ({
          ...entry,
          path: toStudioRemoteAbsolutePath(entry.path),
        })),
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Remote workspace is unavailable.",
      },
      { status: 502 }
    )
  }
}
