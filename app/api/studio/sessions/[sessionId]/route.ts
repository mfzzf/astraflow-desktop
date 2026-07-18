import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { resetAcpSessionsForStudioSession } from "@/lib/agent/acp/acp-runtime"
import { ensureAcpWorkspace } from "@/lib/agent/acp/workspace"
import { SUPPORTED_CHAT_REASONING_EFFORTS } from "@/lib/chat-models"
import {
  deleteStudioSession,
  getLatestStudioAcpSessionSelection,
  getStudioLocalProject,
  getStudioSession,
  getStudioWorkspace,
  resetStudioSessionProviderResume,
  updateStudioSessionArchived,
  updateStudioSessionChatPreferences,
  updateStudioSessionPermissionMode,
  updateStudioSessionPinned,
  updateStudioSessionProject,
  updateStudioSessionWorkspace,
  updateStudioSessionTitle,
} from "@/lib/studio-db"
import { studioPermissionModes } from "@/lib/studio-types"
import { deleteStudioAcpAgentSession } from "@/lib/studio-chat-runner"
import { getStudioRemoteWorkspaceSummary } from "@/lib/studio-remote-workspace"

export const runtime = "nodejs"

const updateSessionSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    workspaceId: z.string().trim().min(1).nullable().optional(),
    projectId: z.string().trim().min(1).nullable().optional(),
    permissionMode: z.enum(studioPermissionModes).optional(),
    chatModel: z.string().trim().min(1).max(128).nullable().optional(),
    chatRuntimeId: z.string().trim().min(1).max(64).nullable().optional(),
    chatReasoningEffort: z
      .enum(SUPPORTED_CHAT_REASONING_EFFORTS)
      .nullable()
      .optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.workspaceId !== undefined ||
      value.projectId !== undefined ||
      value.permissionMode !== undefined ||
      value.chatModel !== undefined ||
      value.chatRuntimeId !== undefined ||
      value.chatReasoningEffort !== undefined ||
      value.pinned !== undefined ||
      value.archived !== undefined
  )

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

function getAgentWorkspaceRoot(sessionId: string) {
  return (
    getLatestStudioAcpSessionSelection(sessionId)?.cwd ??
    ensureAcpWorkspace(sessionId)
  )
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

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

  return NextResponse.json({
    ok: true,
    data: {
      ...session,
      workspace: session.workspaceId
        ? getStudioWorkspace(session.workspaceId)
        : null,
      // Sessions without a bound workspace execute in the per-session agent
      // workspace. Expose it so the UI resolves relative file paths from the
      // agent against the directory the agent actually runs in.
      agentWorkspaceRoot: session.workspaceId
        ? null
        : getAgentWorkspaceRoot(sessionId),
      remoteWorkspace: getStudioRemoteWorkspaceSummary(session.id),
    },
  })
}

export async function PATCH(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  const parsed = updateSessionSchema.safeParse(await request.json())

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

  if (parsed.data.workspaceId === null && parsed.data.projectId) {
    return NextResponse.json(
      { ok: false, error: "Cannot clear workspace while binding a project" },
      { status: 409 }
    )
  }

  const requestedWorkspace = parsed.data.workspaceId
    ? getStudioWorkspace(parsed.data.workspaceId)
    : null

  if (parsed.data.workspaceId && !requestedWorkspace) {
    return NextResponse.json(
      { ok: false, error: "Workspace not found" },
      { status: 404 }
    )
  }

  if (
    requestedWorkspace?.type === "local" &&
    parsed.data.projectId &&
    parsed.data.projectId !== requestedWorkspace.localProjectId
  ) {
    return NextResponse.json(
      { ok: false, error: "Workspace and project do not match" },
      { status: 409 }
    )
  }

  if (requestedWorkspace?.type === "sandbox" && parsed.data.projectId) {
    return NextResponse.json(
      { ok: false, error: "Sandbox workspaces cannot bind local projects" },
      { status: 409 }
    )
  }

  const previousSession = getStudioSession(sessionId)
  let session = previousSession

  if (parsed.data.title !== undefined) {
    session = updateStudioSessionTitle(sessionId, parsed.data.title)
  }

  if (parsed.data.pinned !== undefined) {
    session = updateStudioSessionPinned(sessionId, parsed.data.pinned)
  }

  if (parsed.data.archived !== undefined) {
    session = updateStudioSessionArchived(sessionId, parsed.data.archived)
  }

  if (parsed.data.workspaceId !== undefined) {
    session = updateStudioSessionWorkspace(sessionId, parsed.data.workspaceId)
  } else if (parsed.data.projectId !== undefined) {
    session = updateStudioSessionProject(sessionId, parsed.data.projectId)
  }

  if (parsed.data.permissionMode !== undefined) {
    session = updateStudioSessionPermissionMode(
      sessionId,
      parsed.data.permissionMode
    )
  }

  if (
    parsed.data.chatModel !== undefined ||
    parsed.data.chatRuntimeId !== undefined ||
    parsed.data.chatReasoningEffort !== undefined
  ) {
    session = updateStudioSessionChatPreferences(sessionId, {
      chatModel: parsed.data.chatModel,
      chatRuntimeId: parsed.data.chatRuntimeId,
      chatReasoningEffort: parsed.data.chatReasoningEffort,
    })
  }

  if (
    session &&
    previousSession &&
    (session.workspaceId !== previousSession.workspaceId ||
      session.chatRuntimeId !== previousSession.chatRuntimeId)
  ) {
    resetStudioSessionProviderResume(sessionId)
    resetAcpSessionsForStudioSession(sessionId)
    session = getStudioSession(sessionId)
  }

  return NextResponse.json({
    ok: true,
    data: session
      ? {
          ...session,
          workspace: session.workspaceId
            ? getStudioWorkspace(session.workspaceId)
            : null,
          agentWorkspaceRoot: session.workspaceId
            ? null
            : getAgentWorkspaceRoot(sessionId),
          remoteWorkspace: getStudioRemoteWorkspaceSummary(session.id),
        }
      : null,
  })
}

export async function DELETE(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params

  if (!getStudioSession(sessionId)) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  try {
    await deleteStudioAcpAgentSession(sessionId)
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? `Agent session deletion failed: ${error.message}`
            : "Agent session deletion failed.",
      },
      { status: 502 }
    )
  }

  resetAcpSessionsForStudioSession(sessionId)
  deleteStudioSession(sessionId)

  return NextResponse.json({ ok: true, data: { id: sessionId } })
}
