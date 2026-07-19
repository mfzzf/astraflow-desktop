import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  fetchStudioWorkspaceGateway,
  getStudioWorkspaceGatewayErrorStatus,
  requireStudioSandboxWorkspace,
  toStudioWorkspaceAbsolutePath,
  toStudioWorkspaceGatewayRelativePath,
} from "@/lib/studio-workspace-gateway"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ workspaceId: string }>
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
    const { workspaceId } = await context.params
    const workspace = requireStudioSandboxWorkspace(
      decodeURIComponent(workspaceId)
    )
    const requestUrl = new URL(request.url)
    const requestedPath = requestUrl.searchParams.get("path")
    const search = new URLSearchParams({
      path: toStudioWorkspaceGatewayRelativePath(workspace, requestedPath),
    })

    if (requestUrl.searchParams.get("includeHidden") === "1") {
      search.set("includeHidden", "1")
    }
    const upstream = await fetchStudioWorkspaceGateway({
      workspace,
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

    let parent: string | null = null

    if (payload.data.parent !== null) {
      try {
        parent = toStudioWorkspaceAbsolutePath(
          workspace,
          payload.data.parent
        )
      } catch {
        // The Gateway root may have a parent outside this Studio workspace.
      }
    }

    return NextResponse.json({
      ok: true,
      data: {
        cwd: toStudioWorkspaceAbsolutePath(workspace, payload.data.path),
        name: payload.data.name,
        parent,
        entries: payload.data.entries.map((entry) => ({
          ...entry,
          path: toStudioWorkspaceAbsolutePath(workspace, entry.path),
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
            : "Sandbox workspace is unavailable.",
      },
      { status: getStudioWorkspaceGatewayErrorStatus(error) }
    )
  }
}
