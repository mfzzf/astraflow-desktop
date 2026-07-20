import type { InstalledSkill } from "@/lib/skill-market"
import {
  expertDeclaredSkillToMeta,
  type ExpertDeclaredSkill,
} from "@/lib/studio-session-skills"

function expertSkillForComposer(skill: ExpertDeclaredSkill): InstalledSkill {
  return {
    slug: skill.slug,
    version: "expert-runtime",
    skill: expertDeclaredSkillToMeta(skill),
    skillMd: skill.skillMd,
    enabled: true,
    bundled: true,
    bundleHash: null,
    installPath: `expert-runtime/${skill.slug}`,
    installedFileCount: 1,
    installedSizeBytes: Buffer.byteLength(skill.skillMd, "utf8"),
    installedAt: "",
    updatedAt: "",
  }
}

/**
 * Produces the same session-scoped catalog exposed by the Skills MCP tools.
 * Expert-declared Skills belong to the active session and intentionally win
 * over a same-named global installation.
 */
export function mergeStudioComposerSkills({
  expertSkills,
  installedSkills,
}: {
  expertSkills: ExpertDeclaredSkill[]
  installedSkills: InstalledSkill[]
}) {
  const seen = new Set<string>()
  const merged: InstalledSkill[] = []

  for (const skill of [
    ...expertSkills.map(expertSkillForComposer),
    ...installedSkills.filter((skill) => skill.enabled),
  ]) {
    const key = skill.slug.trim().toLowerCase()

    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push(skill)
  }

  return merged
}
