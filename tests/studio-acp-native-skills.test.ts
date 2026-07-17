// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { prepareNativeAgentSkills } from "@/lib/agent/acp/studio-plugins"
import type { InstalledSkill } from "@/lib/skill-market"

const originalAcpWorkspacesPath = process.env.ASTRAFLOW_ACP_WORKSPACES_PATH
const originalStudioSkillsPath = process.env.ASTRAFLOW_STUDIO_SKILLS_PATH
const testRoots: string[] = []

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

afterEach(() => {
  restoreEnv("ASTRAFLOW_ACP_WORKSPACES_PATH", originalAcpWorkspacesPath)
  restoreEnv("ASTRAFLOW_STUDIO_SKILLS_PATH", originalStudioSkillsPath)

  for (const root of testRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function installedSkill(installPath: string): InstalledSkill {
  return {
    slug: "pptx",
    version: "1.0.0",
    skill: {
      Slug: "pptx",
      Version: "1.0.0",
      Name: "PowerPoint",
      Desc: "Create and edit presentations.",
    },
    skillMd: "---\nname: pptx\ndescription: PPTX files\n---\n",
    enabled: true,
    bundled: true,
    installPath,
    installedFileCount: 2,
    installedSizeBytes: 100,
    installedAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  }
}

describe("native AstraFlow agent skills", () => {
  test("projects enabled skills into an isolated agent extra root", () => {
    const testRoot = mkdtempSync(join(tmpdir(), "astraflow-codex-skills-"))
    const installedRoot = join(testRoot, "installed")
    const installPath = join("pptx", "1.0.0")
    const sourceRoot = join(installedRoot, installPath)

    testRoots.push(testRoot)
    process.env.ASTRAFLOW_ACP_WORKSPACES_PATH = join(testRoot, "workspaces")
    process.env.ASTRAFLOW_STUDIO_SKILLS_PATH = installedRoot
    mkdirSync(join(sourceRoot, "scripts"), { recursive: true })
    writeFileSync(
      join(sourceRoot, "SKILL.md"),
      "---\nname: pptx\ndescription: PPTX files\n---\n",
      "utf8"
    )
    writeFileSync(
      join(sourceRoot, "scripts", "structural_qa.py"),
      "print('ok')\n",
      "utf8"
    )

    const projectionRoot = prepareNativeAgentSkills({
      sessionId: "native-skill-session",
      skills: [installedSkill(installPath)],
      expertSkills: [
        {
          slug: "expert-helper",
          title: "Expert helper",
          description: "Expert-only workflow.",
          skillMd:
            "---\nname: expert-helper\ndescription: Expert helper\n---\n",
        },
      ],
    })
    const projectedPptxRoot = join(projectionRoot, ".agents", "skills", "pptx")

    expect(realpathSync(projectedPptxRoot)).not.toBe(realpathSync(sourceRoot))
    expect(
      readFileSync(
        join(projectedPptxRoot, "scripts", "structural_qa.py"),
        "utf8"
      )
    ).toBe("print('ok')\n")
    expect(
      readFileSync(
        join(projectionRoot, ".agents", "skills", "expert-helper", "SKILL.md"),
        "utf8"
      )
    ).toContain("name: expert-helper")

    prepareNativeAgentSkills({
      sessionId: "native-skill-session",
      skills: [],
      expertSkills: [],
    })

    expect(existsSync(projectedPptxRoot)).toBe(false)
    expect(existsSync(join(sourceRoot, "SKILL.md"))).toBe(true)
  })
})
