import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { createCodeBoxWorkspaceGatewayTerminal } from "@/lib/codebox-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type SandboxRouteContext = {
  params: Promise<{ sandboxId: string }>
}

const terminalCreateSchema = z.object({
  cols: z.number().int().min(20).max(400).optional(),
  rows: z.number().int().min(6).max(160).optional(),
  cwd: z.string().trim().optional(),
})

function terminalErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : ""

  if (message === "Sandbox was not found.") {
    return NextResponse.json(
      { ok: false, message: "Sandbox was not found." },
      { status: 404 }
    )
  }

  if (message.includes("does not include AstraFlow Workspace Gateway")) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "Sandbox template does not include the CompShare Workspace Gateway.",
      },
      { status: 409 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Failed to start remote terminal." },
    { status: 502 }
  )
}

export async function POST(request: Request, context: SandboxRouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sandboxId } = await context.params

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = terminalCreateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: await createCodeBoxWorkspaceGatewayTerminal({
        sandboxId: decodeURIComponent(sandboxId),
        cols: parsed.data.cols,
        rows: parsed.data.rows,
        cwd: parsed.data.cwd,
      }),
    })
  } catch (error) {
    return terminalErrorResponse(error)
  }
}
