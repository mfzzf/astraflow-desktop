import { remark } from "remark"
import remarkGfm from "remark-gfm"

import { parseFilePathHrefTarget } from "@/lib/markdown-file-paths"

export type MarkdownSourceBlock = {
  key: string
  content: string
  kind: string
  streamingSensitive: boolean
}

export type MarkdownRenderBlock = MarkdownSourceBlock & {
  mutable: boolean
}

const danglingMarkdownLink = /\[([^\]\n]+)\]\(([^)\n]+)$/
const danglingMarkdownImage =
  /(^|\n)[^\S\n]*!\[[^\]\n]*(?:\](?:\([^\)\n]*)?)?\s*$/
const privateStreamingMarker = /\uE200[^\uE201]*$/
const leadingWhitespace = /^\s/

function isEscapedMarkdownMarker(text: string, index: number) {
  let slashCount = 0

  for (
    let cursor = index - 1;
    cursor >= 0 && text[cursor] === "\\";
    cursor -= 1
  ) {
    slashCount += 1
  }

  return slashCount % 2 === 1
}

function markdownMarkerTouchesItself(
  text: string,
  index: number,
  marker: string
) {
  return (
    marker.length === 1 &&
    (text[index - 1] === marker || text[index + 1] === marker)
  )
}

function countUnescapedMarkdownMarkers(text: string, marker: string) {
  let count = 0

  for (let cursor = 0; cursor <= text.length - marker.length;) {
    if (
      text.startsWith(marker, cursor) &&
      !isEscapedMarkdownMarker(text, cursor) &&
      !markdownMarkerTouchesItself(text, cursor, marker)
    ) {
      count += 1
      cursor += marker.length
    } else {
      cursor += 1
    }
  }

  return count
}

function getLastUnescapedMarkdownMarker(text: string, marker: string) {
  for (let cursor = text.length - marker.length; cursor >= 0; cursor -= 1) {
    if (
      text.startsWith(marker, cursor) &&
      !isEscapedMarkdownMarker(text, cursor) &&
      !markdownMarkerTouchesItself(text, cursor, marker)
    ) {
      return cursor
    }
  }

  return -1
}

function hasOpenMarkdownFence(text: string) {
  return countUnescapedMarkdownMarkers(text, "```") % 2 === 1
}

function hasOpenInlineMarkdownCode(text: string) {
  let count = 0

  for (let cursor = 0; cursor < text.length;) {
    if (text.startsWith("```", cursor)) {
      cursor += 3

      while (cursor < text.length && !text.startsWith("```", cursor)) {
        cursor += 1
      }

      if (cursor < text.length) {
        cursor += 3
      }

      continue
    }

    if (text[cursor] === "`" && !isEscapedMarkdownMarker(text, cursor)) {
      count += 1
    }

    cursor += 1
  }

  return count % 2 === 1
}

function closeStreamingMarkdownEmphasis(text: string, marker: "*" | "**") {
  if (
    !text.includes(marker) ||
    countUnescapedMarkdownMarkers(text, marker) % 2 === 0
  ) {
    return text
  }

  const index = getLastUnescapedMarkdownMarker(text, marker)

  if (index < 0) {
    return text
  }

  const suffix = text.slice(index + marker.length)

  return suffix.length === 0 ||
    leadingWhitespace.test(suffix) ||
    suffix.includes("\n") ||
    hasOpenInlineMarkdownCode(suffix)
    ? text
    : `${text}${marker}`
}

export type StreamingMarkdownRepair = {
  isCodeFenceOpen: boolean
  markdown: string
}

/**
 * Mirrors ChatGPT Desktop's streaming-tail repair. The temporary closing
 * markers only stabilize parsing while a response is arriving; the source
 * message is never mutated.
 */
export function repairStreamingMarkdown(markdown: string) {
  let value = markdown.replace(privateStreamingMarker, "")

  if (
    value.length === 0 ||
    (value.includes("`") && hasOpenInlineMarkdownCode(value))
  ) {
    return { isCodeFenceOpen: false, markdown: value }
  }

  if (value.includes("```") && hasOpenMarkdownFence(value)) {
    return {
      isCodeFenceOpen: true,
      markdown: value.endsWith("\n") ? `${value}\`\`\`` : `${value}\n\`\`\``,
    }
  }

  if (value.includes("![")) {
    value = value.replace(
      danglingMarkdownImage,
      (_match, prefix: string) => prefix
    )
  }

  if (value.includes("](")) {
    const dangling = value.match(danglingMarkdownLink)

    if (dangling) {
      const href = dangling[2] ?? ""
      value = parseFilePathHrefTarget(href)
        ? value.replace(danglingMarkdownLink, "$1")
        : `${value})`
    }
  }

  value = closeStreamingMarkdownEmphasis(value, "**")
  value = closeStreamingMarkdownEmphasis(value, "*")

  return { isCodeFenceOpen: false, markdown: value }
}

function hashMarkdownBlock(value: string) {
  let hash = 5381

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }

  return (hash >>> 0).toString(36)
}

