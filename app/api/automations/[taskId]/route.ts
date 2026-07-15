import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  deleteAutomationTask,
  getAutomationTask,
  hasActiveAutomationRuns,
  requestAutomationSchedulerTick,
  setAutomationTaskEnabled,
  updateAutomationTask,
} from "@/lib/automations"

export const runtime = "nodejs"

type AutomationTaskRouteContext = {
  params: Promise<{ taskId: string }>
}

function notFound() {
  return NextResponse.json(
    { ok: false, message: "Automation task was not found." },
    { status: 404 }
  )
}

export async function GET(
  request: Request,
  context: AutomationTaskRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { taskId } = await context.params
  const task = getAutomationTask(decodeURIComponent(taskId))
  return task ? NextResponse.json({ ok: true, data: task }) : notFound()
}

export async function PATCH(
  request: Request,
  context: AutomationTaskRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { taskId } = await context.params
  const normalizedId = decodeURIComponent(taskId)
  const existing = getAutomationTask(normalizedId)
  if (!existing) {
    return notFound()
  }

  try {
    const body = (await request.json()) as unknown
    const enabled =
      typeof body === "object" &&
      body !== null &&
      Object.keys(body).length === 1 &&
      "enabled" in body &&
      typeof body.enabled === "boolean"
        ? body.enabled
        : null
    const task =
      enabled !== null
        ? setAutomationTaskEnabled(normalizedId, enabled)
        : updateAutomationTask(normalizedId, body)
    void requestAutomationSchedulerTick()
    return NextResponse.json({ ok: true, data: task })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to update task.",
      },
      { status: 400 }
    )
  }
}

export async function DELETE(
  request: Request,
  context: AutomationTaskRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { taskId } = await context.params
  const normalizedId = decodeURIComponent(taskId)
  if (!getAutomationTask(normalizedId)) {
    return notFound()
  }
  if (hasActiveAutomationRuns(normalizedId)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Cancel or finish active runs before deleting this task.",
      },
      { status: 409 }
    )
  }

  if (!deleteAutomationTask(normalizedId)) {
    return NextResponse.json(
      {
        ok: false,
        message: "Cancel or finish active runs before deleting this task.",
      },
      { status: 409 }
    )
  }
  return NextResponse.json({ ok: true, data: { id: normalizedId } })
}
