import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  closeStudioWorkspaceTerminal,
  getStudioWorkspaceGatewayErrorStatus,
  requireStudioSandboxWorkspace,
} from "@/lib/studio-workspace-gateway"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ workspaceId: string; terminalId: string }>
}

export async function DELETE(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const { workspaceId, terminalId } = await context.params
    const workspace = requireStudioSandboxWorkspace(
      decodeURIComponent(workspaceId)
    )

    await closeStudioWorkspaceTerminal({
      workspace,
      terminalId: decodeURIComponent(terminalId),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to close Sandbox terminal.",
      },
      { status: getStudioWorkspaceGatewayErrorStatus(error) }
    )
  }
}
