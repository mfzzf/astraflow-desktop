"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export type ParsedDiffLine = {
  id: string
  kind: "context" | "add" | "delete" | "meta"
  oldLine: number | null
  newLine: number | null
  content: string
}

export function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
  const parsedLines: ParsedDiffLine[] = []
  let oldLine: number | null = null
  let newLine: number | null = null

  diff.split(/\r?\n/).forEach((line, index) => {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)

    if (hunkMatch) {
      oldLine = Number.parseInt(hunkMatch[1], 10)
      newLine = Number.parseInt(hunkMatch[2], 10)
      parsedLines.push({
        id: `${index}:meta`,
        kind: "meta",
        oldLine: null,
        newLine: null,
        content: line,
      })
      return
    }

    if (
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++") ||
      line.startsWith("\\")
    ) {
      parsedLines.push({
        id: `${index}:meta`,
        kind: "meta",
        oldLine: null,
        newLine: null,
        content: line,
      })
      return
    }

    if (line.startsWith("+")) {
      parsedLines.push({
        id: `${index}:add`,
        kind: "add",
        oldLine: null,
        newLine,
        content: line,
      })
      newLine = newLine === null ? null : newLine + 1
      return
    }

    if (line.startsWith("-")) {
      parsedLines.push({
        id: `${index}:delete`,
        kind: "delete",
        oldLine,
        newLine: null,
        content: line,
      })
      oldLine = oldLine === null ? null : oldLine + 1
      return
    }

    parsedLines.push({
      id: `${index}:context`,
      kind: "context",
      oldLine,
      newLine,
      content: line,
    })
    oldLine = oldLine === null ? null : oldLine + 1
    newLine = newLine === null ? null : newLine + 1
  })

  return parsedLines
}

export function getDiffLineClassName(kind: ParsedDiffLine["kind"]) {
  if (kind === "add") {
    return "bg-[var(--diffs-bg-addition)] text-foreground before:bg-[var(--diffs-addition-base)]"
  }

  if (kind === "delete") {
    return "bg-[var(--diffs-bg-deletion)] text-foreground before:bg-[var(--diffs-deletion-base)]"
  }

  if (kind === "meta") {
    return "bg-[var(--diffs-bg-separator)] text-muted-foreground before:bg-transparent"
  }

  return "bg-[var(--diffs-bg-context)] text-foreground before:bg-transparent"
}

const MAX_SYNTHESIZED_DIFF_CHARS = 200_000

export function countContentLines(content: string) {
  if (!content) {
    return 0
  }

  const lines = content.split(/\r?\n/)

  if (lines.at(-1) === "") {
    lines.pop()
  }

  return lines.length
}

// Fallback for files written outside a git repository (no real diff
// available): present the written content as pure additions.
export function synthesizeAdditionsDiff(path: string, content: string) {
  if (!content.trim() || content.length > MAX_SYNTHESIZED_DIFF_CHARS) {
    return null
  }

  const lines = content.split(/\r?\n/)

  if (lines.at(-1) === "") {
    lines.pop()
  }

  if (lines.length === 0) {
    return null
  }

  return [
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n")
}

type DiffViewItem =
  | { type: "line"; line: ParsedDiffLine }
  | { type: "gap"; id: string; count: number }

// Replaces raw diff meta lines with Codex-style "N unmodified lines"
// separators derived from the gaps between hunks.
function buildDiffViewItems(lines: ParsedDiffLine[]): DiffViewItem[] {
  const items: DiffViewItem[] = []
  let previousHunkOldEnd: number | null = null

  for (const line of lines) {
    if (line.kind !== "meta") {
      items.push({ type: "line", line })
      continue
    }

    const hunkMatch = line.content.match(/^@@ -(\d+)(?:,(\d+))? \+\d+/)

    if (!hunkMatch) {
      continue
    }

    const oldStart = Number.parseInt(hunkMatch[1], 10)
    const oldCount = hunkMatch[2] ? Number.parseInt(hunkMatch[2], 10) : 1
    const gap =
      previousHunkOldEnd === null
        ? oldStart - 1
        : oldStart - previousHunkOldEnd

    if (gap > 0) {
      items.push({ type: "gap", id: `gap-${line.id}`, count: gap })
    }

    previousHunkOldEnd = oldStart + oldCount
  }

  return items
}

export function UnifiedDiffView({
  diff,
  unmodifiedLabel,
  className,
}: {
  diff: string | null | undefined
  unmodifiedLabel?: (count: number) => string
  className?: string
}) {
  const items = React.useMemo(
    () => (diff ? buildDiffViewItems(parseUnifiedDiff(diff)) : []),
    [diff]
  )

  if (items.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "min-w-max bg-[var(--diffs-bg)] [font-family:var(--diffs-font-family)] text-[length:var(--diffs-font-size)] leading-[var(--diffs-line-height)] tracking-[-0.01em]",
        className
      )}
    >
      {items.map((item) => {
        if (item.type === "gap") {
          return (
            <button
              key={item.id}
              type="button"
              className="flex h-8 w-full min-w-max items-center border-y border-token-border-light bg-[var(--diffs-bg-separator)] px-3 text-left font-sans text-[11px] font-medium text-token-text-secondary"
            >
              <span className="rounded-full bg-background/70 px-2 py-0.5">
                {unmodifiedLabel
                  ? unmodifiedLabel(item.count)
                  : `${item.count} unmodified lines`}
              </span>
            </button>
          )
        }

        const { line } = item

        return (
          <div
            key={line.id}
            className={cn(
              "relative grid min-w-max grid-cols-[var(--diffs-code-grid)] before:absolute before:inset-y-0 before:left-0 before:w-0.5",
              getDiffLineClassName(line.kind)
            )}
          >
            <span
              className={cn(
                "select-none px-2 text-right text-muted-foreground",
                line.kind === "add" && "bg-[var(--diffs-bg-addition-number)]",
                line.kind === "delete" &&
                  "bg-[var(--diffs-bg-deletion-number)]",
                (line.kind === "context" || line.kind === "meta") &&
                  "bg-[var(--diffs-bg-context-gutter)]"
              )}
            >
              {line.newLine ?? line.oldLine ?? ""}
            </span>
            <span className="whitespace-pre px-3">
              <span
                className={cn(
                  line.kind === "add" &&
                    "bg-[var(--diffs-bg-addition-emphasis)]",
                  line.kind === "delete" &&
                    "bg-[var(--diffs-bg-deletion-emphasis)]"
                )}
              >
                {line.content || " "}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
