import {
  STUDIO_SPECIAL_CODE_FILE_NAMES,
  isStudioFilePreviewable,
} from "@/lib/studio-file-support"

export const FILE_PATH_CHIP_PROTOCOL = "astraflow-file:"

export type MarkdownFilePathTarget = {
  path: string
  line: number | null
  endLine: number | null
  column?: number | null
}

export function encodeFilePathChipHref(target: MarkdownFilePathTarget) {
  const line = target.line
    ? `?line=${target.line}${target.endLine ? `-${target.endLine}` : ""}${target.column ? `&column=${target.column}` : ""}`
    : ""

  return `${FILE_PATH_CHIP_PROTOCOL}${encodeURIComponent(target.path)}${line}`
}

export function parseFilePathChipHref(
  href: string | null | undefined
): MarkdownFilePathTarget | null {
  if (!href?.startsWith(FILE_PATH_CHIP_PROTOCOL)) {
    return null
  }

  const rest = href.slice(FILE_PATH_CHIP_PROTOCOL.length)
  const queryIndex = rest.indexOf("?")
  const encodedPath = queryIndex === -1 ? rest : rest.slice(0, queryIndex)
  const query = queryIndex === -1 ? "" : rest.slice(queryIndex + 1)

  let path: string

  try {
    path = decodeURIComponent(encodedPath)
  } catch {
    return null
  }

  if (!path.trim()) {
    return null
  }

  const lineMatch = /(?:^|&)line=(\d+)(?:-(\d+))?/.exec(query)
  const columnMatch = /(?:^|&)column=(\d+)/.exec(query)
  const line = lineMatch ? Number.parseInt(lineMatch[1], 10) : null
  const endLine = lineMatch?.[2] ? Number.parseInt(lineMatch[2], 10) : null
  const column = columnMatch ? Number.parseInt(columnMatch[1], 10) : null

  return {
    path,
    line: Number.isFinite(line) && line ? line : null,
    endLine: Number.isFinite(endLine) && endLine ? endLine : null,
    column: Number.isFinite(column) && column ? column : null,
  }
}

export function getFilePathChipBasename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export function getFilePathChipExtension(path: string) {
  const basename = getFilePathChipBasename(path)

  return basename.includes(".")
    ? (basename.split(".").at(-1)?.toLowerCase() ?? "")
    : ""
}

// Codex-style citation: 【F:path/to/file.ts†L12-L20】 (line range optional).
const CODEX_CITATION_SOURCE = String.raw`【F:([^†】\n]+?)(?:†L(\d+)(?:[-–]L?(\d+))?)?】`

// A path is either:
// - absolute / home / dot-relative / plain relative with at least one "/",
//   whose last segment carries a file extension, or
// - a bare filename with extension, only when an explicit "(line N)" marker
//   follows (too ambiguous otherwise).
const PATH_WITH_SLASH_SOURCE = String.raw`@?(?:~\/|\.{1,2}\/|\/)?(?:[\w.@+-]+\/)+[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,8}`
const WINDOWS_PATH_SOURCE = String.raw`[A-Za-z]:[\\/](?:[^\\/:*?"<>|\r\n]+[\\/])*[^\\/:*?"<>|\r\n]+\.[A-Za-z0-9]{1,8}`
const BARE_FILENAME_SOURCE = String.raw`[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,8}(?=\s*[(（]lines?\s)`
const LINE_SUFFIX_SOURCE = String.raw`(?::(\d+)(?::(\d+))?(?:-(\d+))?|#L(\d+)(?:C(\d+))?(?:-L?(\d+))?)?(?:\s*[(（]lines?\s+(\d+)(?:\s*[-–~]\s*(\d+))?[)）])?`

const FILE_PATH_TEXT_PATTERN = new RegExp(
  `${CODEX_CITATION_SOURCE}|(?<![\\w/.@-])(${PATH_WITH_SLASH_SOURCE}|${WINDOWS_PATH_SOURCE}|${BARE_FILENAME_SOURCE})${LINE_SUFFIX_SOURCE}`,
  "g"
)

const FILE_PATH_EXACT_PATTERN = new RegExp(
  `^(?:${CODEX_CITATION_SOURCE}|(${PATH_WITH_SLASH_SOURCE}|${WINDOWS_PATH_SOURCE}|${BARE_FILENAME_SOURCE})${LINE_SUFFIX_SOURCE})$`
)

