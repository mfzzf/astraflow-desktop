import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { SUPPORTED_CHAT_REASONING_EFFORTS } from "@/lib/chat-models"
import {
  createStudioSession,
  getStudioLocalProject,
  listStudioSessions,
} from "@/lib/studio-db"
import { studioModes, studioPermissionModes } from "@/lib/studio-types"

export const runtime = "nodejs"

const createSessionSchema = z.object({
  mode: z.enum(studioModes).default("chat"),
  title: z.string().trim().max(120).optional(),
  projectId: z.string().trim().min(1).nullable().optional(),
  permissionMode: z.enum(studioPermissionModes).optional(),
  chatModel: z.string().trim().min(1).max(128).nullable().optional(),
  chatRuntimeId: z.string().trim().min(1).max(64).nullable().optional(),
  chatReasoningEffort: z
    .enum(SUPPORTED_CHAT_REASONING_EFFORTS)
    .nullable()
    .optional(),
})

export async function GET() {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  return NextResponse.json({ ok: true, data: listStudioSessions() })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = createSessionSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (parsed.data.projectId && !getStudioLocalProject(parsed.data.projectId)) {
    return NextResponse.json(
      { ok: false, error: "Project not found" },
      { status: 404 }
    )
  }

  const session = createStudioSession(parsed.data)

  return NextResponse.json({ ok: true, data: session }, { status: 201 })
}
