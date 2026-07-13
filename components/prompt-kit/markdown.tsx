"use client"

import {
  RiCheckLine,
  RiCodeLine,
  RiDownloadLine,
  RiExternalLinkLine,
  RiFileCopyLine,
  RiPlayLine,
  RiSaveLine,
} from "@remixicon/react"
import { marked } from "marked"
import {
  memo,
  type MouseEvent,
  useId,
  useMemo,
  useState,
} from "react"
import ReactMarkdown, { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"

import {
  CodeBlock,
  CodeBlockCode,
  CodeBlockGroup,
} from "@/components/prompt-kit/code-block"
import { StudioFileTypeIcon } from "@/components/studio-file-type-icon"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  getFilePathChipBasename,
  type MarkdownFilePathTarget,
  parseFilePathHrefTarget,
  parseFilePathText,
  remarkFilePathChips,
  resolveMarkdownRelativeFileHref,
} from "@/lib/markdown-file-paths"
import {
  STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
  type StudioOpenMarkdownTargetDetail,
} from "@/lib/studio-markdown-open"
import { cn } from "@/lib/utils"

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  autoPreviewHtml?: boolean
  mediaSaveSessionId?: string | null
  mediaUrlMap?: Record<string, string>
  openLinksInWorkspace?: boolean
  workspaceBaseDirectory?: string | null
  streaming?: boolean
  components?: Partial<Components>
}

type MarkdownSourceBlock = {
  key: string
  content: string
  kind: string
  streamingSensitive: boolean
}

type MarkdownRenderBlock = MarkdownSourceBlock & {
  mutable: boolean
}

const markdownExternalProtocols = new Set([
  "http:",
  "https:",
  "mailto:",
  "vscode:",
  "vscode-insiders:",
])

type StudioMarkdownMediaKind = "image" | "video" | "audio"

type StudioMarkdownMediaRoute = {
  kind: StudioMarkdownMediaKind
  outputId?: string
  contentUrl: string
  downloadUrl: string
  saveUrl?: string | null
  sourceUrl?: string | null
  filename: string
}

const mediaRouteConfig = {
  image: {
    segment: "image-outputs",
    extension: "png",
  },
  video: {
    segment: "video-outputs",
    extension: "mp4",
  },
  audio: {
    segment: "audio-outputs",
    extension: "mp3",
  },
} satisfies Record<
  StudioMarkdownMediaKind,
  { segment: string; extension: string }
>

const externalImageExtensions = new Set([
  "avif",
  "gif",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "webp",
])

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

function withSearchParam(href: string, key: string, value: string) {
  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const url = new URL(href, baseUrl)
    url.searchParams.set(key, value)

    return href.startsWith("/")
      ? `${url.pathname}${url.search}`
      : url.toString()
  } catch {
    const separator = href.includes("?") ? "&" : "?"
    return `${href}${separator}${encodeURIComponent(key)}=${encodeURIComponent(
      value
    )}`
  }
}

