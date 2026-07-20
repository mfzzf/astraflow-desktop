// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { mergeStudioComposerSkills } from "@/lib/studio-composer-skills"
import type { InstalledSkill } from "@/lib/skill-market"

function installedSkill(slug: string, enabled = true): InstalledSkill {
  return {
    slug,
    version: "1.0.0",
    skill: { Slug: slug, Name: `Global ${slug}` },
    skillMd: `# Global ${slug}`,
    enabled,
    bundled: false,
    installPath: `${slug}/1.0.0`,
    installedFileCount: 1,
    installedSizeBytes: 1,
    installedAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  }
}

describe("session-scoped composer Skills", () => {
  test("includes expert Skills, filters disabled globals, and prefers the session version", () => {
    const skills = mergeStudioComposerSkills({
      expertSkills: [
        {
          slug: "shared-skill",
          title: "Remote shared skill",
          description: "Available in this session",
          skillMd: "# Remote shared skill",
        },
        {
          slug: "remote-only",
          title: "Remote only",
          description: "Remote session skill",
          skillMd: "# Remote only",
        },
      ],
      installedSkills: [
        installedSkill("shared-skill"),
        installedSkill("global-only"),
        installedSkill("disabled", false),
      ],
    })

    expect(skills.map((skill) => skill.slug)).toEqual([
      "shared-skill",
      "remote-only",
      "global-only",
    ])
    expect(skills[0]?.skill.Name).toBe("Remote shared skill")
    expect(skills[0]?.version).toBe("expert-runtime")
  })
})
