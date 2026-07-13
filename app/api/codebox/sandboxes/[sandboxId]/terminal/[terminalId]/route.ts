import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { closeCodeBoxWorkspaceGatewayTerminal } from "@/lib/codebox-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type TerminalRouteContext = {
  params: Promise<{ sandboxId: string; terminalId: string }>
}

function terminalErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : ""

  if (message === "Sandbox was not found.") {
    return NextResponse.json(
      { ok: false, message: "Sandbox was not found." },
      { status: 404 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Failed to close remote terminal." },
    { status: 502 }
  )
}

export async function DELETE(request: Request, context: TerminalRouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sandboxId, terminalId } = await context.params

  try {
    await closeCodeBoxWorkspaceGatewayTerminal({
      sandboxId: decodeURIComponent(sandboxId),
      terminalId: decodeURIComponent(terminalId),
    })

    return NextResponse.json({ ok: true, data: { terminalId } })
  } catch (error) {
    return terminalErrorResponse(error)
  }
}
