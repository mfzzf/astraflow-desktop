import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  enqueueAutomationRunNow,
  ensureAutomationRuntimeStarted,
  requestAutomationSchedulerTick,
} from "@/lib/automations"

export const runtime = "nodejs"

type AutomationRunRouteContext = {
  params: Promise<{ taskId: string }>
}

export async function POST(
  request: Request,
  context: AutomationRunRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { taskId } = await context.params

  try {
    const run = enqueueAutomationRunNow(decodeURIComponent(taskId))
    ensureAutomationRuntimeStarted()
    void requestAutomationSchedulerTick()
    return NextResponse.json({ ok: true, data: run }, { status: 202 })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Failed to run task.",
      },
      { status: 409 }
    )
  }
}
