export const FILE_PATH_CHIP_PROTOCOL = "astraflow-file:"

export type MarkdownFilePathTarget = {
  path: string
  line: number | null
  endLine: number | null
}

export function encodeFilePathChipHref(target: MarkdownFilePathTarget) {
  const line = target.line
    ? `?line=${target.line}${target.endLine ? `-${target.endLine}` : ""}`
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
  const line = lineMatch ? Number.parseInt(lineMatch[1], 10) : null
  const endLine = lineMatch?.[2] ? Number.parseInt(lineMatch[2], 10) : null

  return {
    path,
    line: Number.isFinite(line) && line ? line : null,
    endLine: Number.isFinite(endLine) && endLine ? endLine : null,
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

const OPENABLE_FILE_PATH_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "c",
  "cjs",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "env",
  "gif",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "ico",
  "java",
  "jpeg",
  "jpg",
  "js",
  "json",
  "jsonl",
  "jsx",
  "log",
  "markdown",
  "md",
  "mdx",
  "mjs",
  "png",
  "py",
  "rb",
  "rs",
  "rst",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "webp",
  "xml",
  "yaml",
  "yml",
])

// Codex-style citation: 【F:path/to/file.ts†L12-L20】 (line range optional).
const CODEX_CITATION_SOURCE = String.raw`【F:([^†】\n]+?)(?:†L(\d+)(?:[-–]L?(\d+))?)?】`

// A path is either:
// - absolute / home / dot-relative / plain relative with at least one "/",
//   whose last segment carries a file extension, or
// - a bare filename with extension, only when an explicit "(line N)" marker
//   follows (too ambiguous otherwise).
const PATH_WITH_SLASH_SOURCE = String.raw`(?:~\/|\.{1,2}\/|\/)?(?:[\w.@+-]+\/)+[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,8}`
const BARE_FILENAME_SOURCE = String.raw`[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,8}(?=\s*[(（]lines?\s)`
const LINE_SUFFIX_SOURCE = String.raw`(?::(\d+)(?:-(\d+))?|#L(\d+)(?:-L?(\d+))?)?(?:\s*[(（]lines?\s+(\d+)(?:\s*[-–~]\s*(\d+))?[)）])?`

const FILE_PATH_TEXT_PATTERN = new RegExp(
  `${CODEX_CITATION_SOURCE}|(?<![\\w/.@-])(${PATH_WITH_SLASH_SOURCE}|${BARE_FILENAME_SOURCE})${LINE_SUFFIX_SOURCE}`,
  "g"
)

const FILE_PATH_EXACT_PATTERN = new RegExp(
  `^(?:${CODEX_CITATION_SOURCE}|(${PATH_WITH_SLASH_SOURCE}|${BARE_FILENAME_SOURCE})${LINE_SUFFIX_SOURCE})$`
)

function parseLineNumber(value: string | undefined) {
  if (!value) {
    return null
  }

  const parsed = Number.parseInt(value, 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseLineRange(value: string | null | undefined) {
  const match = value?.match(/^L?(\d+)(?:[-–]L?(\d+))?$/i)
  const line = parseLineNumber(match?.[1])
  const endLine = parseLineNumber(match?.[2])

  return {
    line,
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

    return {
      line,
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

function hasOpenableFileExtension(path: string) {
  return OPENABLE_FILE_PATH_EXTENSIONS.has(getFilePathChipExtension(path))
}

function buildTargetFromMatch(match: RegExpExecArray) {
  const [, citationPath, citationLine, citationEndLine, path, ...lineGroups] =
    match
  const targetPath = (citationPath ?? path)?.trim()

  if (!targetPath) {
    return null
  }

  const line =
    parseLineNumber(citationLine) ??
    parseLineNumber(lineGroups[0]) ??
    parseLineNumber(lineGroups[2]) ??
    parseLineNumber(lineGroups[4])
  const endLine =
    parseLineNumber(citationEndLine) ??
    parseLineNumber(lineGroups[1]) ??
    parseLineNumber(lineGroups[3]) ??
    parseLineNumber(lineGroups[5])

  return {
    path: targetPath,
    line,
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

  if (trimmedHref.startsWith("file://")) {
    try {
      const parsed = new URL(trimmedHref)
      const { line, endLine } = parseHrefLineTarget(
        parsed.search,
        parsed.hash
      )

      return {
        path: decodeURIComponent(parsed.pathname),
        line,
        endLine,
      }
    } catch {
      return null
    }
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(trimmedHref)) {
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

  const { line, endLine } = parseHrefLineTarget(search, hash)

  return {
    path: decodeFilePath(path),
    line,
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
