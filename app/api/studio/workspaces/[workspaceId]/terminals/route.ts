import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  createStudioWorkspaceTerminal,
  getStudioWorkspaceGatewayErrorStatus,
  requireStudioSandboxWorkspace,
} from "@/lib/studio-workspace-gateway"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ workspaceId: string }>
}

const terminalSchema = z.object({
  cwd: z.string().trim().optional(),
  cols: z.number().int().min(20).max(400).optional(),
  rows: z.number().int().min(6).max(160).optional(),
})

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = terminalSchema.safeParse(
    await request.json().catch(() => ({}))
  )

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  try {
    const { workspaceId } = await context.params
    const workspace = requireStudioSandboxWorkspace(
      decodeURIComponent(workspaceId)
    )

    return NextResponse.json({
      ok: true,
      data: await createStudioWorkspaceTerminal({
        workspace,
        ...parsed.data,
      }),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to start Sandbox terminal.",
      },
      { status: getStudioWorkspaceGatewayErrorStatus(error) }
    )
  }
}
