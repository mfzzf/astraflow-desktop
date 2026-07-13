import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  EMPTY_STUDIO_WORKSPACE_GIT_REVIEW,
  isStudioWorkspaceGitReviewUnsupported,
} from "@/lib/studio-workspace-git-review"
import {
  fetchStudioWorkspaceGateway,
  getStudioWorkspaceGatewayErrorStatus,
  requireStudioSandboxWorkspace,
  toStudioWorkspaceGatewayRelativePath,
} from "@/lib/studio-workspace-gateway"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ workspaceId: string }>
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
    const search = new URLSearchParams({
      path: toStudioWorkspaceGatewayRelativePath(
        workspace,
        workspace.workspacePath
      ),
    })
    const upstream = await fetchStudioWorkspaceGateway({
      workspace,
      path: `/v1/git/review?${search}`,
    })
    const payload = await upstream.json().catch(() => null)

    if (isStudioWorkspaceGitReviewUnsupported(upstream.status, payload)) {
      return NextResponse.json({
        ok: true,
        data: EMPTY_STUDIO_WORKSPACE_GIT_REVIEW,
      })
    }

    return NextResponse.json(
      payload ?? {
        ok: false,
        error: { message: "Sandbox Git review returned an invalid response." },
      },
      { status: upstream.status }
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          message:
            error instanceof Error
              ? error.message
              : "Sandbox Git review is unavailable.",
        },
      },
      { status: getStudioWorkspaceGatewayErrorStatus(error) }
    )
  }
}
