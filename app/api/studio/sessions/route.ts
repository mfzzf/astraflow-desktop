import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { SUPPORTED_CHAT_REASONING_EFFORTS } from "@/lib/chat-models"
import {
  createStudioSession,
  getStudioLocalProject,
  getStudioWorkspace,
  listStudioSessions,
} from "@/lib/studio-db"
import { getStudioRemoteWorkspaceSummary } from "@/lib/studio-remote-workspace"
import { studioModes, studioPermissionModes } from "@/lib/studio-types"

export const runtime = "nodejs"

const createSessionSchema = z.object({
  mode: z.enum(studioModes).default("chat"),
  title: z.string().trim().max(120).optional(),
  workspaceId: z.string().trim().min(1).nullable().optional(),
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

  return NextResponse.json({
    ok: true,
    data: listStudioSessions().map((session) => {
      const workspace = session.workspaceId
        ? getStudioWorkspace(session.workspaceId)
        : null

      return {
        ...session,
        workspace,
        remoteWorkspace: getStudioRemoteWorkspaceSummary(session.id),
      }
    }),
  })
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

  const workspace = parsed.data.workspaceId
    ? getStudioWorkspace(parsed.data.workspaceId)
    : null

  if (parsed.data.workspaceId && !workspace) {
    return NextResponse.json(
      { ok: false, error: "Workspace not found" },
      { status: 404 }
    )
  }

  if (
    workspace?.type === "local" &&
    parsed.data.projectId &&
    parsed.data.projectId !== workspace.localProjectId
  ) {
    return NextResponse.json(
      { ok: false, error: "Workspace and project do not match" },
      { status: 409 }
    )
  }

  if (workspace?.type === "sandbox" && parsed.data.projectId) {
    return NextResponse.json(
      { ok: false, error: "Sandbox workspaces cannot bind local projects" },
      { status: 409 }
    )
  }

  let session: ReturnType<typeof createStudioSession>

  try {
    session = createStudioSession(parsed.data)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to create session",
      },
      { status: 409 }
    )
  }

  const sessionWorkspace = session.workspaceId
    ? getStudioWorkspace(session.workspaceId)
    : null

  return NextResponse.json(
    {
      ok: true,
      data: {
        ...session,
        workspace: sessionWorkspace,
        remoteWorkspace: getStudioRemoteWorkspaceSummary(session.id),
      },
    },
    { status: 201 }
  )
}
