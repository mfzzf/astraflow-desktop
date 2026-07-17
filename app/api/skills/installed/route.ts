import { NextResponse } from "next/server"
import { z } from "zod"

import type { SkillMeta } from "@/lib/skill-market"
import {
  getStudioInstalledSkill,
  listStudioInstalledSkills,
  upsertStudioInstalledSkill,
} from "@/lib/studio-db"
import { installStudioSkillFiles, removeInstalledSkillFiles } from "@/lib/studio-skills"
import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import { marketplaceServiceGetSkillDetail } from "@/lib/generated/astraflow-api"
import { toSkillMeta } from "@/lib/marketplace-mappers"

export const runtime = "nodejs"

const installSkillSchema = z.object({
  slug: z.string().trim().min(1),
  version: z.string().trim().optional(),
})

function toErrorResponse(error: unknown) {
  if (error instanceof AstraFlowApiError) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: error.status }
    )
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Failed to manage installed skills." },
    { status: 500 }
  )
}

function withResolvedIdentity(skill: SkillMeta, slug: string, version?: string) {
  return {
    ...skill,
    Slug: skill.Slug?.trim() || slug,
    Version: skill.Version?.trim() || version?.trim() || "latest",
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    data: listStudioInstalledSkills(),
  })
}

export async function POST(request: Request) {
  try {
    const body = installSkillSchema.parse(await request.json())
    const result = await marketplaceServiceGetSkillDetail({
      path: { slug: body.slug },
      query: { version: body.version },
    })
    const response = unwrapAstraFlowApiResult(
      result,
      "Failed to load skill detail."
    )
    const skill = withResolvedIdentity(
      toSkillMeta(response.skill ?? {}),
      body.slug,
      body.version
    )
    const previous = getStudioInstalledSkill(body.slug)
    const installResult = await installStudioSkillFiles({
      skill,
      skillMd: response.skillMd ?? "",
    })
    const installed = upsertStudioInstalledSkill({
      slug: skill.Slug ?? body.slug,
      version: skill.Version ?? body.version ?? "latest",
      skill,
      skillMd: installResult.skillMd,
      enabled: true,
      installPath: installResult.installPath,
      installedFileCount: installResult.installedFileCount,
      installedSizeBytes: installResult.installedSizeBytes,
    })

    if (
      previous &&
      previous.installPath !== installResult.installPath &&
      previous.installPath
    ) {
      removeInstalledSkillFiles(previous.installPath)
    }

    if (!installed) {
      throw new Error("Failed to save installed skill.")
    }

    return NextResponse.json({ ok: true, data: installed })
  } catch (error) {
    return toErrorResponse(error)
  }
}
