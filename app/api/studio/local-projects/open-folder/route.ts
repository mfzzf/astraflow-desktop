import { stat } from "node:fs/promises"
import { NextResponse } from "next/server"
import { z } from "zod"

import { getAppAuthState } from "@/lib/app-auth"
import { openFolder } from "@/lib/open-folder"
import { getStudioLocalProject, touchStudioLocalProject } from "@/lib/studio-db"

export const runtime = "nodejs"

const openLocalProjectSchema = z.object({
  id: z.string().trim().min(1),
})

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

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  const parsed = openLocalProjectSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const project = getStudioLocalProject(parsed.data.id)

  if (!project) {
    return NextResponse.json(
      { ok: false, error: "Project not found." },
      { status: 404 }
    )
  }

  try {
    const stats = await stat(/* turbopackIgnore: true */ project.path)

    if (!stats.isDirectory()) {
      return NextResponse.json(
        { ok: false, error: "Project directory was not found." },
        { status: 404 }
      )
    }

    await openFolder(project.path)
    touchStudioLocalProject(project.id)

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to open project."

    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
