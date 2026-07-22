import { NextResponse } from "next/server"

import { getAppAuthState } from "@/lib/app-auth"
import {
  SELECTABLE_AGENT_RUNTIME_IDS,
  isSelectableAgentRuntimeId,
} from "@/lib/agent-model-settings-shared"
import { listAgentRuntimeInfos } from "@/lib/agent/runtime"
import "@/lib/studio-chat-runner"

export const runtime = "nodejs"

async function requireAuthenticatedRequest() {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  return null
}

function selectableRuntimeOrder(runtimeId: string) {
  const index = SELECTABLE_AGENT_RUNTIME_IDS.findIndex(
    (selectableRuntimeId) => selectableRuntimeId === runtimeId
  )

  return index >= 0 ? index : SELECTABLE_AGENT_RUNTIME_IDS.length
}

export async function GET() {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  return NextResponse.json({
    ok: true,
    data: listAgentRuntimeInfos()
      .filter((runtime) => isSelectableAgentRuntimeId(runtime.id))
      .sort(
        (left, right) =>
          selectableRuntimeOrder(left.id) - selectableRuntimeOrder(right.id)
      ),
  })
}
