// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { resolveStudioSkillInvocation } from "@/lib/agent/studio-skill-invocation"

const xiaohongshuSkill = {
  slug: "xiaohongshu-account-booster",
  loadedContent: "# 小红书起号助手\n\nUse scripts/tool.py for analysis.",
}
const xlsxSkill = {
  slug: "xlsx",
  loadedContent: "# Spreadsheet Skill\n\nCreate and edit workbooks.",
}

describe("Studio Skill slash invocation", () => {
  test("resolves an enabled Skill and removes path-like slash syntax", () => {
    const resolved = resolveStudioSkillInvocation({
      candidates: [xiaohongshuSkill],
      content: "/xiaohongshu-account-booster 分析下这个",
    })

    expect(resolved?.slug).toBe("xiaohongshu-account-booster")
    expect(resolved?.prompt.startsWith("/")).toBe(false)
    expect(resolved?.prompt).toContain('"/xiaohongshu-account-booster"')
    expect(resolved?.prompt).toContain("# 小红书起号助手")
    expect(resolved?.prompt).toContain("User request after the Skill command:\n分析下这个")
  })

  test("loads multiple leading Skill commands into one request", () => {
    const resolved = resolveStudioSkillInvocation({
      candidates: [xlsxSkill, xiaohongshuSkill],
      content: "/xlsx /xiaohongshu-account-booster 分析并导出数据",
    })

    expect(resolved?.slugs).toEqual([
      "xlsx",
      "xiaohongshu-account-booster",
    ])
    expect(resolved?.prompt).toContain("# Spreadsheet Skill")
    expect(resolved?.prompt).toContain("# 小红书起号助手")
    expect(resolved?.prompt).toContain("分析并导出数据")
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
