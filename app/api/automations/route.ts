import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  createAutomationTask,
  ensureAutomationRuntimeStarted,
  listAutomationTasks,
  requestAutomationSchedulerTick,
} from "@/lib/automations"

export const runtime = "nodejs"

function errorResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      message:
        error instanceof Error ? error.message : "Automation request failed.",
    },
    { status: 400 }
  )
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  ensureAutomationRuntimeStarted()
  const tasks = listAutomationTasks()
  return NextResponse.json({
    ok: true,
    data: {
      tasks,
      activeCount: tasks.filter((task) => task.enabled).length,
      totalCount: tasks.length,
    },
  })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  try {
    const task = createAutomationTask(await request.json())
    ensureAutomationRuntimeStarted()
    void requestAutomationSchedulerTick()
    return NextResponse.json({ ok: true, data: task }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
