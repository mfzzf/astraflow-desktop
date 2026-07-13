import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  deleteStudioWorkspace,
  getStudioWorkspace,
  setStudioWorkspaceLastOpenedAt,
  touchStudioWorkspace,
  updateStudioWorkspaceName,
} from "@/lib/studio-db"

export const runtime = "nodejs"

type WorkspaceRouteContext = {
  params: Promise<{ workspaceId: string }>
}

const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    lastOpenedAt: z
      .string()
      .trim()
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: "lastOpenedAt must be an ISO date-time string.",
      })
      .nullable()
      .optional(),
    opened: z.literal(true).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.lastOpenedAt !== undefined ||
      value.opened !== undefined,
    { message: "At least one workspace field is required." }
  )

async function authenticatedWorkspace(
  request: Request,
  context: WorkspaceRouteContext
) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return { response: authError, workspace: null }
  }

  const { workspaceId } = await context.params
  const normalizedId = decodeURIComponent(workspaceId)
  const workspace = getStudioWorkspace(normalizedId)

  if (!workspace) {
    return {
      response: NextResponse.json(
        { ok: false, error: "Workspace not found" },
        { status: 404 }
      ),
      workspace: null,
    }
  }

  return { response: null, workspace }
}

export async function GET(request: Request, context: WorkspaceRouteContext) {
  const result = await authenticatedWorkspace(request, context)

  if (result.response) {
    return result.response
  }

  return NextResponse.json({ ok: true, data: result.workspace })
}

export async function PATCH(request: Request, context: WorkspaceRouteContext) {
  const result = await authenticatedWorkspace(request, context)

  if (result.response || !result.workspace) {
    return result.response
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 }
    )
  }

  const parsed = updateWorkspaceSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  let workspace = result.workspace

  if (parsed.data.name !== undefined) {
    workspace =
      updateStudioWorkspaceName(workspace.id, parsed.data.name) ?? workspace
  }

  if (parsed.data.opened) {
    workspace = touchStudioWorkspace(workspace.id) ?? workspace
  } else if (parsed.data.lastOpenedAt !== undefined) {
    workspace =
      setStudioWorkspaceLastOpenedAt(workspace.id, parsed.data.lastOpenedAt) ??
      workspace
  }

  return NextResponse.json({ ok: true, data: workspace })
}

export async function DELETE(request: Request, context: WorkspaceRouteContext) {
  const result = await authenticatedWorkspace(request, context)

  if (result.response || !result.workspace) {
    return result.response
  }

  deleteStudioWorkspace(result.workspace.id)

  return NextResponse.json({
    ok: true,
    data: { id: result.workspace.id },
  })
}
