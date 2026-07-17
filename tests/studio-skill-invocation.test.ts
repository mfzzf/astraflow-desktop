// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { resolveStudioSkillInvocation } from "@/lib/agent/studio-skill-invocation"

const xiaohongshuSkill = {
  slug: "xiaohongshu-account-booster",
  loadedContent: "# 小红书起号助手\n\nUse scripts/tool.py for analysis.",
}

describe("Studio Skill slash invocation", () => {
  test("resolves an enabled Skill and removes path-like slash syntax", () => {
    const resolved = resolveStudioSkillInvocation({
      candidates: [xiaohongshuSkill],
      content: "/xiaohongshu-account-booster 分析下这个",
    })

    expect(resolved?.slug).toBe("xiaohongshu-account-booster")
    expect(resolved?.prompt.startsWith("/")).toBe(false)
    expect(resolved?.prompt).toContain(
      'The token "/xiaohongshu-account-booster" is a Skill command, not a filesystem path.'
    )
    expect(resolved?.prompt).toContain("# 小红书起号助手")
    expect(resolved?.prompt).toContain("User request after the Skill command:\n分析下这个")
  })

  test("starts a no-argument Skill invocation with an input-safe task", () => {
    const resolved = resolveStudioSkillInvocation({
      candidates: [xiaohongshuSkill],
      content: "/xiaohongshu-account-booster",
    })

    expect(resolved?.prompt).toContain(
      "Ask for any user input required by the Skill before continuing."
    )
  })

  test("leaves unknown, disabled, path, and runtime slash commands unresolved", () => {
    for (const content of [
      "/unknown do work",
      "/disabled-skill do work",
      "/compact preserve decisions",
      "/Users/zzf/project",
    ]) {
      expect(
        resolveStudioSkillInvocation({
          candidates: [xiaohongshuSkill],
          content,
        })
      ).toBeNull()
    }
  })

  test("requires an exact, case-sensitive enabled slug", () => {
    expect(
      resolveStudioSkillInvocation({
        candidates: [xiaohongshuSkill],
        content: "/Xiaohongshu-Account-Booster 分析",
      })
    ).toBeNull()
  })
})
