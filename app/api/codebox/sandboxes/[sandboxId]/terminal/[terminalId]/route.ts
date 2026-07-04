import { NextResponse } from "next/server"
import { z } from "zod"

import {
  closeCodeBoxTerminalSession,
  resizeCodeBoxTerminal,
  writeCodeBoxTerminalInput,
} from "@/lib/codebox-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type TerminalRouteContext = {
  params: Promise<{ sandboxId: string; terminalId: string }>
}

const terminalCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("input"),
    data: z.string(),
  }),
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().min(20).max(400),
    rows: z.number().int().min(6).max(160),
  }),
])

export async function POST(request: Request, context: TerminalRouteContext) {
  const { sandboxId, terminalId } = await context.params
  const routeParams = {
    sandboxId: decodeURIComponent(sandboxId),
    terminalId: decodeURIComponent(terminalId),
  }

  try {
    const parsed = terminalCommandSchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    if (parsed.data.type === "input") {
      await writeCodeBoxTerminalInput({
        ...routeParams,
        data: parsed.data.data,
      })
    } else {
      await resizeCodeBoxTerminal({
        ...routeParams,
        cols: parsed.data.cols,
        rows: parsed.data.rows,
      })
    }

    return NextResponse.json({ ok: true, data: { terminalId } })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to update terminal.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}

export async function DELETE(_request: Request, context: TerminalRouteContext) {
  const { sandboxId, terminalId } = await context.params

  try {
    await closeCodeBoxTerminalSession({
      sandboxId: decodeURIComponent(sandboxId),
      terminalId: decodeURIComponent(terminalId),
    })

    return NextResponse.json({ ok: true, data: { terminalId } })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to close terminal.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}
