import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { stopWorkspaceGatewayService } from "@/lib/codebox-runtime"
import {
  ensureStudioRemoteWorkspace,
  getStudioRemoteWorkspaceErrorStatus,
} from "@/lib/studio-remote-workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ sessionId: string; serviceId: string }>
}

const serviceIdSchema = z.string().uuid()

export async function DELETE(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const params = await context.params
  const parsedServiceId = serviceIdSchema.safeParse(
    decodeURIComponent(params.serviceId)
  )

  if (!parsedServiceId.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid workspace service ID." },
      { status: 400 }
    )
  }

  try {
    const sessionId = decodeURIComponent(params.sessionId)
    const workspace = await ensureStudioRemoteWorkspace(
      sessionId
    )
    const service = await stopWorkspaceGatewayService({
      sandboxId: workspace.sandboxId,
      workspacePath: workspace.workspacePath,
      serviceId: parsedServiceId.data,
      ownerSessionId: sessionId,
    })

    return NextResponse.json({ ok: true, data: { service } })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Workspace service could not be stopped.",
      },
      { status: getStudioRemoteWorkspaceErrorStatus(error) }
    )
  }
}
