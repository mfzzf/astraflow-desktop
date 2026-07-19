const INLINE_MATH_HINT_PATTERN = /[\\^_=+\-*/<>()[\]{}]/
const ALL_CAPS_DOLLAR_IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9_]{1,31}$/
const LITERAL_DOLLAR_PLACEHOLDER = "\uE000"
const ESCAPED_DOLLAR_PLACEHOLDER = "\uE001\uE002"

function isLineStart(value: string, index: number) {
  return index === 0 || value[index - 1] === "\n"
}

function matchFenceDelimiter(value: string, index: number) {
  if (!isLineStart(value, index)) return null

  const marker = value[index]
  if (marker !== "`" && marker !== "~") return null

  let cursor = index
  while (value[cursor] === marker) cursor += 1

  return cursor - index >= 3
    ? { marker: marker as "`" | "~", length: cursor - index }
    : null
}

function findFenceEndIndex(
  value: string,
  index: number,
  marker: "`" | "~",
  length: number
) {
  let cursor = value.indexOf("\n", index)
  if (cursor === -1) return value.length
  cursor += 1

  while (cursor < value.length) {
    if (isLineStart(value, cursor) && value[cursor] === marker) {
      let markerEnd = cursor
      while (value[markerEnd] === marker) markerEnd += 1
      if (markerEnd - cursor >= length) {
        const lineEnd = value.indexOf("\n", markerEnd)
        return lineEnd === -1 ? value.length : lineEnd + 1
      }
    }

    const nextLine = value.indexOf("\n", cursor)
    if (nextLine === -1) return value.length
    cursor = nextLine + 1
  }

  return value.length
}

function findInlineCodeEndIndex(value: string, index: number, length: number) {
  let cursor = index + length

  while (cursor < value.length) {
    if (value[cursor] !== "`") {
      cursor += 1
      continue
    }

    let markerEnd = cursor
    while (value[markerEnd] === "`") markerEnd += 1
    if (markerEnd - cursor === length) return markerEnd
    cursor = markerEnd
  }

  return value.length
}

function looksLikeInlineMath(content: string) {
  const trimmed = content.trim()
  if (!trimmed || ALL_CAPS_DOLLAR_IDENTIFIER_PATTERN.test(trimmed)) return false
  if (INLINE_MATH_HINT_PATTERN.test(trimmed)) return true
  return /^[A-Za-z][A-Za-z0-9]{0,15}$/.test(trimmed)
}

function findInlineMathClosingDollar(value: string, index: number) {
  let cursor = index
  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      cursor += 2
      continue
    }
    if (value[cursor] === "$") {
      const previous = value[cursor - 1]
      return previous && !/\s/.test(previous) ? cursor : -1
    }
    cursor += 1
  }
  return -1
}

function protectLiteralDollarsInPlainText(value: string) {
  let result = ""
  let cursor = 0

  while (cursor < value.length) {
    if (value[cursor] === "\\" && value[cursor + 1] === "$") {
      result += ESCAPED_DOLLAR_PLACEHOLDER
      cursor += 2
      continue
    }

    if (value.startsWith("$$", cursor)) {
      const closingIndex = value.indexOf("$$", cursor + 2)
      if (closingIndex === -1) {
        result += `${LITERAL_DOLLAR_PLACEHOLDER}${LITERAL_DOLLAR_PLACEHOLDER}`
        cursor += 2
        continue
      }
      result += value.slice(cursor, closingIndex + 2)
      cursor = closingIndex + 2
      continue
    }

    if (value[cursor] === "$") {
      const next = value[cursor + 1]
      if (!next || /\s|\d/.test(next)) {
        result += LITERAL_DOLLAR_PLACEHOLDER
        cursor += 1
        continue
      }

      const closingIndex = findInlineMathClosingDollar(value, cursor + 1)
      if (closingIndex === -1) {
        result += LITERAL_DOLLAR_PLACEHOLDER
        cursor += 1
        continue
      }

      const content = value.slice(cursor + 1, closingIndex)
      result += looksLikeInlineMath(content)
        ? `$${content}$`
        : `${LITERAL_DOLLAR_PLACEHOLDER}${content}${LITERAL_DOLLAR_PLACEHOLDER}`
      cursor = closingIndex + 1
      continue
    }

    result += value[cursor]
    cursor += 1
  }

  return result
}

