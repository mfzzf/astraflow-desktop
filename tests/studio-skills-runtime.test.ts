// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import type { InstalledSkill } from "@/lib/skill-market"
import {
  formatLoadedSkillForModel,
  formatSkillRuntimeGuidanceForModel,
  formatSkillSandboxPreparationForModel,
  type SkillSandboxSyncSummary,
} from "@/lib/studio-skills"

const syncSummary: SkillSandboxSyncSummary = {
  attemptedFileCount: 3,
  failed: [],
  skipped: [],
  syncedFileCount: 3,
  totalFileCount: 3,
}

const pptxSkill: InstalledSkill = {
  slug: "pptx",
  version: "1.0.0",
  skill: { Name: "PowerPoint" },
  skillMd: "# PPTX Skill\n\nRemote rendering instructions.",
  enabled: true,
  bundled: true,
  bundleHash: "hash",
  installPath: "__bundled__/pptx/1.0.0",
  installedFileCount: 3,
  installedSizeBytes: 100,
  installedAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
}

describe("studio skill runtime guidance", () => {
  test("disables native PPTX renderers for local macOS", () => {
    const guidance = formatSkillRuntimeGuidanceForModel({
      environment: "local",
      platform: "darwin",
      slug: "pptx",
    })

    expect(guidance).toContain("Local macOS runtime override")
    expect(guidance).toContain("soffice")
    expect(guidance).toContain("pdftoppm")
    expect(guidance).toContain("qlmanage")
    expect(guidance).toContain("structural_qa.py")
    expect(guidance).toContain("not a completion blocker")
  })

  test("does not add the override outside local macOS PPTX work", () => {
    expect(
      formatSkillRuntimeGuidanceForModel({
        environment: "remote",
        platform: "darwin",
        slug: "pptx",
      })
    ).toBe("")
    expect(
      formatSkillRuntimeGuidanceForModel({
        environment: "local",
        platform: "linux",
        slug: "pptx",
      })
    ).toBe("")
    expect(
      formatSkillRuntimeGuidanceForModel({
        environment: "local",
        platform: "darwin",
        slug: "docx",
      })
    ).toBe("")
  })

  test("places the local override after the skill instructions", () => {
    const runtimeGuidance = formatSkillRuntimeGuidanceForModel({
      environment: "local",
      platform: "darwin",
      slug: "pptx",
    })
    const loaded = formatLoadedSkillForModel({
      capabilities: {
        fileAccess: "read_skill_file",
        sandbox: "prepare_on_demand",
      },
      files: [{ path: "SKILL.md", size: 100 }],
      runtimeGuidance,
      skill: pptxSkill,
    })

    expect(loaded.indexOf("Remote rendering instructions.")).toBeLessThan(
      loaded.indexOf("Local macOS runtime override")
    )
  })

  test("names the command tool that exists in each environment", () => {
    const local = formatSkillSandboxPreparationForModel({
      environment: "local",
      sandboxPath: "/tmp/session/skills/pptx",
      slug: "pptx",
      summary: syncSummary,
    })
    const remote = formatSkillSandboxPreparationForModel({
      environment: "remote",
      sandboxPath: "/home/user/astraflow/skills/pptx",
      slug: "pptx",
      summary: syncSummary,
    })

    expect(local).toContain("local `bash` tool")
    expect(local).not.toContain("run_code")
    expect(remote).toContain("remote Sandbox `bash` tool")
    expect(remote).not.toContain("run_code")
    expect(remote).not.toContain("run_command")
  })
})
