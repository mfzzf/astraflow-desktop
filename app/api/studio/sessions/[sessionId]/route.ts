import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  resetAcpSessionsForStudioSession,
  resetAcpSessionsForStudioSessionRuntime,
} from "@/lib/agent/acp/acp-runtime"
import { consumeLocalFullAccessGrant } from "@/lib/agent/local-full-access-grant"
import { SUPPORTED_CHAT_REASONING_EFFORTS } from "@/lib/chat-models"
import {
  deleteStudioSession,
  getStudioLocalFullAccessGrantScope,
  getStudioLocalProject,
  getStudioSession,
  getStudioWorkspace,
  resolveStudioSessionConfigurationWorkspaceSelection,
  updateStudioSessionConfiguration,
} from "@/lib/studio-db"
import { studioPermissionModes } from "@/lib/studio-types"
import {
  deleteStudioAcpAgentSession,
  getStudioChatRun,
} from "@/lib/studio-chat-runner"
import {
  getStudioRemoteWorkspaceSummary,
  stopStudioRemoteWorkspaceServicesForSession,
} from "@/lib/studio-remote-workspace"
import {
  cleanStudioSessionServiceScopeBeforeTransition,
  requiresStudioSessionServiceScopeCleanup,
  StudioSessionServiceTransitionError,
} from "@/lib/studio-session-service-transition"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

export const runtime = "nodejs"

const updateSessionSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    workspaceId: z.string().trim().min(1).nullable().optional(),
    projectId: z.string().trim().min(1).nullable().optional(),
    permissionMode: z.enum(studioPermissionModes).optional(),
    localFullAccessGrant: z.string().trim().min(1).max(4096).optional(),
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
      agentWorkspaceRoot: null,
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

  const currentSession = getStudioSession(sessionId)

  if (!currentSession) {
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
    requestedWorkspace?.origin === "selected_local" &&
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

  if (
    requestedWorkspace?.type === "local" &&
    requestedWorkspace.origin !== "selected_local" &&
    parsed.data.projectId
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Managed local workspaces cannot bind local projects",
      },
      { status: 409 }
    )
  }

  let effectiveSelection: ReturnType<
    typeof resolveStudioSessionConfigurationWorkspaceSelection
  >

  try {
    effectiveSelection =
      resolveStudioSessionConfigurationWorkspaceSelection(
        currentSession,
        parsed.data
      )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to resolve the session workspace",
      },
      { status: 409 }
    )
  }

  const nextWorkspace = effectiveSelection.workspaceId
    ? getStudioWorkspace(effectiveSelection.workspaceId)
    : null
  const executionBindingChanged =
    effectiveSelection.workspaceId !== currentSession.workspaceId ||
    effectiveSelection.projectId !== currentSession.projectId ||
    (parsed.data.chatRuntimeId !== undefined &&
      parsed.data.chatRuntimeId !== currentSession.chatRuntimeId) ||
    (parsed.data.permissionMode !== undefined &&
      parsed.data.permissionMode !== currentSession.permissionMode)
  const activeRun = executionBindingChanged
    ? getStudioChatRun(sessionId)
    : null

  if (activeRun?.status === "queued" || activeRun?.status === "running") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Wait for the active run to finish before changing its workspace, runtime, or permissions.",
      },
      { status: 409 }
    )
  }

  const currentWorkspace = currentSession.workspaceId
    ? getStudioWorkspace(currentSession.workspaceId)
    : null
  const serviceScopeCleanupRequired =
    requiresStudioSessionServiceScopeCleanup({
      currentWorkspace,
      currentPermissionMode: currentSession.permissionMode,
      nextWorkspaceId: effectiveSelection.workspaceId,
      nextPermissionMode:
        parsed.data.permissionMode ?? currentSession.permissionMode,
    })
  const requiresLocalFullAccessGrant =
    parsed.data.permissionMode === "full_access" &&
    nextWorkspace?.type !== "sandbox"

  if (
    requiresLocalFullAccessGrant &&
    !consumeLocalFullAccessGrant(parsed.data.localFullAccessGrant ?? "", {
      sessionId,
      workspaceId: nextWorkspace?.id ?? null,
      environment: "local",
    })
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Local Full Access requires a current confirmation from AstraFlow Desktop.",
      },
      { status: 403 }
    )
  }

  let update: ReturnType<typeof updateStudioSessionConfiguration>

  try {
    const configuration = { ...parsed.data }

    delete configuration.localFullAccessGrant

    update = await withStudioSessionLock(sessionId, async () => {
      const lockedRun = executionBindingChanged
        ? getStudioChatRun(sessionId)
        : null

      if (
        lockedRun?.status === "queued" ||
        lockedRun?.status === "running"
      ) {
        throw new Error(
          "Wait for the active run to finish before changing its workspace, runtime, or permissions."
        )
      }

      await cleanStudioSessionServiceScopeBeforeTransition({
        required: serviceScopeCleanupRequired,
        cleanup: () =>
          stopStudioRemoteWorkspaceServicesForSession(sessionId),
      })

      const runAfterCleanup = executionBindingChanged
        ? getStudioChatRun(sessionId)
        : null

      if (
        runAfterCleanup?.status === "queued" ||
        runAfterCleanup?.status === "running"
      ) {
        throw new Error(
          "A run started while workspace services were being stopped. Wait for it to finish before changing the session."
        )
      }

      return updateStudioSessionConfiguration(sessionId, {
        ...configuration,
        ...(requiresLocalFullAccessGrant
          ? {
              confirmLocalFullAccess: true,
              confirmedLocalFullAccessGrantScope:
                getStudioLocalFullAccessGrantScope(
                  sessionId,
                  nextWorkspace
                ) ?? undefined,
            }
          : {}),
      })
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update the session",
      },
      {
        status:
          error instanceof StudioSessionServiceTransitionError
            ? error.status
            : 409,
      }
    )
  }

  const session = update?.session ?? null
  const workspaceChanged = update?.workspaceChanged ?? false
  const runtimeChanged = update?.runtimeChanged ?? false
  const permissionChanged = update?.permissionChanged ?? false

  if (
    session &&
    (workspaceChanged || runtimeChanged || permissionChanged)
  ) {
    if (workspaceChanged || permissionChanged) {
      resetAcpSessionsForStudioSession(sessionId)
    } else if (runtimeChanged) {
      resetAcpSessionsForStudioSessionRuntime(
        sessionId,
        update?.previousRuntimeId || "astraflow"
      )
    }
  }

  return NextResponse.json({
    ok: true,
    data: session
      ? {
          ...session,
          workspace: session.workspaceId
            ? getStudioWorkspace(session.workspaceId)
            : null,
          agentWorkspaceRoot: null,
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

  try {
    const cleanup =
      await stopStudioRemoteWorkspaceServicesForSession(sessionId)

    if (cleanup.failures.length > 0) {
      console.warn("[studio-session] remote_service_cleanup_incomplete", {
        sessionId,
        attempted: cleanup.attempted,
        stopped: cleanup.stopped,
        failures: cleanup.failures,
      })
    }
  } catch (error) {
    console.warn("[studio-session] remote_service_cleanup_failed", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  resetAcpSessionsForStudioSession(sessionId)
  deleteStudioSession(sessionId)

  return NextResponse.json({ ok: true, data: { id: sessionId } })
}
