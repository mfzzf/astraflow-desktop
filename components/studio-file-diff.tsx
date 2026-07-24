"use client"

import * as React from "react"

import { useShikiHighlightedLines } from "@/components/prompt-kit/code-block"
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
  let insideHunk = false
  let remainingOldLines = 0
  let remainingNewLines = 0

  function consumeHunkLine(oldCount: number, newCount: number) {
    remainingOldLines = Math.max(0, remainingOldLines - oldCount)
    remainingNewLines = Math.max(0, remainingNewLines - newCount)

    if (remainingOldLines === 0 && remainingNewLines === 0) {
      insideHunk = false
    }
  }

  diff.split(/\r?\n/).forEach((line, index) => {
    if (line.startsWith("diff ")) {
      insideHunk = false
      oldLine = null
      newLine = null
      remainingOldLines = 0
      remainingNewLines = 0
      parsedLines.push({
        id: `${index}:meta`,
        kind: "meta",
        oldLine: null,
        newLine: null,
        content: line,
      })
      return
    }

    const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)

    if (hunkMatch) {
      remainingOldLines = hunkMatch[2] ? Number.parseInt(hunkMatch[2], 10) : 1
      remainingNewLines = hunkMatch[4] ? Number.parseInt(hunkMatch[4], 10) : 1
      insideHunk = remainingOldLines > 0 || remainingNewLines > 0
      oldLine = Number.parseInt(hunkMatch[1], 10)
      newLine = Number.parseInt(hunkMatch[3], 10)
      parsedLines.push({
        id: `${index}:meta`,
        kind: "meta",
        oldLine: null,
        newLine: null,
        content: line,
      })
      return
    }

    if (line.startsWith("\\")) {
      parsedLines.push({
        id: `${index}:meta`,
        kind: "meta",
        oldLine: null,
        newLine: null,
        content: line,
      })
      return
    }

    if (insideHunk && line.startsWith("+")) {
      parsedLines.push({
        id: `${index}:add`,
        kind: "add",
        oldLine: null,
        newLine,
        content: line,
      })
      newLine = newLine === null ? null : newLine + 1
      consumeHunkLine(0, 1)
      return
    }

    if (insideHunk && line.startsWith("-")) {
      parsedLines.push({
        id: `${index}:delete`,
        kind: "delete",
        oldLine,
        newLine: null,
        content: line,
      })
      oldLine = oldLine === null ? null : oldLine + 1
      consumeHunkLine(1, 0)
      return
    }

    if (insideHunk) {
      parsedLines.push({
        id: `${index}:context`,
        kind: "context",
        oldLine,
        newLine,
        content: line,
      })
      oldLine = oldLine === null ? null : oldLine + 1
      newLine = newLine === null ? null : newLine + 1
      consumeHunkLine(1, 1)
      return
    }

    // A trailing newline produces one final empty split entry. Outside a
    // declared hunk it is not a source line and must not receive line numbers.
    if (!line) {
      return
    }

    parsedLines.push({
      id: `${index}:meta`,
      kind: "meta",
      oldLine: null,
      newLine: null,
      content: line,
    })
  })

  return parsedLines
}

export function countUnifiedDiffChanges(diff: string) {
  return parseUnifiedDiff(diff).reduce(
    (counts, line) => {
      if (line.kind === "add") {
        counts.additions += 1
      } else if (line.kind === "delete") {
        counts.deletions += 1
      }

      return counts
    },
    { additions: 0, deletions: 0 }
  )
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
      previousHunkOldEnd === null ? oldStart - 1 : oldStart - previousHunkOldEnd

    if (gap > 0) {
      items.push({ type: "gap", id: `gap-${line.id}`, count: gap })
    }

    previousHunkOldEnd = oldStart + oldCount
  }

  return items
}

function getDiffDisplayContent(line: ParsedDiffLine) {
  if (
    line.kind !== "meta" &&
    ((line.kind === "add" && line.content.startsWith("+")) ||
      (line.kind === "delete" && line.content.startsWith("-")) ||
      (line.kind === "context" && line.content.startsWith(" ")))
  ) {
    return line.content.slice(1)
  }

  return line.content
}

export function UnifiedDiffView({
  diff,
  language = "plaintext",
  unmodifiedLabel,
  className,
  streaming = false,
}: {
  diff: string | null | undefined
  language?: string
  unmodifiedLabel?: (count: number) => string
  className?: string
  streaming?: boolean
}) {
  const items = React.useMemo(
    () => (diff ? buildDiffViewItems(parseUnifiedDiff(diff)) : []),
    [diff]
  )
  const syntaxSource = React.useMemo(
    () =>
      items
        .filter(
          (item): item is Extract<DiffViewItem, { type: "line" }> =>
            item.type === "line"
        )
        .map((item) => getDiffDisplayContent(item.line))
        .join("\n"),
    [items]
  )
  const highlightedLines = useShikiHighlightedLines({
    code: syntaxSource,
    language,
    enabled: !streaming,
  })
  const syntaxLineIndexById = React.useMemo(
    () =>
      new Map(
        items
          .filter(
            (item): item is Extract<DiffViewItem, { type: "line" }> =>
              item.type === "line"
          )
          .map((item, index) => [item.line.id, index])
      ),
    [items]
  )

  if (items.length === 0) {
    return null
  }

  return (
    <div
      data-unified-diff="true"
      data-streaming={streaming ? "true" : "false"}
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
        const syntaxLineIndex = syntaxLineIndexById.get(line.id)
        const highlightedLine =
          syntaxLineIndex === undefined
            ? undefined
            : highlightedLines?.[syntaxLineIndex]
        const displayContent = getDiffDisplayContent(line)

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
                "px-2 text-right text-muted-foreground select-none",
                line.kind === "add" && "bg-[var(--diffs-bg-addition-number)]",
                line.kind === "delete" &&
                  "bg-[var(--diffs-bg-deletion-number)]",
                (line.kind === "context" || line.kind === "meta") &&
                  "bg-[var(--diffs-bg-context-gutter)]"
              )}
            >
              {line.newLine ?? line.oldLine ?? ""}
            </span>
            <span className="px-3 whitespace-pre">
              {highlightedLine ? (
                <span
                  // Shiki escapes source before emitting token spans.
                  dangerouslySetInnerHTML={{ __html: highlightedLine }}
                />
              ) : (
                displayContent || " "
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}
