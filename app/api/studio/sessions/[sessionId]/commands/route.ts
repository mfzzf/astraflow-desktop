import { NextResponse } from "next/server"

import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import { getAstraFlowPiRuntimeCommands } from "@/lib/agent/pi-packages"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  getStudioSession,
  getStudioSessionAvailableCommands,
} from "@/lib/studio-db"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

function mergeCommands(
  commands: SlashCommandDescriptor[]
): SlashCommandDescriptor[] {
  const seen = new Set<string>()
  const merged: SlashCommandDescriptor[] = []

  for (const command of commands) {
    const name = command.name.trim().replace(/^\/+/, "")
    const key = name.toLowerCase()

    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push({ ...command, name })
  }

  return merged
}

export async function GET(_request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params

  const session = getStudioSession(sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  const runtimeId = session.chatRuntimeId || "astraflow"
  const announcedCommands = getStudioSessionAvailableCommands(sessionId).filter(
    (command) => !command.runtimeId || command.runtimeId === runtimeId
  )
  const staticCommands =
    runtimeId === "astraflow" ? getAstraFlowPiRuntimeCommands() : []

  return NextResponse.json({
    commands: mergeCommands([...staticCommands, ...announcedCommands]),
  })
}
