import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getCodeBoxWorkspaceGatewayHealth } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

type GatewayHealthRouteContext = {
  params: Promise<{ sandboxId: string }>
}

function gatewayErrorResponse(error: unknown) {
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
    { ok: false, message: "Workspace Gateway is unavailable." },
    { status: 502 }
  )
}

export async function GET(
  request: Request,
  context: GatewayHealthRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sandboxId } = await context.params

  try {
    return NextResponse.json({
      ok: true,
      data: await getCodeBoxWorkspaceGatewayHealth(
        decodeURIComponent(sandboxId)
      ),
    })
  } catch (error) {
    return gatewayErrorResponse(error)
  }
}