function findBalancedEnd(
  value: string,
  startIndex: number,
  opening: string,
  closing: string
) {
  let depth = 0
  let cursor = startIndex

  while (cursor < value.length) {
    if (value[cursor] === "\\") {
      cursor += 2
      continue
    }
    if (value[cursor] === opening) depth += 1
    if (value[cursor] === closing) {
      depth -= 1
      if (depth === 0) return cursor
    }
    cursor += 1
  }

  return -1
}

function findInlineMarkdownLinkEnd(value: string, index: number) {
  const bracketStart =
    value[index] === "!" && value[index + 1] === "[" ? index + 1 : index
  if (value[bracketStart] !== "[") return -1

  const bracketEnd = findBalancedEnd(value, bracketStart, "[", "]")
  if (bracketEnd === -1 || value[bracketEnd + 1] !== "(") return -1

  const parenEnd = findBalancedEnd(value, bracketEnd + 1, "(", ")")
  return parenEnd === -1 ? -1 : parenEnd + 1
}

function protectLiteralDollarsInMarkdownLinks(value: string) {
  let result = ""
  let cursor = 0

  while (cursor < value.length) {
    const isLinkStart =
      value[cursor] === "[" ||
      (value[cursor] === "!" && value[cursor + 1] === "[")
    if (!isLinkStart) {
      const nextLinkStart = value.indexOf("[", cursor)
      const nextImageStart = value.indexOf("![", cursor)
      const candidates = [nextLinkStart, nextImageStart].filter(
        (candidate) => candidate >= 0
      )
      const nextIndex =
        candidates.length > 0 ? Math.min(...candidates) : value.length
      result += protectLiteralDollarsInPlainText(
        value.slice(cursor, nextIndex)
      )
      cursor = nextIndex
      continue
    }

    const linkEnd = findInlineMarkdownLinkEnd(value, cursor)
    if (linkEnd === -1) {
      result += protectLiteralDollarsInPlainText(value[cursor] ?? "")
      cursor += 1
      continue
    }

    result += value
      .slice(cursor, linkEnd)
      .replaceAll("$", LITERAL_DOLLAR_PLACEHOLDER)
    cursor = linkEnd
  }

  return result
}

// Ported from Synara: protect currency, shell variables, links, and code spans
// before remark-math sees them while preserving genuine inline/display math.
export function protectLiteralMarkdownDollars(value: string) {
  let result = ""
  let cursor = 0

  while (cursor < value.length) {
    const fence = matchFenceDelimiter(value, cursor)
    if (fence) {
      const end = findFenceEndIndex(
        value,
        cursor,
        fence.marker,
        fence.length
      )
      result += value.slice(cursor, end)
      cursor = end
      continue
    }

    if (value[cursor] === "`") {
      let markerEnd = cursor
      while (value[markerEnd] === "`") markerEnd += 1
      const end = findInlineCodeEndIndex(value, cursor, markerEnd - cursor)
      result += value.slice(cursor, end)
      cursor = end
      continue
    }

    let nextCodeIndex = cursor
    while (nextCodeIndex < value.length) {
      if (
        value[nextCodeIndex] === "`" ||
        matchFenceDelimiter(value, nextCodeIndex)
      ) {
        break
      }
      nextCodeIndex += 1
    }

    result += protectLiteralDollarsInMarkdownLinks(
      value.slice(cursor, nextCodeIndex)
    )
    cursor = nextCodeIndex
  }

  return result
}

export function restoreLiteralDollarPlaceholders(value: string) {
  return value
    .replaceAll(ESCAPED_DOLLAR_PLACEHOLDER, "$")
    .replaceAll(LITERAL_DOLLAR_PLACEHOLDER, "$")
    .replaceAll(encodeURIComponent(ESCAPED_DOLLAR_PLACEHOLDER), "$")
    .replaceAll(encodeURIComponent(LITERAL_DOLLAR_PLACEHOLDER), "$")
}

function restoreLiteralDollarsInNode(node: unknown): void {
  if (!node || typeof node !== "object") return

  if (
    "type" in node &&
    node.type === "text" &&
    "value" in node &&
    typeof node.value === "string"
  ) {
    node.value = restoreLiteralDollarPlaceholders(node.value)
  }

  if ("children" in node && Array.isArray(node.children)) {
    for (const child of node.children) restoreLiteralDollarsInNode(child)
  }
}

export function rehypeRestoreLiteralDollars() {
  return (tree: unknown) => restoreLiteralDollarsInNode(tree)
}
