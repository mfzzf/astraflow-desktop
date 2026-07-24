// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { ThemeProvider } from "@/components/theme-provider"
import {
  countUnifiedDiffChanges,
  parseUnifiedDiff,
  UnifiedDiffView,
} from "@/components/studio-file-diff"

const TestThemeProvider = ThemeProvider as React.ComponentType<{
  defaultTheme?: "light" | "dark" | "system"
}>

describe("unified diff rendering", () => {
  test("keeps changed source lines that begin with header-like prefixes", () => {
    const diff = [
      "--- a/example.txt",
      "+++ b/example.txt",
      "@@ -1 +1 @@",
      "---foo",
      "+++foo",
    ].join("\n")
    const lines = parseUnifiedDiff(diff)

    expect(lines.at(-2)?.kind).toBe("delete")
    expect(lines.at(-1)?.kind).toBe("add")
    expect(countUnifiedDiffChanges(diff)).toEqual({
      additions: 1,
      deletions: 1,
    })
  })

  test("uses hunk counts and ignores a diff's trailing split line", () => {
    const diff = [
      "diff --git a/example.txt b/example.txt",
      "--- a/example.txt",
      "+++ b/example.txt",
      "@@ -1,2 +1,2 @@",
      " first",
      "-before",
      "+after",
      "",
    ].join("\n")
    const lines = parseUnifiedDiff(diff)

    expect(lines.at(-1)).toMatchObject({
      kind: "add",
      content: "+after",
      newLine: 2,
    })
    expect(lines.some((line) => line.content === "")).toBe(false)
    expect(countUnifiedDiffChanges(diff)).toEqual({
      additions: 1,
      deletions: 1,
    })
  })

  test("uses one continuous background without per-line emphasis blocks", () => {
    const diff = [
      "--- a/example.ts",
      "+++ b/example.ts",
      "@@ -1 +1 @@",
      "-const before = true",
      "+const after = true",
    ].join("\n")
    const html = renderToStaticMarkup(
      createElement(
        TestThemeProvider,
        { defaultTheme: "light" },
        createElement(UnifiedDiffView, { diff, language: "typescript" })
      )
    )

    expect(html).toContain("bg-[var(--diffs-bg-addition)]")
    expect(html).toContain("bg-[var(--diffs-bg-deletion)]")
    expect(html).not.toContain("--diffs-bg-addition-emphasis")
    expect(html).not.toContain("--diffs-bg-deletion-emphasis")
  })
})
