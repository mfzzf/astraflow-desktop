import { NextResponse } from "next/server"

import { resumeCodeBoxSandbox } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

type SandboxRouteContext = {
  params: Promise<{ sandboxId: string }>
}

export async function POST(_request: Request, context: SandboxRouteContext) {
  const { sandboxId } = await context.params

  try {
    await resumeCodeBoxSandbox(decodeURIComponent(sandboxId))

    return NextResponse.json({ ok: true, data: { sandboxId } })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to resume sandbox.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}
