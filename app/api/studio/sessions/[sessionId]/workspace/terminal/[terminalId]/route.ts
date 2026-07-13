import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  closeStudioRemoteTerminal,
  getStudioRemoteWorkspaceErrorStatus,
  StudioWorkspaceTypeMismatchError,
} from "@/lib/studio-remote-workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ sessionId: string; terminalId: string }>
}

export async function DELETE(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const { sessionId, terminalId } = await context.params

    await closeStudioRemoteTerminal({
      sessionId: decodeURIComponent(sessionId),
      terminalId: decodeURIComponent(terminalId),
    })

    return NextResponse.json({ ok: true })
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
            : "Failed to close remote terminal.",
      },
      { status: getStudioRemoteWorkspaceErrorStatus(error) }
    )
  }
}
