import { getFiletypeFromFileName } from "@pierre/diffs"

export type MarkdownCodeFenceInfo = {
  language: string
  isFileReference: boolean
  filePath: string | null
  fileName: string | null
  directory: string | null
  lineRange: string | null
}

const CODE_REFERENCE_PATTERN = /^(\d+):(\d+):(.+)$/
const LEADING_WHITESPACE_PATTERN = /^[ \t]*/

function basenameOfPath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  return normalized.slice(normalized.lastIndexOf("/") + 1) || normalized
}

function directoryFromPath(path: string, fileName: string) {
  const directory = path
    .slice(0, Math.max(0, path.length - fileName.length))
    .replace(/[\\/]+$/, "")

  return directory || null
}

function fileReferenceInfo(
  filePath: string,
  lineRange: string | null
): MarkdownCodeFenceInfo {
  const fileName = basenameOfPath(filePath)

  return {
    // Synara shares @pierre/diffs' filename map with its diff renderer so code
    // fences and changed-file views cannot disagree about the language.
    language: getFiletypeFromFileName(fileName),
    isFileReference: true,
    filePath,
    fileName,
    directory: directoryFromPath(filePath, fileName),
    lineRange,
  }
}

export function dedentMarkdownCode(code: string) {
  const lines = code.split("\n")
  let minIndent = Number.POSITIVE_INFINITY

  for (const line of lines) {
    if (!line.trim()) {
      continue
    }

    minIndent = Math.min(
      minIndent,
      LEADING_WHITESPACE_PATTERN.exec(line)?.[0].length ?? 0
    )
  }

  if (!Number.isFinite(minIndent) || minIndent === 0) {
    return code
  }

  return lines.map((line) => line.slice(minIndent)).join("\n")
}

export function parseMarkdownCodeFenceInfo(
  rawInfo: string
): MarkdownCodeFenceInfo {
  const info = rawInfo.trim()
  const reference = CODE_REFERENCE_PATTERN.exec(info)

  if (reference) {
    const [, start, end, filePath] = reference

    if (start && end && filePath) {
      return fileReferenceInfo(
        filePath,
        start === end ? start : `${start}-${end}`
      )
    }
  }

  if (info.includes("/") || info.includes("\\")) {
    return fileReferenceInfo(info, null)
  }

  return {
    language:
      info === "gitignore" ? "ini" : info.length > 0 ? info : "text",
    isFileReference: false,
    filePath: null,
    fileName: null,
    directory: null,
    lineRange: null,
  }
}
