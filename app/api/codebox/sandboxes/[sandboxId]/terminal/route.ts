import { NextResponse } from "next/server"
import { z } from "zod"

import { createCodeBoxTerminalSession } from "@/lib/codebox-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type SandboxRouteContext = {
  params: Promise<{ sandboxId: string }>
}

const terminalCreateSchema = z.object({
  cols: z.number().int().min(20).max(400).optional(),
  rows: z.number().int().min(6).max(160).optional(),
  cwd: z.string().trim().optional(),
})

export async function POST(request: Request, context: SandboxRouteContext) {
  const { sandboxId } = await context.params

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = terminalCreateSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: await createCodeBoxTerminalSession({
        sandboxId: decodeURIComponent(sandboxId),
        cols: parsed.data.cols,
        rows: parsed.data.rows,
        cwd: parsed.data.cwd,
      }),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to start terminal.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}
