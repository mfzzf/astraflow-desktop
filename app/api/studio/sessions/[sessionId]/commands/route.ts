import { NextResponse } from "next/server"

import { activatePreparedAcpSession } from "@/lib/agent/acp/acp-runtime"
import {
  getStaticAcpRuntimeCommands,
  materializeAcpRuntimeCommands,
  mergeAcpRuntimeCommands,
} from "@/lib/agent/acp/runtime-commands"
import { getAstraFlowPiRuntimeCommands } from "@/lib/agent/pi-packages"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { prepareStudioAcpRuntime } from "@/lib/studio-chat-runner"
import {
  getStudioSession,
  getStudioSessionAvailableCommands,
} from "@/lib/studio-db"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
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
  let announcedCommands = getStudioSessionAvailableCommands(sessionId).filter(
    (command) => !command.runtimeId || command.runtimeId === runtimeId
  )

  // ACP commands are session-scoped and may include provider skills, custom
  // agents, plugins, or commands discovered from the active workspace. Create
  // the provider session on first command discovery so the composer does not
  // hide the real command set until after the first ordinary prompt. This path
  // is shared by local and Sandbox WebSocket runtimes.
  announcedCommands = await materializeAcpRuntimeCommands({
    announcedCommands,
    runtimeId,
    sessionId,
    prepare: () => prepareStudioAcpRuntime(sessionId, runtimeId),
    activate: () => activatePreparedAcpSession(sessionId, runtimeId),
  })
  const staticCommands =
    runtimeId === "astraflow"
      ? getAstraFlowPiRuntimeCommands()
      : getStaticAcpRuntimeCommands(runtimeId)

  return NextResponse.json({
    commands: mergeAcpRuntimeCommands([
      ...announcedCommands,
      ...staticCommands,
    ]),
  })
}