function looksLikeMarkdownTable(block: string) {
  const lines = block
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return false
  }

  const hasPipeRow = lines[0].includes("|")
  const hasSeparator = /^:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*$/.test(
    lines[1].replace(/^\|/, "").replace(/\|$/, "").trim()
  )

  return hasPipeRow && hasSeparator
}

function hasUnclosedFence(block: string) {
  let openFence: { character: string; length: number } | null = null

  for (const line of block.split("\n")) {
    const match = line.match(/^(?: {0,3})([`~]{3,})/)

    if (!match) {
      continue
    }

    const fence = match[1]
    const character = fence[0]

    if (!openFence) {
      openFence = { character, length: fence.length }
      continue
    }

    if (character === openFence.character && fence.length >= openFence.length) {
      openFence = null
    }
  }

  return Boolean(openFence)
}

export function isHtmlLanguage(language: string) {
  return ["html", "htm"].includes(language.toLowerCase())
}

function getFenceBlockLanguage(block: string) {
  const opener = block.match(/^(?: {0,3})([`~]{3,})([^\n]*)\n/)

  if (!opener) {
    return null
  }

  return {
    fence: opener[1],
    language: opener[2].trim().split(/\s+/)[0] ?? "",
  }
}

function isHtmlFenceBlock(block: string) {
  const opener = getFenceBlockLanguage(block)

  return opener ? isHtmlLanguage(opener.language) : false
}

export function isCompleteHtmlFenceBlock(block: string) {
  const opener = getFenceBlockLanguage(block)

  if (!opener) {
    return false
  }

  if (!isHtmlLanguage(opener.language)) {
    return false
  }

  const lines = block.replace(/\n$/, "").split("\n")
  const closingLine = lines.at(-1)?.trim() ?? ""
  const fenceCharacter = opener.fence[0]

  return (
    closingLine.length >= opener.fence.length &&
    [...closingLine].every((character) => character === fenceCharacter)
  )
}

function isStreamingSensitiveBlock(block: string, kind: string) {
  return (
    kind === "table" ||
    looksLikeMarkdownTable(block) ||
    hasUnclosedFence(block) ||
    isHtmlFenceBlock(block)
  )
}

// The splitter uses the same remark pipeline as the renderer (react-markdown
// + remark-gfm) so block boundaries always match the renderer's own parse.
const markdownBlockParser = remark().use(remarkGfm)

export function parseMarkdownIntoBlocks(
  markdown: string
): MarkdownSourceBlock[] {
  const nodes = markdownBlockParser.parse(markdown).children
  const blocks: MarkdownSourceBlock[] = []
  let offset = 0

  function pushBlock(content: string, kind: string) {
    blocks.push({
      key: `${blocks.length}-${kind}-${hashMarkdownBlock(content)}`,
      content,
      kind,
      streamingSensitive: isStreamingSensitiveBlock(content, kind),
    })
  }

  for (const node of nodes) {
    const start = node.position?.start.offset ?? offset
    const end = node.position?.end.offset ?? start

    // Whitespace between top-level nodes is not covered by any mdast node;
    // emit it as a "space" block so joining all block contents reproduces
    // the source byte-for-byte (the block cache relies on that).
    if (start > offset) {
      pushBlock(markdown.slice(offset, start), "space")
    }

    if (end > start) {
      pushBlock(markdown.slice(start, end), node.type)
    }

    offset = Math.max(offset, end)
  }

  if (offset < markdown.length) {
    pushBlock(markdown.slice(offset), "space")
  }

  return blocks
}

function getStreamingTailStartIndex(blocks: MarkdownSourceBlock[]) {
  if (blocks.length <= 1) {
    return 0
  }

  let tailStartIndex = blocks.length - 1

  for (let index = tailStartIndex; index >= 0; index -= 1) {
    if (!blocks[index].streamingSensitive) {
      break
    }

    tailStartIndex = index
  }

  return tailStartIndex
}

function stripFencedCodeBlocks(markdown: string) {
  const keptLines: string[] = []
  let openFence: { character: string; length: number } | null = null

  for (const line of markdown.split("\n")) {
    const match = line.match(/^(?: {0,3})([`~]{3,})/)

    if (match) {
      const fence = match[1]

      if (!openFence) {
        openFence = { character: fence[0], length: fence.length }
      } else if (
        fence[0] === openFence.character &&
        fence.length >= openFence.length
      ) {
        openFence = null
      }

      continue
    }

    if (!openFence) {
      keptLines.push(line)
    }
  }

  return keptLines.join("\n")
}

const markdownReferenceDefinition = /^ {0,3}\[[^\]\n]+\]:\s*\S+/m

function hasDocumentWideMarkdownReferences(markdown: string) {
  // Only reference *definitions* (`[foo]: https://…`, `[^1]: …`) have
  // document-wide scope: a usage elsewhere in the document changes how the
  // whole thing must be parsed. Bare `[a][b]` sequences (array indexing such
  // as `dp[i][j]`, code samples, …) are literal text when no definition
  // exists, so they must not force whole-document rendering. Fenced code is
  // stripped first because `[x]: y` inside a code block is not a definition.
  return markdownReferenceDefinition.test(stripFencedCodeBlocks(markdown))
}

type StreamingMarkdownBlockCacheState = {
  source: string
  renderedMarkdown: string
  sealedBlocks: MarkdownRenderBlock[]
  sealedLength: number
  pendingStableContent: string
  parsedStableLength: number
  blocks: MarkdownRenderBlock[]
}

export function createStreamingMarkdownBlockCache({
  stableBatchChars = 1_024,
}: {
  stableBatchChars?: number
} = {}) {
  let state: StreamingMarkdownBlockCacheState | null = null

  return {
    read(source: string, repairedMarkdown: string): MarkdownRenderBlock[] {
      if (hasDocumentWideMarkdownReferences(repairedMarkdown)) {
        state = null

        return [
          {
            key: "reference-document",
            content: repairedMarkdown,
            kind: "document",
            streamingSensitive: true,
            mutable: true,
          },
        ]
      }

      if (state?.source === source) {
        return state.blocks
      }

      const reusableState =
        state !== null &&
        source.startsWith(state.source) &&
        state.parsedStableLength <= repairedMarkdown.length
          ? state
          : null
      let sealedBlocks = reusableState?.sealedBlocks ?? []
      let sealedLength = reusableState?.sealedLength ?? 0
      let pendingStableContent = reusableState?.pendingStableContent ?? ""
      let parsedStableLength = reusableState?.parsedStableLength ?? 0
      const tailMarkdown = repairedMarkdown.slice(parsedStableLength)
      const tailBlocks = parseMarkdownIntoBlocks(tailMarkdown)
      const tailStartIndex = getStreamingTailStartIndex(tailBlocks)
      const newlyStableContent = tailBlocks
        .slice(0, tailStartIndex)
        .map((block) => block.content)
        .join("")

      pendingStableContent += newlyStableContent
      parsedStableLength += newlyStableContent.length

      if (pendingStableContent.length >= stableBatchChars) {
        const content = pendingStableContent
        const offset = sealedLength

        sealedBlocks = [
          ...sealedBlocks,
          {
            key: `${offset}-stable-batch-${hashMarkdownBlock(content)}`,
            content,
            kind: "stable-batch",
            streamingSensitive: false,
            mutable: false,
          },
        ]
        sealedLength += content.length
        pendingStableContent = ""
      }

      const tailContent = tailBlocks
        .slice(tailStartIndex)
        .map((block) => block.content)
        .join("")
      const activeContent = pendingStableContent + tailContent
      const blocks = activeContent
        ? [
            ...sealedBlocks,
            {
              key: `tail-${sealedLength}`,
              content: activeContent,
              kind: "stream-tail",
              streamingSensitive: true,
              mutable: true,
            },
          ]
        : sealedBlocks

      state = {
        source,
        renderedMarkdown: repairedMarkdown,
        sealedBlocks,
        sealedLength,
        pendingStableContent,
        parsedStableLength,
        blocks,
      }

      return blocks
    },
    complete(source: string): MarkdownRenderBlock[] {
      if (
        state?.source === source &&
        state.renderedMarkdown === source &&
        !hasDocumentWideMarkdownReferences(source)
      ) {
        const blocks = state.blocks.map((block) =>
          block.mutable ? { ...block, mutable: false } : block
        )

        state = null
        return blocks
      }

      state = null
      return createMarkdownRenderBlocks(source, false)
    },
    reset() {
      state = null
    },
  }
}

export function createMarkdownRenderBlocks(
  markdown: string,
  streaming: boolean
): MarkdownRenderBlock[] {
  if (!streaming) {
    // Reference definitions, footnotes, and similar Markdown constructs have
    // document-wide scope. Completed responses therefore render as one syntax
    // tree instead of isolated lexer tokens.
    return markdown
      ? [
          {
            key: "document",
            content: markdown,
            kind: "document",
            streamingSensitive: false,
            mutable: false,
          },
        ]
      : []
  }

  if (hasDocumentWideMarkdownReferences(markdown)) {
    return [
      {
        key: "reference-document",
        content: markdown,
        kind: "document",
        streamingSensitive: true,
        mutable: true,
      },
    ]
  }

  const blocks = parseMarkdownIntoBlocks(markdown)

  const tailStartIndex = getStreamingTailStartIndex(blocks)
  const stableBlocks = blocks
    .slice(0, tailStartIndex)
    .map((block) => ({ ...block, mutable: false }))
  const tailContent = blocks
    .slice(tailStartIndex)
    .map((block) => block.content)
    .join("")

  if (!tailContent) {
    return stableBlocks
  }

  return [
    ...stableBlocks,
    {
      key: `tail-${tailStartIndex}`,
      content: tailContent,
      kind: "stream-tail",
      streamingSensitive: true,
      mutable: true,
    },
  ]
}
