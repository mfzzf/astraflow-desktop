import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { mergeStudioComposerSkills } from "@/lib/studio-composer-skills"
import {
  getStudioSession,
  getStudioSessionExpert,
  listStudioInstalledSkills,
} from "@/lib/studio-db"
import { listExpertDeclaredSkillsFromSnapshot } from "@/lib/studio-session-skills"

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
      { ok: false, message: "Session not found" },
      { status: 404 }
    )
  }

  const expertSkills = listExpertDeclaredSkillsFromSnapshot(
    getStudioSessionExpert(sessionId)?.snapshot ?? null
  )

  return NextResponse.json({
    ok: true,
    data: mergeStudioComposerSkills({
      expertSkills,
      installedSkills: listStudioInstalledSkills({ enabledOnly: true }),
    }),
  })
}
