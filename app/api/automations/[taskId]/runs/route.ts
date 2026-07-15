import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getAutomationTask, listAutomationRuns } from "@/lib/automations"

export const runtime = "nodejs"

type AutomationRunsRouteContext = {
  params: Promise<{ taskId: string }>
}

export async function GET(
  request: Request,
  context: AutomationRunsRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { taskId } = await context.params
  const normalizedId = decodeURIComponent(taskId)
  if (!getAutomationTask(normalizedId)) {
    return NextResponse.json(
      { ok: false, message: "Automation task was not found." },
      { status: 404 }
    )
  }

  const limitParameter = new URL(request.url).searchParams.get("limit")
  const limitValue = limitParameter === null ? 100 : Number(limitParameter)
  const limit = Number.isFinite(limitValue) ? limitValue : 100
  return NextResponse.json({
    ok: true,
    data: listAutomationRuns({ taskId: normalizedId, limit }),
  })
}
