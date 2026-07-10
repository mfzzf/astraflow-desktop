import type { AgentFileChangeEvent } from "@/lib/agent/events"

type DiffOperation = {
  type: "add" | "delete" | "equal"
  value: string
}

const DIFF_CONTEXT_LINES = 3
const MAX_LCS_CELLS = 2_000_000

function splitLines(content: string) {
  return content.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function createFallbackOperations(
  previousLines: string[],
  nextLines: string[]
): DiffOperation[] {
  let prefixLength = 0

  while (
    prefixLength < previousLines.length &&
    prefixLength < nextLines.length &&
    previousLines[prefixLength] === nextLines[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0

  while (
    suffixLength < previousLines.length - prefixLength &&
    suffixLength < nextLines.length - prefixLength &&
    previousLines[previousLines.length - 1 - suffixLength] ===
      nextLines[nextLines.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  return [
    ...previousLines.slice(0, prefixLength).map((value) => ({
      type: "equal" as const,
      value,
    })),
    ...previousLines
      .slice(prefixLength, previousLines.length - suffixLength)
      .map((value) => ({ type: "delete" as const, value })),
    ...nextLines
      .slice(prefixLength, nextLines.length - suffixLength)
      .map((value) => ({ type: "add" as const, value })),
    ...previousLines
      .slice(previousLines.length - suffixLength)
      .map((value) => ({ type: "equal" as const, value })),
  ]
}

function createLineOperations(
  previousContent: string,
  nextContent: string
): DiffOperation[] {
  const previousLines = splitLines(previousContent)
  const nextLines = splitLines(nextContent)
  const rowLength = nextLines.length + 1
  const cellCount = (previousLines.length + 1) * rowLength

  if (cellCount > MAX_LCS_CELLS) {
    return createFallbackOperations(previousLines, nextLines)
  }

  const lcs = new Uint32Array(cellCount)

  for (
    let previousIndex = previousLines.length - 1;
    previousIndex >= 0;
    previousIndex -= 1
  ) {
    for (let nextIndex = nextLines.length - 1; nextIndex >= 0; nextIndex -= 1) {
      const index = previousIndex * rowLength + nextIndex

      lcs[index] =
        previousLines[previousIndex] === nextLines[nextIndex]
          ? lcs[(previousIndex + 1) * rowLength + nextIndex + 1] + 1
          : Math.max(
              lcs[(previousIndex + 1) * rowLength + nextIndex],
              lcs[previousIndex * rowLength + nextIndex + 1]
            )
    }
  }

  const operations: DiffOperation[] = []
  let previousIndex = 0
  let nextIndex = 0

  while (previousIndex < previousLines.length || nextIndex < nextLines.length) {
    if (
      previousIndex < previousLines.length &&
      nextIndex < nextLines.length &&
      previousLines[previousIndex] === nextLines[nextIndex]
    ) {
      operations.push({
        type: "equal",
        value: previousLines[previousIndex],
      })
      previousIndex += 1
      nextIndex += 1
      continue
    }

    if (
      nextIndex < nextLines.length &&
      (previousIndex >= previousLines.length ||
        lcs[previousIndex * rowLength + nextIndex + 1] >=
          lcs[(previousIndex + 1) * rowLength + nextIndex])
    ) {
      operations.push({ type: "add", value: nextLines[nextIndex] })
      nextIndex += 1
      continue
    }

    operations.push({ type: "delete", value: previousLines[previousIndex] })
    previousIndex += 1
  }

  return operations
}

function quoteGitPath(path: string) {
  const prefixedPath = path

  return /[\s"\\]/.test(prefixedPath)
    ? JSON.stringify(prefixedPath)
    : prefixedPath
}

function renderOperation(operation: DiffOperation) {
  const prefix =
    operation.type === "add" ? "+" : operation.type === "delete" ? "-" : " "
  const hasTrailingNewline = operation.value.endsWith("\n")
  const value = hasTrailingNewline
    ? operation.value.slice(0, -1)
    : operation.value

  return `${prefix}${value}\n${
    hasTrailingNewline ? "" : "\\ No newline at end of file\n"
  }`
}

function formatRange(start: number, count: number) {
  return `${start},${count}`
}

function renderHunks(
  operations: DiffOperation[],
  previousContent: string | null,
  nextContent: string | null
) {
  const changedIndexes = operations.flatMap((operation, index) =>
    operation.type === "equal" ? [] : [index]
  )

  if (changedIndexes.length === 0) {
    return ""
  }

  const ranges: Array<{ start: number; end: number }> = []

  for (const changedIndex of changedIndexes) {
    const start = Math.max(0, changedIndex - DIFF_CONTEXT_LINES)
    const end = Math.min(
      operations.length,
      changedIndex + DIFF_CONTEXT_LINES + 1
    )
    const current = ranges.at(-1)

    if (current && start <= current.end) {
      current.end = Math.max(current.end, end)
    } else {
      ranges.push({ start, end })
    }
  }

  const oldLineAt: number[] = []
  const newLineAt: number[] = []
  let oldLine = 1
  let newLine = 1

  for (let index = 0; index <= operations.length; index += 1) {
    oldLineAt[index] = oldLine
    newLineAt[index] = newLine

    const operation = operations[index]

    if (!operation) {
      continue
    }

    if (operation.type !== "add") {
      oldLine += 1
    }

    if (operation.type !== "delete") {
      newLine += 1
    }
  }

  return ranges
    .map(({ start, end }) => {
      const hunk = operations.slice(start, end)
      const oldCount = hunk.filter(
        (operation) => operation.type !== "add"
      ).length
      const newCount = hunk.filter(
        (operation) => operation.type !== "delete"
      ).length
      const rawOldStart = oldLineAt[start]
      const rawNewStart = newLineAt[start]
      const oldStart =
        oldCount === 0
          ? previousContent === null
            ? 0
            : Math.max(0, rawOldStart - 1)
          : rawOldStart
      const newStart =
        newCount === 0
          ? nextContent === null
            ? 0
            : Math.max(0, rawNewStart - 1)
          : rawNewStart

      return `@@ -${formatRange(oldStart, oldCount)} +${formatRange(
        newStart,
        newCount
      )} @@\n${hunk.map(renderOperation).join("")}`
    })
    .join("")
}

export function createUnifiedFileDiff({
  nextContent,
  path,
  previousContent,
}: {
  nextContent: string | null
  path: string
  previousContent: string | null
}) {
  if (previousContent === nextContent) {
    return null
  }

  const oldPath = previousContent === null ? "/dev/null" : `a/${path}`
  const newPath = nextContent === null ? "/dev/null" : `b/${path}`
  const operations = createLineOperations(
    previousContent ?? "",
    nextContent ?? ""
  )
  const header = [
    `diff --git ${quoteGitPath(`a/${path}`)} ${quoteGitPath(`b/${path}`)}`,
    ...(previousContent === null ? ["new file mode 100644"] : []),
    ...(nextContent === null ? ["deleted file mode 100644"] : []),
    `--- ${quoteGitPath(oldPath)}`,
    `+++ ${quoteGitPath(newPath)}`,
  ].join("\n")

  return `${header}\n${renderHunks(operations, previousContent, nextContent)}`
}

function decodeGitQuotedPath(value: string) {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value
  }

  const source = value.slice(1, -1)
  const bytes: number[] = []
  const encoder = new TextEncoder()

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (character !== "\\") {
      bytes.push(...encoder.encode(character))
      continue
    }

    const escape = source[index + 1]

    if (!escape) {
      return null
    }

    if (/[0-7]/.test(escape)) {
      const octal = source.slice(index + 1).match(/^[0-7]{1,3}/)?.[0]

      if (!octal) {
        return null
      }

      bytes.push(Number.parseInt(octal, 8))
      index += octal.length
      continue
    }

    const escapedBytes: Record<string, number> = {
      a: 7,
      b: 8,
      t: 9,
      n: 10,
      v: 11,
      f: 12,
      r: 13,
      '"': 34,
      "\\": 92,
    }
    const byte = escapedBytes[escape]

    if (byte === undefined) {
      return null
    }

    bytes.push(byte)
    index += 1
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bytes)
    )
  } catch {
    return null
  }
}

function readGitPathToken(value: string) {
  const trimmed = value.trim()

  if (!trimmed.startsWith('"')) {
    return trimmed.split(/\s+/)[0] ?? ""
  }

  let escaped = false

  for (let index = 1; index < trimmed.length; index += 1) {
    const character = trimmed[index]

    if (character === '"' && !escaped) {
      return trimmed.slice(0, index + 1)
    }

    escaped = character === "\\" && !escaped
    if (character !== "\\") {
      escaped = false
    }
  }

  return trimmed
}

function normalizePatchPath(value: string) {
  const token = decodeGitQuotedPath(readGitPathToken(value))

  if (!token || token === "/dev/null") {
    return null
  }

  return token.startsWith("a/") || token.startsWith("b/")
    ? token.slice(2)
    : token
}

function splitUnifiedDiff(diff: string) {
  const starts: number[] = []
  const matcher = /^diff --git /gm
  let match: RegExpExecArray | null

  while ((match = matcher.exec(diff))) {
    starts.push(match.index)
  }

  if (starts.length === 0) {
    return diff.trim() ? [diff] : []
  }

  return starts.map((start, index) =>
    diff.slice(start, starts[index + 1] ?? diff.length)
  )
}

function getSectionPath(section: string) {
  const lines = section.split(/\r?\n/)
  const renameTo = lines.find((line) => line.startsWith("rename to "))

  if (renameTo) {
    return normalizePatchPath(renameTo.slice("rename to ".length))
  }

  const newHeader = lines.find((line) => line.startsWith("+++ "))
  const oldHeader = lines.find((line) => line.startsWith("--- "))

  const header = lines.find((line) => line.startsWith("diff --git "))
  const headerPaths = header?.slice("diff --git ".length).trim() ?? ""
  const oldHeaderToken = readGitPathToken(headerPaths)
  const newHeaderToken = readGitPathToken(
    headerPaths.slice(oldHeaderToken.length).trim()
  )

  return (
    (newHeader ? normalizePatchPath(newHeader.slice(4)) : null) ??
    (oldHeader ? normalizePatchPath(oldHeader.slice(4)) : null) ??
    normalizePatchPath(newHeaderToken) ??
    normalizePatchPath(oldHeaderToken)
  )
}

export function parseUnifiedDiffToFileChanges(
  diff: string
): AgentFileChangeEvent[] {
  return splitUnifiedDiff(diff).flatMap((rawSection) => {
    const section = rawSection.trimEnd()
    const path = getSectionPath(section)

    if (!path) {
      return []
    }

    const kind = section.includes("\nnew file mode ")
      ? "create"
      : section.includes("\ndeleted file mode ")
        ? "delete"
        : "edit"

    return [
      {
        type: "file_change" as const,
        path,
        kind,
        status: "complete" as const,
        diff: `${section}\n`,
      },
    ]
  })
}
