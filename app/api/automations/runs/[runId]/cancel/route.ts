import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { cancelAutomationRun, getAutomationRun } from "@/lib/automations"

export const runtime = "nodejs"

type AutomationCancelRouteContext = {
  params: Promise<{ runId: string }>
}

export async function POST(
  request: Request,
  context: AutomationCancelRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { runId } = await context.params
  const normalizedId = decodeURIComponent(runId)
  const existing = getAutomationRun(normalizedId)
  if (!existing) {
    return NextResponse.json(
      { ok: false, message: "Automation run was not found." },
      { status: 404 }
    )
  }
  if (!["queued", "running"].includes(existing.status)) {
    return NextResponse.json(
      { ok: false, message: "This automation run has already finished." },
      { status: 409 }
    )
  }

  return NextResponse.json({
    ok: true,
    data: cancelAutomationRun(normalizedId),
  })
}
