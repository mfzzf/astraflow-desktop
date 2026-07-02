import { NextResponse } from "next/server"

import { deleteCodeBoxVolume } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

type VolumeRouteContext = {
  params: Promise<{ volumeId: string }>
}

export async function DELETE(_request: Request, context: VolumeRouteContext) {
  const { volumeId } = await context.params

  try {
    const deleted = await deleteCodeBoxVolume(decodeURIComponent(volumeId))

    if (!deleted) {
      return NextResponse.json(
        { ok: false, message: "Volume was not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true, data: { volumeId } })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to delete volume.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}
