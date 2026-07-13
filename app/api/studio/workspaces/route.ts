import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { listStudioWorkspaces } from "@/lib/studio-db"
import {
  createLocalStudioWorkspace,
  createSandboxStudioWorkspace,
  StudioWorkspaceNotFoundError,
  StudioWorkspaceValidationError,
} from "@/lib/studio-workspace-service"

export const runtime = "nodejs"

const optionalWorkspaceName = z.string().trim().min(1).max(64).optional()

const createWorkspaceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("local"),
    path: z.string().trim().min(1),
    name: optionalWorkspaceName,
  }),
  z.object({
    type: z.literal("sandbox"),
    sandboxId: z.string().trim().min(1),
    rootPath: z.string().trim().min(1),
    name: optionalWorkspaceName,
  }),
])

function workspaceErrorResponse(error: unknown) {
  if (error instanceof StudioWorkspaceNotFoundError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 404 }
    )
  }

  if (error instanceof StudioWorkspaceValidationError) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to create Studio workspace.",
    },
    { status: 500 }
  )
}

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  return NextResponse.json({ ok: true, data: listStudioWorkspaces() })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
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

  const parsed = createWorkspaceSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  try {
    const workspace =
      parsed.data.type === "local"
        ? await createLocalStudioWorkspace(parsed.data)
        : await createSandboxStudioWorkspace(parsed.data)

    return NextResponse.json({ ok: true, data: workspace }, { status: 201 })
  } catch (error) {
    return workspaceErrorResponse(error)
  }
}
