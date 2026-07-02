import { NextResponse } from "next/server"

import { killCodeBoxSandbox } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

type SandboxRouteContext = {
  params: Promise<{ sandboxId: string }>
}

export async function POST(_request: Request, context: SandboxRouteContext) {
  const { sandboxId } = await context.params

  try {
    const ok = await killCodeBoxSandbox(decodeURIComponent(sandboxId))

    if (!ok) {
      return NextResponse.json(
        { ok: false, message: "Sandbox was not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true, data: { sandboxId } })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to kill sandbox.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}
