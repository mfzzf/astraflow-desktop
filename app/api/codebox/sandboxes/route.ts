import { NextResponse } from "next/server"
import { z } from "zod"
import { randomUUID } from "node:crypto"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
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
  sandboxSize: z.enum(["2c4g", "8c8g"]).optional(),
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
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const callId = randomUUID()
  const startedAt = Date.now()

  console.info("[codebox-sandbox] list_started", { callId })

  try {
    const params = new URL(request.url).searchParams
    const state = stateSchema.parse(params.get("state") ?? "all")

    const sandboxes = await listCodeBoxSandboxes({ state })
    console.info("[codebox-sandbox] list_completed", {
      callId,
      state,
      count: sandboxes.length,
      elapsedMs: Date.now() - startedAt,
    })

    return NextResponse.json({
      ok: true,
      data: sandboxes,
    })
  } catch (error) {
    console.error("[codebox-sandbox] list_failed", {
      callId,
      elapsedMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      error: error instanceof Error ? error.message : String(error),
    })
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const callId = randomUUID()
  const startedAt = Date.now()

  console.info("[codebox-sandbox] create_started", { callId })

  try {
    const parsed = createSandboxSchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const sandbox = await createCodeBoxSandbox(parsed.data)
    console.info("[codebox-sandbox] create_completed", {
      callId,
      sandboxId: sandbox.sandboxId,
      elapsedMs: Date.now() - startedAt,
    })

    return NextResponse.json(
      {
        ok: true,
        data: sandbox,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error("[codebox-sandbox] create_failed", {
      callId,
      elapsedMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      error: error instanceof Error ? error.message : String(error),
    })
    return toErrorResponse(error)
  }
}
