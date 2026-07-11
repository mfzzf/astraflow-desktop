import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { startMobileChannelPairing } from "@/lib/mobile-channels/pairing"
import {
  mobileChannelProviderSchema,
  startMobileChannelPairingSchema,
} from "@/lib/schemas/mobile-channels"
import { getStudioLocalProject } from "@/lib/studio-db"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ provider: string }> }

export async function POST(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) {
    return authError
  }

  const { provider: rawProvider } = await context.params
  const provider = mobileChannelProviderSchema.safeParse(rawProvider)
  const body = startMobileChannelPairingSchema.safeParse(await request.json())

  if (!provider.success || !body.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid mobile pairing request." },
      { status: 400 }
    )
  }

  if (
    body.data.defaultProjectId &&
    !getStudioLocalProject(body.data.defaultProjectId)
  ) {
    return NextResponse.json(
      { ok: false, error: "Local project not found." },
      { status: 404 }
    )
  }

  const pairing = await startMobileChannelPairing({
    provider: provider.data,
    defaultProjectId: body.data.defaultProjectId,
    telegramBotToken: body.data.telegramBotToken,
    discordApplicationId: body.data.discordApplicationId,
    discordBotToken: body.data.discordBotToken,
  })

  return NextResponse.json(
    { ok: pairing?.status !== "error", data: pairing },
    { status: pairing?.status === "error" ? 502 : 201 }
  )
}
