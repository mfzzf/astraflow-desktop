import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { listWorkspaceGatewayServices } from "@/lib/codebox-runtime"
import {
  ensureStudioRemoteWorkspace,
  getStudioRemoteWorkspaceErrorStatus,
} from "@/lib/studio-remote-workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const { sessionId: encodedSessionId } = await context.params
    const sessionId = decodeURIComponent(encodedSessionId)
    const workspace = await ensureStudioRemoteWorkspace(
      sessionId
    )
    const services = await listWorkspaceGatewayServices({
      sandboxId: workspace.sandboxId,
      workspacePath: workspace.workspacePath,
      ownerSessionId: sessionId,
    })

    return NextResponse.json({ ok: true, data: { services } })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Workspace services could not be listed.",
      },
      { status: getStudioRemoteWorkspaceErrorStatus(error) }
    )
  }
}
