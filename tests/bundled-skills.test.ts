// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { installBundledStudioSkills } from "@/lib/bundled-skills"

describe("bundled skills", () => {
  let testRoot = ""
  let sourceRoot = ""
  let previousBundledRoot: string | undefined
  let previousInstalledRoot: string | undefined

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "astraflow-bundled-skills-"))
    sourceRoot = join(testRoot, "source")
    cpSync(resolve("bundled-skills"), sourceRoot, { recursive: true })
    previousBundledRoot = process.env.ASTRAFLOW_BUNDLED_SKILLS_PATH
    previousInstalledRoot = process.env.ASTRAFLOW_STUDIO_SKILLS_PATH
    process.env.ASTRAFLOW_BUNDLED_SKILLS_PATH = sourceRoot
    process.env.ASTRAFLOW_STUDIO_SKILLS_PATH = join(testRoot, "installed")
  })

  afterEach(() => {
    if (previousBundledRoot === undefined) {
      delete process.env.ASTRAFLOW_BUNDLED_SKILLS_PATH
    } else {
      process.env.ASTRAFLOW_BUNDLED_SKILLS_PATH = previousBundledRoot
    }

    if (previousInstalledRoot === undefined) {
      delete process.env.ASTRAFLOW_STUDIO_SKILLS_PATH
    } else {
      process.env.ASTRAFLOW_STUDIO_SKILLS_PATH = previousInstalledRoot
    }

    rmSync(testRoot, { recursive: true, force: true })
  })

  test("verifies and installs all bundled skills", () => {
    const skills = installBundledStudioSkills()

    expect(skills.map((skill) => skill.slug).sort()).toEqual(
      [
        "ardot-design-core",
        "ardot-design-router",
        "ardot-design-to-code",
        "ardot-poster",
        "ardot-slides",
        "ardot-ui-design",
        "compshare-cli",
        "docx",
        "expert-manager",
        "finance-skill",
        "pdf",
        "pptx",
        "skill-creator",
        "westock-data",
        "westock-tool",
        "xlsx",
      ].sort()
    )
    expect(skills.every((skill) => skill.installedFileCount >= 1)).toBe(true)

    for (const skill of skills) {
      const installedSkillMd = join(
        process.env.ASTRAFLOW_STUDIO_SKILLS_PATH!,
        ...skill.installPath.split("/"),
        "SKILL.md"
      )
      expect(existsSync(installedSkillMd)).toBe(true)
      expect(readFileSync(installedSkillMd, "utf8")).toBe(skill.skillMd)
    }

    const pptxSkill = skills.find((skill) => skill.slug === "pptx")
    expect(pptxSkill?.skillMd).toContain("Local macOS Runtime")
    expect(pptxSkill?.skillMd).toContain("scripts/structural_qa.py")
    expect(
      existsSync(
        join(
          process.env.ASTRAFLOW_STUDIO_SKILLS_PATH!,
          ...pptxSkill!.installPath.split("/"),
          "scripts",
          "structural_qa.py"
        )
      )
    ).toBe(true)
  })

  test("rejects a bundled file that does not match its SHA-256", () => {
    const skillPath = join(sourceRoot, "pptx", "SKILL.md")
    writeFileSync(skillPath, `${readFileSync(skillPath, "utf8")}\ntampered\n`)

    expect(() => installBundledStudioSkills()).toThrow(
      "failed SHA-256 verification"
    )
  })
})
