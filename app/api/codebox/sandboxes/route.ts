import { NextResponse } from "next/server"
import { z } from "zod"

import {
  createCodeBoxSandbox,
  listCodeBoxSandboxes,
} from "@/lib/codebox-runtime"

export const runtime = "nodejs"

const stateSchema = z.enum(["all", "running", "paused"]).default("all")
const createSandboxSchema = z.object({
  name: z
    .string()
    .trim()
    .max(64)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  repoUrl: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
})

function toErrorResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      message:
        error instanceof Error ? error.message : "Sandbox request failed.",
    },
    { status: error instanceof Error ? 400 : 500 }
  )
}

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const state = stateSchema.parse(params.get("state") ?? "all")

    return NextResponse.json({
      ok: true,
      data: await listCodeBoxSandboxes({ state }),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createSandboxSchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        data: await createCodeBoxSandbox(parsed.data),
      },
      { status: 201 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
