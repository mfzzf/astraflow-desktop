import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  getStudioWorkspaceGatewayErrorStatus,
  reconnectStudioWorkspaceTerminal,
  requireStudioSandboxWorkspace,
} from "@/lib/studio-workspace-gateway"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ workspaceId: string; terminalId: string }>
}

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const { workspaceId, terminalId } = await context.params
    const workspace = requireStudioSandboxWorkspace(
      decodeURIComponent(workspaceId)
    )

    return NextResponse.json({
      ok: true,
      data: await reconnectStudioWorkspaceTerminal({
        workspace,
        terminalId: decodeURIComponent(terminalId),
      }),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to reconnect Sandbox terminal.",
      },
      { status: getStudioWorkspaceGatewayErrorStatus(error) }
    )
  }
}
