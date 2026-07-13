import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { createStudioRemoteWorkspace } from "@/lib/studio-remote-workspace"

export const runtime = "nodejs"

const createRemoteWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(64),
  repoUrl: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
})

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const parsed = createRemoteWorkspaceSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  try {
    return NextResponse.json(
      {
        ok: true,
        data: await createStudioRemoteWorkspace(parsed.data),
      },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to create the remote workspace.",
      },
      { status: 400 }
    )
  }
}
