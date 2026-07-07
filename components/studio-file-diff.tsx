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
    return "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
  }

  if (kind === "delete") {
    return "bg-destructive/10 text-destructive"
  }

  if (kind === "meta") {
    return "bg-muted/70 text-muted-foreground"
  }

  return "text-foreground"
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
    <div className={cn("text-[12px] leading-5", className)}>
      {items.map((item) => {
        if (item.type === "gap") {
          return (
            <div
              key={item.id}
              className="border-y border-border/50 bg-muted/40 px-3 py-1 font-sans text-[11px] text-muted-foreground"
            >
              {unmodifiedLabel
                ? unmodifiedLabel(item.count)
                : `${item.count} unmodified lines`}
            </div>
          )
        }

        const { line } = item

        return (
          <div
            key={line.id}
            className={cn(
              "grid min-w-max grid-cols-[3.25rem_3.25rem_1fr] font-mono",
              getDiffLineClassName(line.kind)
            )}
          >
            <span className="select-none border-r border-border/50 px-2 text-right text-muted-foreground">
              {line.oldLine ?? ""}
            </span>
            <span className="select-none border-r border-border/50 px-2 text-right text-muted-foreground">
              {line.newLine ?? ""}
            </span>
            <span className="whitespace-pre px-3">{line.content || " "}</span>
          </div>
        )
      })}
    </div>
  )
}