function getStudioMarkdownMediaRoute(href: string | undefined | null) {
  const trimmedHref = typeof href === "string" ? href.trim() : ""

  if (!trimmedHref) {
    return null
  }

  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(trimmedHref, baseUrl)
    const match = parsed.pathname.match(
      /^\/api\/studio\/(image-outputs|video-outputs|audio-outputs)\/([^/]+)\/content\/?$/
    )

    if (!match) {
      return null
    }

    const entry = Object.entries(mediaRouteConfig).find(
      ([, config]) => config.segment === match[1]
    )

    if (!entry) {
      return null
    }

    const [kind, config] = entry as [
      StudioMarkdownMediaKind,
      (typeof mediaRouteConfig)[StudioMarkdownMediaKind],
    ]
    const outputId = decodeURIComponent(match[2])
    const contentUrl = trimmedHref.startsWith("http")
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}`

    return {
      kind,
      outputId,
      contentUrl,
      downloadUrl: withSearchParam(contentUrl, "download", "1"),
      saveUrl: `/api/studio/${config.segment}/${encodeURIComponent(outputId)}/save`,
      filename: `${kind}-${outputId}.${config.extension}`,
    } satisfies StudioMarkdownMediaRoute
  } catch {
    return null
  }
}

function getFilenameExtension(filename: string) {
  const extension = filename.split(".").at(-1)?.trim().toLowerCase() ?? ""

  return /^[a-z0-9]{2,8}$/.test(extension) ? extension : ""
}

function getExternalImageFilename(url: URL, alt: string | undefined) {
  const pathName = decodeURIComponent(url.pathname)
  const basename = pathName.split("/").filter(Boolean).at(-1) ?? ""
  const extension = getFilenameExtension(basename) || "png"
  const stem =
    basename.replace(/\.[^.]+$/, "").trim() ||
    alt
      ?.trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") ||
    "image"

  return `${stem.slice(0, 80) || "image"}.${extension}`
}

function getExternalMarkdownImageRoute(
  href: string | undefined | null,
  alt: string | undefined
) {
  const trimmedHref = typeof href === "string" ? href.trim() : ""

  if (!trimmedHref) {
    return null
  }

  try {
    const parsed = new URL(trimmedHref)

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null
    }

    const contentUrl = parsed.toString()

    return {
      kind: "image",
      contentUrl,
      downloadUrl: contentUrl,
      saveUrl: null,
      sourceUrl: contentUrl,
      filename: getExternalImageFilename(parsed, alt),
    } satisfies StudioMarkdownMediaRoute
  } catch {
    return null
  }
}

function isLikelyExternalImageUrl(href: string | undefined | null) {
  if (!href) {
    return false
  }

  try {
    const parsed = new URL(href)
    const extension = getFilenameExtension(parsed.pathname)

    return externalImageExtensions.has(extension)
  } catch {
    return false
  }
}

function getMediaUrlLookupKeys(href: string) {
  const keys = [href]

  try {
    const baseUrl =
      typeof window === "undefined" ? "http://localhost" : window.location.href
    const parsed = new URL(href, baseUrl)

    keys.push(parsed.toString(), `${parsed.origin}${parsed.pathname}`)

    if (href.startsWith("/")) {
      keys.push(parsed.pathname)
    }
  } catch {
    // Use the original href only.
  }

  return keys
}

function resolveMappedMediaUrl(
  href: string | undefined | null,
  mediaUrlMap: Record<string, string> | undefined
) {
  if (!href || !mediaUrlMap) {
    return href ?? undefined
  }

  for (const key of getMediaUrlLookupKeys(href)) {
    const mapped = mediaUrlMap[key]

    if (mapped) {
      return mapped
    }
  }

  return href
}

function getMarkdownTokenKind(token: ReturnType<typeof marked.lexer>[number]) {
  return typeof token.type === "string" ? token.type : "block"
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

function isStreamingSensitiveBlock(block: string, kind: string) {
  return (
    kind === "table" ||
    looksLikeMarkdownTable(block) ||
    hasUnclosedFence(block) ||
    isHtmlFenceBlock(block)
  )
}

export function parseMarkdownIntoBlocks(
  markdown: string
): MarkdownSourceBlock[] {
  const tokens = marked.lexer(markdown)

  return tokens.map((token, index) => {
    const content = token.raw
    const kind = getMarkdownTokenKind(token)

    return {
      key: `${index}-${kind}-${hashMarkdownBlock(content)}`,
      content,
      kind,
      streamingSensitive: isStreamingSensitiveBlock(content, kind),
    }
  })
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

function hasDocumentWideMarkdownReferences(markdown: string) {
  return (
    /^ {0,3}\[[^\]\n]+\]:\s*\S+/m.test(markdown) ||
    /\[[^\]\n]+\]\[[^\]\n]*\]/.test(markdown)
  )
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

function createMarkdownRenderBlocks(
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

function extractLanguage(className?: string): string {
  if (!className) return "plaintext"
  const match = className.match(/language-([^\s]+)/)
  return match ? match[1] : "plaintext"
}

function inferUnlabelledCodeLanguage(code: string) {
  const source = code.trim()

  if (!source) {
    return "plaintext"
  }

  if (/^[\[{]/.test(source)) {
    try {
      JSON.parse(source)
      return "json"
    } catch {
      // Continue with lightweight syntax signals.
    }
  }

  if (/^<!doctype\s+html|^<html\b|^<[A-Za-z][\s\S]*<\/[^>]+>$/i.test(source)) {
    return "html"
  }

  if (/^(?:diff --git|@@ |--- a\/|\+\+\+ b\/)/m.test(source)) {
    return "diff"
  }

  if (/^(?:import|export|interface|type|const|let|function|class)\b/m.test(source)) {
    return /:\s*(?:string|number|boolean|unknown|[A-Z]\w*(?:<[^>]+>)?)/.test(
      source
    )
      ? "typescript"
      : "javascript"
  }

  if (/^(?:from\s+\S+\s+import|import\s+\S+|def\s+\w+|class\s+\w+|print\s*\()/m.test(source)) {
    return "python"
  }

  if (/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH)\b/im.test(source)) {
    return "sql"
  }

  if (/^(?:#!.*\b(?:sh|bash|zsh)|(?:npm|bun|pnpm|yarn|git|curl)\s+)/m.test(source)) {
    return "bash"
  }

  if (/^[.#]?[\w-]+(?:\s+[.#]?[\w-]+)*\s*\{[\s\S]*:[^;{}]+;/m.test(source)) {
    return "css"
  }

  return "plaintext"
}

function getLanguageLabel(language: string) {
  return language === "plaintext" ? "Code" : language.toUpperCase()
}

function isHtmlLanguage(language: string) {
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

function isCompleteHtmlFenceBlock(block: string) {
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

function getOpenableMarkdownUrl(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return null
  }

  // App-served routes (media, file downloads) stay openable via the origin.
  if (trimmedHref.startsWith("/api/")) {
    try {
      const baseUrl =
        typeof window === "undefined"
          ? "http://localhost"
          : window.location.href

      return new URL(trimmedHref, baseUrl).toString()
    } catch {
      return null
    }
  }

  try {
    // Parse without a base URL on purpose: relative hrefs (bare file names,
    // unresolved workspace paths) must not resolve against the app origin —
    // opening that URL just shows the app's own HTML instead of the file.
    const parsed = new URL(
      trimmedHref.startsWith("//") ? `https:${trimmedHref}` : trimmedHref
    )
    return markdownExternalProtocols.has(parsed.protocol)
      ? parsed.toString()
      : null
  } catch {
    return null
  }
}

function getWorkspaceMarkdownTarget(href: string) {
  const trimmedHref = href.trim()

  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return null
  }

  const fileTarget = parseFilePathHrefTarget(trimmedHref)

  if (fileTarget) {
    return fileTarget
  }

  if (trimmedHref.startsWith("/api/")) {
    try {
      const baseUrl =
        typeof window === "undefined"
          ? "http://localhost"
          : window.location.href

      return {
        path: new URL(trimmedHref, baseUrl).toString(),
        line: null,
        column: null,
        endLine: null,
      }
    } catch {
      return null
    }
  }

  try {
    const parsed = new URL(trimmedHref)

    if (!["http:", "https:", "file:"].includes(parsed.protocol)) {
      return null
    }

    return {
      path: parsed.toString(),
      line: null,
      column: null,
      endLine: null,
    }
  } catch {
    return null
  }
}

function openMarkdownTargetInWorkspace(
  href: string,
  source: StudioOpenMarkdownTargetDetail["source"]
) {
  const target = getWorkspaceMarkdownTarget(href)

  if (!target) {
    return false
  }

  window.dispatchEvent(
    new CustomEvent<StudioOpenMarkdownTargetDetail>(
      STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
      {
        detail: {
          href: target.path,
          source,
          line: target.line,
          column: target.column,
          endLine: target.endLine,
        },
      }
    )
  )
  return true
}

function openMarkdownHrefInWorkspace(
  href: string,
  source: StudioOpenMarkdownTargetDetail["source"],
  openableUrl: string | null = null
) {
  if (openMarkdownTargetInWorkspace(href, source)) {
    return
  }

  // External protocols the workspace cannot host (mailto:, vscode:, ...).
  if (openableUrl) {
    openMarkdownLink(openableUrl)
    return
  }

  // Hand the raw href to the workspace handler: it can still resolve
  // relative paths against the project root, and unsupported files land on
  // the "no preview" page instead of navigating the app window.
  window.dispatchEvent(
    new CustomEvent<StudioOpenMarkdownTargetDetail>(
      STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
      { detail: { href, source } }
    )
  )
}

function openMarkdownLink(url: string) {
  if (window.astraflowDesktop?.openExternal) {
    void window.astraflowDesktop.openExternal(url)
    return true
  }

  return Boolean(window.open(url, "_blank", "noopener,noreferrer"))
}

function getFilePathChipLineLabel(target: MarkdownFilePathTarget) {
  if (!target.line) {
    return null
  }

  const column = target.column ? `:${target.column}` : ""
  const range = target.endLine ? `-${target.endLine}` : ""

  return `(line ${target.line}${column}${range})`
}

function getPlainTextChildren(children: React.ReactNode): string | null {
  if (typeof children === "string" || typeof children === "number") {
    return String(children)
  }

  if (!Array.isArray(children)) {
    return null
  }

  let text = ""

  for (const child of children) {
    if (typeof child === "string" || typeof child === "number") {
      text += String(child)
      continue
    }

    return null
  }

  return text || null
}

function FilePathChip({
  target,
  label,
}: {
  target: MarkdownFilePathTarget
  label?: React.ReactNode
}) {
  const lineLabel = getFilePathChipLineLabel(target)

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    window.dispatchEvent(
      new CustomEvent<StudioOpenMarkdownTargetDetail>(
        STUDIO_OPEN_MARKDOWN_TARGET_EVENT,
        {
          detail: {
            href: target.path,
            source: "link",
            line: target.line,
            column: target.column,
            endLine: target.endLine,
          },
        }
      )
    )
  }

  return (
    <button
      type="button"
      title={target.path}
      onClick={handleClick}
      className="markdown-file-reference not-prose"
    >
      <StudioFileTypeIcon path={target.path} size="small" />
      <span className="truncate">
        {label ?? getFilePathChipBasename(target.path)}
      </span>
      {lineLabel ? <span className="shrink-0">{lineLabel}</span> : null}
    </button>
  )
}

function CodeActionButton({
  label,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function MarkdownMediaActions({
  media,
  saveSessionId,
}: {
  media: StudioMarkdownMediaRoute
  saveSessionId?: string | null
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const canSave = Boolean(media.saveUrl || (media.sourceUrl && saveSessionId))

  async function handleSave(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (saving) {
      return
    }

    setSaving(true)

    try {
      const response = media.saveUrl
        ? await fetch(media.saveUrl, { method: "POST" })
        : await fetch("/api/studio/media-url/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: media.filename,
              kind: media.kind,
              sessionId: saveSessionId,
              url: media.sourceUrl,
            }),
          })
      const payload = (await response.json().catch(() => null)) as {
        error?: string
      } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? "Save failed.")
      }

      setSaved(true)
      toast.success("Saved to Files")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <TooltipProvider>
      <span className="not-prose inline-flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              variant="secondary"
              size="icon-sm"
              className="size-8 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
              aria-label="Download"
            >
              <a
                href={media.downloadUrl}
                download={media.filename}
                onClick={(event) => event.stopPropagation()}
              >
                <RiDownloadLine aria-hidden />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">Download</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="secondary"
              size="icon-sm"
              className="size-8 bg-background/90 shadow-sm backdrop-blur hover:bg-background"
              aria-label="Save to Files"
              disabled={!canSave || saving}
              onClick={handleSave}
            >
              {saved ? <RiCheckLine aria-hidden /> : <RiSaveLine aria-hidden />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            {canSave ? "Save to Files" : "Cannot save this image"}
          </TooltipContent>
        </Tooltip>
      </span>
    </TooltipProvider>
  )
}

function MarkdownMediaLink({
  anchorProps,
  children,
  href,
  media,
  onClick,
  openableUrl,
  openLinksInWorkspace,
  saveSessionId,
}: {
  anchorProps: React.AnchorHTMLAttributes<HTMLAnchorElement>
  children: React.ReactNode
  href: string
  media: StudioMarkdownMediaRoute
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
  openableUrl: string | null
  openLinksInWorkspace: boolean
  saveSessionId?: string | null
}) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event)

    if (event.defaultPrevented || event.button !== 0) {
      return
    }

    if (openLinksInWorkspace && !href.startsWith("#")) {
      // Never fall through to anchor navigation — an unresolvable target
      // would navigate the app window to its default HTML page.
      event.preventDefault()
      openMarkdownHrefInWorkspace(href, "link", openableUrl)
      return
    }

    if (openableUrl) {
      if (openMarkdownLink(openableUrl)) {
        event.preventDefault()
      }
      return
    }

    if (!href.startsWith("#")) {
      event.preventDefault()
    }
  }

  return (
    <span className="not-prose inline-flex max-w-full items-center gap-1.5 align-middle">
      <a
        {...anchorProps}
        href={href}
        target={openableUrl ? "_blank" : undefined}
        rel={openableUrl ? "noreferrer" : undefined}
        onClick={handleClick}
      >
        {children}
      </a>
      <MarkdownMediaActions media={media} saveSessionId={saveSessionId} />
    </span>
  )
}

function MarkdownTableFrame({
  children,
  source,
}: {
  children: React.ReactNode
  source: string
}) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(source.trim())
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1100)
  }

  return (
    <div className="chatgpt-table-container not-prose">
      <div className="chatgpt-table-wrapper">
        {children}
        <button
          type="button"
          className="markdown-table-copy"
          aria-label="Copy Markdown table"
          onClick={handleCopy}
        >
          {copied ? (
            <RiCheckLine aria-hidden className="size-3.5" />
          ) : (
            <RiFileCopyLine aria-hidden className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  )
}

function MarkdownCodeBlock({
  code,
  language,
  streaming,
}: {
  code: string
  language: string
  autoPreviewHtml: boolean
  streaming: boolean
}) {
  const canPreview = isHtmlLanguage(language)
  const [view, setView] = useState<"code" | "preview">("code")
  const [copied, setCopied] = useState(false)
  const [expandedPreviewOpen, setExpandedPreviewOpen] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <TooltipProvider>
      <>
        <CodeBlock className="chatgpt-code-block my-3 rounded-xl shadow-none">
          <CodeBlockGroup className="chatgpt-code-header gap-3 border-b px-3 py-0">
          <div className="flex min-w-0 items-center gap-2">
            <RiCodeLine
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
            <span className="truncate text-xs font-medium">
              {getLanguageLabel(language)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canPreview ? (
              <>
                <CodeActionButton
                  label="Show code"
                  className={cn(view === "code" && "bg-secondary")}
                  onClick={() => setView("code")}
                >
                  <RiCodeLine aria-hidden />
                </CodeActionButton>
                <CodeActionButton
                  label="Preview HTML"
                  className={cn(view === "preview" && "bg-secondary")}
                  onClick={() => setView("preview")}
                >
                  <RiPlayLine aria-hidden />
                </CodeActionButton>
                <CodeActionButton
                  label="Open preview"
                  onClick={() => setExpandedPreviewOpen(true)}
                >
                  <RiExternalLinkLine aria-hidden />
                </CodeActionButton>
              </>
            ) : null}
            <CodeActionButton label="Copy code" onClick={handleCopy}>
              {copied ? (
                <RiCheckLine aria-hidden className="text-foreground" />
              ) : (
                <RiFileCopyLine aria-hidden />
              )}
            </CodeActionButton>
          </div>
          </CodeBlockGroup>
          {view === "preview" && canPreview ? (
            <div className="h-[420px] bg-white">
              <iframe
                title="HTML preview"
                sandbox="allow-scripts allow-forms allow-popups"
                srcDoc={code}
                className="size-full border-0 bg-white"
              />
            </div>
          ) : (
            <CodeBlockCode
              code={code}
              language={language}
              streaming={streaming}
              className="chatgpt-code-body"
            />
          )}
        </CodeBlock>

        <Dialog
          open={expandedPreviewOpen}
          onOpenChange={setExpandedPreviewOpen}
        >
          <DialogContent className="flex h-[min(86vh,780px)] w-[min(92vw,1100px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
            <DialogHeader className="border-b px-4 py-3">
              <DialogTitle className="text-sm">HTML preview</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 bg-white">
              <iframe
                title="Expanded HTML preview"
                sandbox="allow-scripts allow-forms allow-popups"
                srcDoc={code}
                className="size-full border-0 bg-white"
              />
            </div>
          </DialogContent>
        </Dialog>
      </>
    </TooltipProvider>
  )
}

function createMarkdownComponents(
  source: string,
  autoPreviewHtml: boolean,
  mediaSaveSessionId: string | null | undefined,
  mediaUrlMap: Record<string, string> | undefined,
  openLinksInWorkspace: boolean,
  workspaceBaseDirectory: string | null | undefined,
  streaming: boolean
): Partial<Components> {
  return {
    p: function ParagraphComponent({ className, ...props }) {
      return (
        <p className={cn("chatgpt-markdown-paragraph", className)} {...props} />
      )
    },
    h1: function HeadingOneComponent({ className, ...props }) {
      return (
        <h1 className={cn("chatgpt-heading heading-1", className)} {...props} />
      )
    },
    h2: function HeadingTwoComponent({ className, ...props }) {
      return (
        <h2 className={cn("chatgpt-heading heading-2", className)} {...props} />
      )
    },
    h3: function HeadingThreeComponent({ className, ...props }) {
      return (
        <h3 className={cn("chatgpt-heading heading-3", className)} {...props} />
      )
    },
    h4: function HeadingFourComponent({ className, ...props }) {
      return (
        <h4 className={cn("chatgpt-heading heading-4", className)} {...props} />
      )
    },
    h5: function HeadingFiveComponent({ className, ...props }) {
      return (
        <h5 className={cn("chatgpt-heading heading-5", className)} {...props} />
      )
    },
    h6: function HeadingSixComponent({ className, ...props }) {
      return (
        <h6 className={cn("chatgpt-heading heading-6", className)} {...props} />
      )
    },
    ul: function UnorderedListComponent({ className, ...props }) {
      return <ul className={cn("chatgpt-list", className)} {...props} />
    },
    ol: function OrderedListComponent({ className, ...props }) {
      return <ol className={cn("chatgpt-list", className)} {...props} />
    },
    blockquote: function BlockquoteComponent({ className, ...props }) {
      return (
        <blockquote
          className={cn("chatgpt-blockquote", className)}
          {...props}
        />
      )
    },
    hr: function RuleComponent({ className, ...props }) {
      return (
        <hr className={cn("chatgpt-markdown-rule", className)} {...props} />
      )
    },
    table: function TableComponent({ children, node, ...props }) {
      const startOffset = node?.position?.start.offset
      const endOffset = node?.position?.end.offset
      const tableSource =
        typeof startOffset === "number" && typeof endOffset === "number"
          ? source.slice(startOffset, endOffset)
          : source

      return (
        <MarkdownTableFrame source={tableSource}>
          <table {...props}>{children}</table>
        </MarkdownTableFrame>
      )
    },
    a: function LinkComponent(props) {
      const { href, children, node, onClick, ...anchorProps } = props
      void node

      const workspaceHref = openLinksInWorkspace
        ? resolveMarkdownRelativeFileHref(href, workspaceBaseDirectory)
        : href
      const filePathTarget = openLinksInWorkspace
        ? parseFilePathHrefTarget(workspaceHref)
        : null

      if (filePathTarget) {
        return <FilePathChip target={filePathTarget} label={children} />
      }

      const linkedFilePathTarget = openLinksInWorkspace
        ? parseFilePathText(getPlainTextChildren(children) ?? "")
        : null

      if (linkedFilePathTarget) {
        return <FilePathChip target={linkedFilePathTarget} />
      }

      const mappedHref = resolveMappedMediaUrl(workspaceHref, mediaUrlMap)
      const openableUrl = mappedHref ? getOpenableMarkdownUrl(mappedHref) : null
      const media =
        getStudioMarkdownMediaRoute(mappedHref) ??
        (isLikelyExternalImageUrl(mappedHref)
          ? getExternalMarkdownImageRoute(mappedHref, undefined)
          : null)

      function handleClick(event: MouseEvent<HTMLAnchorElement>) {
        onClick?.(event)

        if (event.defaultPrevented || event.button !== 0) {
          return
        }

        if (
          openLinksInWorkspace &&
          mappedHref &&
          !mappedHref.startsWith("#")
        ) {
          // Never fall through to anchor navigation — an unresolvable
          // target would navigate the app window to its default HTML page.
          event.preventDefault()
          openMarkdownHrefInWorkspace(mappedHref, "link", openableUrl)
          return
        }

        if (openableUrl) {
          if (openMarkdownLink(openableUrl)) {
            event.preventDefault()
          }
          return
        }

        if (mappedHref && !mappedHref.startsWith("#")) {
          event.preventDefault()
        }
      }

      if (workspaceHref && media) {
        return (
          <MarkdownMediaLink
            anchorProps={anchorProps}
            href={mappedHref ?? workspaceHref}
            media={media}
            onClick={onClick}
            openableUrl={openableUrl}
            openLinksInWorkspace={openLinksInWorkspace}
            saveSessionId={mediaSaveSessionId}
          >
            {children}
          </MarkdownMediaLink>
        )
      }

      return (
        <a
          {...anchorProps}
          href={mappedHref ?? workspaceHref}
          target={openableUrl ? "_blank" : undefined}
          rel={openableUrl ? "noreferrer" : undefined}
          onClick={handleClick}
        >
          {children}
        </a>
      )
    },
    img: function ImageComponent(props) {
      const { src, alt, node, onClick, ...imageProps } = props
      void node
      const imageSrc = typeof src === "string" ? src : undefined
      const workspaceImageSrc = openLinksInWorkspace
        ? resolveMarkdownRelativeFileHref(imageSrc, workspaceBaseDirectory)
        : imageSrc
      const resolvedImageSrc = resolveMappedMediaUrl(
        workspaceImageSrc,
        mediaUrlMap
      )
      const media =
        getStudioMarkdownMediaRoute(resolvedImageSrc) ??
        getExternalMarkdownImageRoute(resolvedImageSrc, alt ?? undefined)

      function handleClick(event: MouseEvent<HTMLImageElement>) {
        onClick?.(event)

        if (
          event.defaultPrevented ||
          !openLinksInWorkspace ||
          !workspaceImageSrc ||
          !openMarkdownTargetInWorkspace(workspaceImageSrc, "image")
        ) {
          return
        }

        event.preventDefault()
      }

      if (media) {
        return (
          <span className="not-prose group relative my-3 block w-fit max-w-full overflow-hidden rounded-xl border bg-card shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...imageProps}
              src={resolvedImageSrc}
              alt={alt ?? ""}
              className={cn(
                "chatgpt-markdown-image m-0 max-h-[min(68vh,720px)] max-w-full cursor-zoom-in object-contain",
                typeof imageProps.className === "string" && imageProps.className
              )}
              onClick={handleClick}
            />
            <span className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <MarkdownMediaActions
                media={media}
                saveSessionId={mediaSaveSessionId}
              />
            </span>
          </span>
        )
      }

      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...imageProps}
          src={resolvedImageSrc ?? src}
          alt={alt ?? ""}
          className={cn(
            "chatgpt-markdown-image cursor-zoom-in",
            typeof imageProps.className === "string" && imageProps.className
          )}
          onClick={handleClick}
        />
      )
    },
    code: function CodeComponent({ className, children, node, ...props }) {
      const hasLanguage = Boolean(className?.includes("language-"))
      const isInline =
        !hasLanguage &&
        (!node?.position?.start.line ||
          node?.position?.start.line === node?.position?.end.line)

      if (isInline) {
        const inlineText = getPlainTextChildren(children)
        const inlineFileTarget =
          openLinksInWorkspace && inlineText
            ? parseFilePathHrefTarget(inlineText)
            : null

        if (inlineFileTarget) {
          return <FilePathChip target={inlineFileTarget} label={children} />
        }

        return (
          <code className={cn("chatgpt-inline-code", className)} {...props}>
            {children}
          </code>
        )
      }

      const code = String(children).replace(/\n$/, "")
      const declaredLanguage = extractLanguage(className)
      const language =
        declaredLanguage === "plaintext"
          ? inferUnlabelledCodeLanguage(code)
          : declaredLanguage

      return (
        <MarkdownCodeBlock
          code={code}
          language={language}
          autoPreviewHtml={autoPreviewHtml}
          streaming={streaming}
        />
      )
    },
    pre: function PreComponent({ children }) {
      return <>{children}</>
    },
  }
}

const MarkdownBlockRenderer = memo(
  function MarkdownBlockRenderer({
    content,
    autoPreviewHtml,
    mediaSaveSessionId,
    mediaUrlMap,
    openLinksInWorkspace,
    workspaceBaseDirectory,
    streaming,
    components,
  }: {
    content: string
    autoPreviewHtml: boolean
    mediaSaveSessionId?: string | null
    mediaUrlMap?: Record<string, string>
    openLinksInWorkspace: boolean
    workspaceBaseDirectory?: string | null
    streaming: boolean
    components?: Partial<Components>
  }) {
    const markdownComponents = useMemo(
      () => ({
        ...createMarkdownComponents(
          content,
          autoPreviewHtml,
          mediaSaveSessionId,
          mediaUrlMap,
          openLinksInWorkspace,
          workspaceBaseDirectory,
          streaming
        ),
        ...components,
      }),
      [
        autoPreviewHtml,
        components,
        content,
        mediaSaveSessionId,
        mediaUrlMap,
        openLinksInWorkspace,
        workspaceBaseDirectory,
        streaming,
      ]
    )

    const remarkPlugins = useMemo(
      () =>
        openLinksInWorkspace ? [remarkGfm, remarkFilePathChips] : [remarkGfm],
      [openLinksInWorkspace]
    )
    return (
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        components={markdownComponents}
      >
        {content}
      </ReactMarkdown>
    )
  },
  function propsAreEqual(prevProps, nextProps) {
    return (
      prevProps.content === nextProps.content &&
      prevProps.autoPreviewHtml === nextProps.autoPreviewHtml &&
      prevProps.mediaSaveSessionId === nextProps.mediaSaveSessionId &&
      prevProps.mediaUrlMap === nextProps.mediaUrlMap &&
      prevProps.openLinksInWorkspace === nextProps.openLinksInWorkspace &&
      prevProps.workspaceBaseDirectory === nextProps.workspaceBaseDirectory &&
      prevProps.streaming === nextProps.streaming &&
      prevProps.components === nextProps.components
    )
  }
)

MarkdownBlockRenderer.displayName = "MarkdownBlockRenderer"

function MarkdownComponent({
  children,
  id,
  className,
  autoPreviewHtml = true,
  mediaSaveSessionId,
  mediaUrlMap,
  openLinksInWorkspace = false,
  workspaceBaseDirectory,
  streaming = false,
  components,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  const [blockCache] = useState(createStreamingMarkdownBlockCache)

  const repaired = useMemo<StreamingMarkdownRepair>(
    () =>
      streaming
        ? repairStreamingMarkdown(children)
        : { isCodeFenceOpen: false, markdown: children },
    [children, streaming]
  )
  const blocks = useMemo(() => {
    if (streaming) {
      return blockCache.read(children, repaired.markdown)
    }

    return blockCache.complete(repaired.markdown)
  }, [blockCache, children, repaired.markdown, streaming])

  return (
    <div
      className={cn("chatgpt-markdown", streaming && "is-streaming", className)}
      data-code-fence-open={repaired.isCodeFenceOpen ? "true" : "false"}
    >
      {blocks.map((block) => (
        <MarkdownBlockRenderer
          key={`${blockId}-${block.key}`}
          content={block.content}
          autoPreviewHtml={
            autoPreviewHtml &&
            !block.mutable &&
            isCompleteHtmlFenceBlock(block.content)
          }
          mediaSaveSessionId={mediaSaveSessionId}
          mediaUrlMap={mediaUrlMap}
          openLinksInWorkspace={openLinksInWorkspace}
          workspaceBaseDirectory={workspaceBaseDirectory}
          streaming={block.mutable}
          components={components}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown, MarkdownBlockRenderer }
