import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  ensureStudioRemoteWorkspace,
  fetchStudioRemoteWorkspaceGateway,
  getStudioRemoteWorkspaceErrorStatus,
  StudioWorkspaceTypeMismatchError,
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
    const normalizedSessionId = decodeURIComponent(sessionId)
    const workspace = await ensureStudioRemoteWorkspace(normalizedSessionId)
    const requestedPath = new URL(request.url).searchParams.get("path")
    const search = new URLSearchParams({
      path: toStudioRemoteRelativePath(
        requestedPath,
        workspace.workspacePath,
        workspace.gatewayPath
      ),
    })
    const upstream = await fetchStudioRemoteWorkspaceGateway({
      sessionId: normalizedSessionId,
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

    const cwd = toStudioRemoteAbsolutePath(
      payload.data.path,
      workspace.gatewayPath
    )
    toStudioRemoteRelativePath(
      cwd,
      workspace.workspacePath,
      workspace.gatewayPath
    )
    const parent =
      cwd === workspace.workspacePath || payload.data.parent === null
        ? null
        : toStudioRemoteAbsolutePath(
            payload.data.parent,
            workspace.gatewayPath
          )

    if (parent) {
      toStudioRemoteRelativePath(
        parent,
        workspace.workspacePath,
        workspace.gatewayPath
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        cwd,
        name: payload.data.name,
        parent,
        entries: payload.data.entries.map((entry) => {
          const entryPath = toStudioRemoteAbsolutePath(
            entry.path,
            workspace.gatewayPath
          )
          toStudioRemoteRelativePath(
            entryPath,
            workspace.workspacePath,
            workspace.gatewayPath
          )

          return { ...entry, path: entryPath }
        }),
      },
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
