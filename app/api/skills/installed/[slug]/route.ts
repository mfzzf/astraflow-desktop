import { NextResponse } from "next/server"
import { z } from "zod"

import {
  deleteStudioInstalledSkill,
  getStudioInstalledSkill,
  updateStudioInstalledSkillEnabled,
} from "@/lib/studio-db"
import { removeInstalledSkillFiles } from "@/lib/studio-skills"

export const runtime = "nodejs"

type InstalledSkillRouteContext = {
  params: Promise<{
    slug: string
  }>
}

const updateInstalledSkillSchema = z.object({
  enabled: z.boolean(),
})

function toErrorResponse(error: unknown) {
  if (error instanceof Error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Failed to update installed skill." },
    { status: 500 }
  )
}

async function readSlug(context: InstalledSkillRouteContext) {
  const { slug } = await context.params
  const normalizedSlug = decodeURIComponent(slug).trim()

  if (!normalizedSlug) {
    throw new Error("Skill slug is required.")
  }

  return normalizedSlug
}

export async function PATCH(
  request: Request,
  context: InstalledSkillRouteContext
) {
  try {
    const slug = await readSlug(context)
    const body = updateInstalledSkillSchema.parse(await request.json())
    const installed = updateStudioInstalledSkillEnabled(slug, body.enabled)

    if (!installed) {
      return NextResponse.json(
        { ok: false, message: "Installed skill was not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true, data: installed })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(
  _request: Request,
  context: InstalledSkillRouteContext
) {
  try {
    const slug = await readSlug(context)
    const installed = getStudioInstalledSkill(slug)

    if (!installed) {
      return NextResponse.json(
        { ok: false, message: "Installed skill was not found." },
        { status: 404 }
      )
    }

    if (installed.bundled) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Bundled skills are managed by CompShare and cannot be removed. Disable the skill instead.",
        },
        { status: 400 }
      )
    }

    if (!deleteStudioInstalledSkill(slug)) {
      throw new Error("Failed to remove installed skill.")
    }
    removeInstalledSkillFiles(installed.installPath)

    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
