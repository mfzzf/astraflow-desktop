// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  countUnifiedDiffChanges,
  parseUnifiedDiff,
} from "@/components/studio-file-diff"

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
})
