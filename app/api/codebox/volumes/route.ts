import { NextResponse } from "next/server"
import { z } from "zod"

import { createCodeBoxVolume, listCodeBoxVolumes } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

const createVolumeSchema = z.object({
  name: z.string().trim().min(1).max(63),
})

function toErrorResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      message:
        error instanceof Error ? error.message : "Volume request failed.",
    },
    { status: error instanceof Error ? 400 : 500 }
  )
}

export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      data: await listCodeBoxVolumes(),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const parsed = createVolumeSchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.flatten() },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        data: await createCodeBoxVolume(parsed.data.name),
      },
      { status: 201 }
    )
  } catch (error) {
    return toErrorResponse(error)
  }
}