function parseLineNumber(value: string | undefined) {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseLineRange(value: string | null | undefined) {
  const match = value?.match(/^L?(\d+)(?:C(\d+))?(?:[-–]L?(\d+))?$/i)
  const line = parseLineNumber(match?.[1])
  const column = parseLineNumber(match?.[2])
  const endLine = parseLineNumber(match?.[3])

  return {
    line,
    column,
    endLine: endLine && line && endLine > line ? endLine : null,
  }
}

function parseHrefLineTarget(search: string, hash: string) {
  const queryLineMatch = /(?:^|&)line=(\d+)(?:[-–](\d+))?/.exec(
    search.replace(/^\?/, "")
  )

  if (queryLineMatch) {
    const line = parseLineNumber(queryLineMatch[1])
    const endLine = parseLineNumber(queryLineMatch[2])
    const column = parseLineNumber(
      /(?:^|&)column=(\d+)/.exec(search.replace(/^\?/, ""))?.[1]
    )

    return {
      line,
      column,
      endLine: endLine && line && endLine > line ? endLine : null,
    }
  }

  return parseLineRange(hash.replace(/^#/, ""))
}

function stripHrefLineDecorators(href: string) {
  const hashIndex = href.indexOf("#")
  const searchIndex = href.indexOf("?")
  const splitIndex =
    hashIndex === -1
      ? searchIndex
      : searchIndex === -1
        ? hashIndex
        : Math.min(hashIndex, searchIndex)

  if (splitIndex === -1) {
    return { path: href, search: "", hash: "" }
  }

  const path = href.slice(0, splitIndex)
  const suffix = href.slice(splitIndex)
  const nextSearchIndex = suffix.indexOf("?")
  const nextHashIndex = suffix.indexOf("#")
  const search =
    nextSearchIndex === -1
      ? ""
      : suffix.slice(
          nextSearchIndex,
          nextHashIndex === -1 ? undefined : nextHashIndex
        )
  const hash = nextHashIndex === -1 ? "" : suffix.slice(nextHashIndex)

  return { path, search, hash }
}

function decodeFilePath(path: string) {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function parseFileSchemeHrefTarget(
  href: string,
  protocol: "file:" | "sandbox:"
): MarkdownFilePathTarget | null {
  try {
    const parsed = new URL(href)

    if (parsed.protocol !== protocol) {
      return null
    }

    const { line, column, endLine } = parseHrefLineTarget(
      parsed.search,
      parsed.hash
    )
    const path = decodeFilePath(parsed.pathname).replace(
      /^\/([A-Za-z]:[\/\\])/,
      "$1"
    )

    return path.trim() ? { path, line, column, endLine } : null
  } catch {
    return null
  }
}

export function resolveMarkdownRelativeFileHref(
  href: string | null | undefined,
  baseDirectory: string | null | undefined
) {
  const trimmedHref = href?.trim()
  const trimmedBase = baseDirectory?.trim()

  if (!trimmedHref || !trimmedBase || trimmedHref.startsWith("#")) {
    return trimmedHref ?? ""
  }

  const { path, search, hash } = stripHrefLineDecorators(trimmedHref)

  if (
    !path ||
    path.startsWith("/") ||
    path.startsWith("~") ||
    path.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    /^[a-z][a-z\d+.-]*:/i.test(path)
  ) {
    return trimmedHref
  }

  const normalizedBase = trimmedBase.replaceAll("\\", "/")
  const absolutePrefix = normalizedBase.startsWith("/") ? "/" : ""
  const segments = normalizedBase.split("/").filter(Boolean)
  const rootFloor = /^[A-Za-z]:$/.test(segments[0] ?? "") ? 1 : 0

  for (const rawSegment of decodeFilePath(path).replaceAll("\\", "/").split("/")) {
    if (!rawSegment || rawSegment === ".") {
      continue
    }

    if (rawSegment === "..") {
      if (segments.length <= rootFloor) {
        return trimmedHref
      }

      segments.pop()
      continue
    }

    if (rawSegment.includes("\0")) {
      return trimmedHref
    }

    segments.push(rawSegment)
  }

  return `${absolutePrefix}${segments.join("/")}${search}${hash}`
}

function hasOpenableFileExtension(path: string) {
  const extension = getFilePathChipExtension(path)

  if (extension) {
    return isStudioFilePreviewable(path)
  }

  const basename = getFilePathChipBasename(path).toLowerCase()

  return (
    STUDIO_SPECIAL_CODE_FILE_NAMES.has(basename) ||
    basename.startsWith(".env.")
  )
}

function buildTargetFromMatch(match: RegExpExecArray) {
  const [, citationPath, citationLine, citationEndLine, path, ...lineGroups] =
    match
  const targetPath = (citationPath ?? path)?.trim().replace(/^@/, "")

  if (!targetPath) {
    return null
  }

  const line =
    parseLineNumber(citationLine) ??
    parseLineNumber(lineGroups[0]) ??
    parseLineNumber(lineGroups[3]) ??
    parseLineNumber(lineGroups[6])
  const column =
    parseLineNumber(lineGroups[1]) ?? parseLineNumber(lineGroups[4])
  const endLine =
    parseLineNumber(citationEndLine) ??
    parseLineNumber(lineGroups[2]) ??
    parseLineNumber(lineGroups[5]) ??
    parseLineNumber(lineGroups[7])

  return {
    path: targetPath,
    line,
    column,
    endLine: endLine && line && endLine > line ? endLine : null,
  } satisfies MarkdownFilePathTarget
}

export function parseFilePathText(value: string) {
  const match = FILE_PATH_EXACT_PATTERN.exec(value.trim())

  return match ? buildTargetFromMatch(match) : null
}

export function parseFilePathHrefTarget(
  href: string | null | undefined
): MarkdownFilePathTarget | null {
  const trimmedHref = href?.trim()

  if (!trimmedHref || trimmedHref.startsWith("#")) {
    return null
  }

  const chipTarget = parseFilePathChipHref(trimmedHref)

  if (chipTarget) {
    return chipTarget
  }

  if (trimmedHref.startsWith("/api/")) {
    return null
  }

  if (/^file:/i.test(trimmedHref)) {
    return parseFileSchemeHrefTarget(trimmedHref, "file:")
  }

  // Chat models commonly use ChatGPT-style sandbox: links for generated
  // files. In AstraFlow local mode those paths refer to real workspace files,
  // so treat the scheme as an explicit file reference instead of allowing an
  // unsupported browser navigation that only flashes the current view.
  if (/^sandbox:/i.test(trimmedHref)) {
    return parseFileSchemeHrefTarget(trimmedHref, "sandbox:")
  }

  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(trimmedHref)

  if (!isWindowsPath && /^[a-z][a-z\d+.-]*:/i.test(trimmedHref)) {
    return null
  }

  const textTarget = parseFilePathText(trimmedHref)

  if (textTarget) {
    return textTarget
  }

  const { path, search, hash } = stripHrefLineDecorators(trimmedHref)

  if (!path || !hasOpenableFileExtension(path)) {
    return null
  }

  const { line, column, endLine } = parseHrefLineTarget(search, hash)

  return {
    path: decodeFilePath(path),
    line,
    column,
    endLine,
  }
}

type MdastNode = {
  type: string
  value?: string
  url?: string
  title?: string | null
  children?: MdastNode[]
}

const SKIPPED_PARENT_TYPES = new Set([
  "link",
  "linkReference",
  "definition",
  "code",
  "html",
])

function createChipLinkNode(
  target: MarkdownFilePathTarget,
  label: string
): MdastNode {
  return {
    type: "link",
    url: encodeFilePathChipHref(target),
    title: null,
    children: [{ type: "text", value: label }],
  }
}

function splitTextNode(node: MdastNode): MdastNode[] | null {
  const value = node.value

  if (!value || !/[/【]|\.[A-Za-z0-9]/.test(value)) {
    return null
  }

  FILE_PATH_TEXT_PATTERN.lastIndex = 0

  const parts: MdastNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = FILE_PATH_TEXT_PATTERN.exec(value))) {
    const target = buildTargetFromMatch(match)

    if (!target) {
      continue
    }

    if (match.index > lastIndex) {
      parts.push({ type: "text", value: value.slice(lastIndex, match.index) })
    }

    parts.push(createChipLinkNode(target, match[0]))
    lastIndex = match.index + match[0].length
  }

  if (parts.length === 0) {
    return null
  }

  if (lastIndex < value.length) {
    parts.push({ type: "text", value: value.slice(lastIndex) })
  }

  return parts
}

function transformChildren(node: MdastNode) {
  const children = node.children

  if (!children) {
    return
  }

  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]

    if (SKIPPED_PARENT_TYPES.has(child.type)) {
      continue
    }

    if (child.type === "text") {
      const replacement = splitTextNode(child)

      if (replacement) {
        children.splice(index, 1, ...replacement)
      }
      continue
    }

    if (child.type === "inlineCode" && child.value) {
      const target = parseFilePathText(child.value)

      if (target) {
        children.splice(index, 1, createChipLinkNode(target, child.value))
      }
      continue
    }

    transformChildren(child)
  }
}

// Remark plugin: turns bare file paths (absolute, ~/, relative with a slash),
// `path:line` / `path (line N)` references, and Codex-style 【F:path†L12】
// citations into links using the astraflow-file: protocol so the markdown
// renderer can display them as clickable file chips.
export function remarkFilePathChips() {
  return (tree: MdastNode) => {
    transformChildren(tree)
  }
}
