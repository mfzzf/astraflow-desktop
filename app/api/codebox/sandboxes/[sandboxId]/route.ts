import { NextResponse } from "next/server"
import { z } from "zod"

import { updateCodeBoxSandboxName } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

type SandboxRouteContext = {
  params: Promise<{ sandboxId: string }>
}

const updateSandboxSchema = z.object({
  name: z
    .string()
    .trim()
    .max(64)
    .optional()
    .or(z.literal("").transform(() => undefined)),
})

export async function PATCH(request: Request, context: SandboxRouteContext) {
  const { sandboxId } = await context.params

  try {
    const parsed = updateSandboxSchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const sandbox = await updateCodeBoxSandboxName({
      sandboxId: decodeURIComponent(sandboxId),
      name: parsed.data.name,
    })

    if (!sandbox) {
      return NextResponse.json(
        { ok: false, message: "Sandbox was not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true, data: sandbox })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to update sandbox.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}
