import { readFile } from "node:fs/promises"

import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getAutomationRun } from "@/lib/automations"
import { resolveAutomationLogPath } from "@/lib/automations/paths"

export const runtime = "nodejs"

type AutomationLogRouteContext = {
  params: Promise<{ runId: string }>
}

export async function GET(
  request: Request,
  context: AutomationLogRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { runId } = await context.params
  const run = getAutomationRun(decodeURIComponent(runId))
  const logPath = run ? resolveAutomationLogPath(run.logPath) : null

  if (!run || !logPath) {
    return NextResponse.json(
      { ok: false, message: "Automation log was not found." },
      { status: 404 }
    )
  }

  try {
    const contents = await readFile(logPath)
    return new Response(new Uint8Array(contents), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="automation-${run.id}.log"`,
        "Content-Type": "text/plain; charset=utf-8",
      },
    })
  } catch {
    return NextResponse.json(
      { ok: false, message: "Automation log was not found." },
      { status: 404 }
    )
  }
}
