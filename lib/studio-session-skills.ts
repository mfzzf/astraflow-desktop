import type { InstalledSkill, SkillMeta } from "@/lib/skill-market"
import { sanitizeSkillCatalogText } from "@/lib/studio-skills"

export type ExpertDeclaredSkill = {
  slug: string
  title: string
  description: string
  skillMd: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function firstString(record: Record<string, unknown>, ...fields: string[]) {
  for (const field of fields) {
    const value = readString(record[field])

    if (value) {
      return value
    }
  }

  return ""
}

function getRuntimeSnapshot(snapshot: unknown) {
  const record = asRecord(snapshot)
  return asRecord(record.runtime ?? snapshot)
}

export function listExpertDeclaredSkillsFromSnapshot(snapshot: unknown) {
  const runtime = getRuntimeSnapshot(snapshot)
  const skills = Array.isArray(runtime.skills) ? runtime.skills : []
  const seenSlugs = new Set<string>()
  const declaredSkills: ExpertDeclaredSkill[] = []

  for (const value of skills) {
    const skill = asRecord(value)
    const slug = firstString(skill, "skillSlug", "skill_slug")
    const skillMd = firstString(skill, "skillMarkdown", "skill_markdown")

    if (!slug || !skillMd || seenSlugs.has(slug)) {
      continue
    }

    seenSlugs.add(slug)
    declaredSkills.push({
      slug,
      title: firstString(skill, "title") || slug,
      description: firstString(skill, "description"),
      skillMd,
    })
  }

  return declaredSkills
}

export function formatInstalledSkillsList(skills: InstalledSkill[]) {
  if (!skills.length) {
    return "No globally enabled AstraFlow skills."
  }

  return skills
    .map((skill) => {
      const name = sanitizeSkillCatalogText(skill.skill.Name, skill.slug)
      const description = sanitizeSkillCatalogText(
        skill.skill.DescZh || skill.skill.Desc,
        "No description"
      )
      const category = sanitizeSkillCatalogText(
        skill.skill.Category,
        "uncategorized"
      )

      return `- ${skill.slug} | ${name} | v${skill.version} | ${category} | ${description}`
    })
    .join("\n")
}

export function formatExpertDeclaredSkillsList(skills: ExpertDeclaredSkill[]) {
  if (!skills.length) {
    return "No selected expert skills."
  }

  return skills
    .map((skill) => {
      const title = sanitizeSkillCatalogText(skill.title, skill.slug)
      const description = sanitizeSkillCatalogText(
        skill.description,
        "No description"
      )

      return `- ${skill.slug} | ${title} | expert runtime | ${description}`
    })
    .join("\n")
}

export function summarizeExpertDeclaredSkillsForPrompt(
  skills: ExpertDeclaredSkill[]
) {
  if (!skills.length) {
    return ""
  }

  return [
    "The selected expert declares additional AstraFlow Skills for this session. These skills are available by slug through load_skill even when they are not globally installed. First call load_skill with the matching slug, then follow the returned SKILL.md.",
    "Selected expert skills catalog:",
    formatExpertDeclaredSkillsList(skills),
  ].join("\n")
}

export function formatExpertDeclaredSkillForModel(skill: ExpertDeclaredSkill) {
  return [
    `Skill loaded: ${skill.title || skill.slug}`,
    `Slug: ${skill.slug}`,
    "Version: expert-runtime",
    "Skill file access: only SKILL.md is bundled for this expert-declared skill.",
    "",
    "Files:",
    "- SKILL.md",
    "",
    "SKILL.md:",
    skill.skillMd,
  ].join("\n")
}

export function expertDeclaredSkillToMeta(skill: ExpertDeclaredSkill): SkillMeta {
  return {
    Slug: skill.slug,
    Version: "expert-runtime",
    Name: skill.title || skill.slug,
    Desc: skill.description,
    Category: "Expert",
    FileCount: 1,
    SizeBytes: Buffer.byteLength(skill.skillMd, "utf8"),
    UpStream: "expert-runtime",
  }
}
