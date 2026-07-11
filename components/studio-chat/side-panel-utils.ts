import {
  getStudioFileDescriptor,
  isStudioFilePreviewable,
} from "@/lib/studio-file-support"
import { getPathTail } from "./workspace-tabs"

export function formatSidePanelFileSize(bytes: number | null | undefined) {
  if (typeof bytes !== "number") {
    return ""
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isVirtualSidePanelPath(path: string) {
  return path.startsWith("/api/") || /^https?:\/\//i.test(path)
}

export function isLikelyTextEntry(entry: AstraFlowSidePanelDirectoryEntry) {
  if (entry.kind !== "file") {
    return false
  }

  if (isVirtualSidePanelPath(entry.path)) {
    return false
  }

  const descriptor = getStudioFileDescriptor(entry.path)

  return (
    descriptor.kind === "code" ||
    descriptor.kind === "markdown" ||
    descriptor.kind === "text" ||
    descriptor.kind === "notebook" ||
    descriptor.kind === "molecule" ||
    (descriptor.kind === "spreadsheet" &&
      ["csv", "tsv"].includes(descriptor.extension)) ||
    descriptor.extension === "tex"
  )
}

export function isImageEntry(entry: AstraFlowSidePanelDirectoryEntry) {
  return (
    entry.kind === "file" &&
    !isVirtualSidePanelPath(entry.path) &&
    getStudioFileDescriptor(entry.path).kind === "image"
  )
}

export function isBinaryPreviewEntry(entry: AstraFlowSidePanelDirectoryEntry) {
  if (entry.kind !== "file" || isVirtualSidePanelPath(entry.path)) {
    return false
  }

  const descriptor = getStudioFileDescriptor(entry.path)

  return (
    (descriptor.kind === "pdf" && descriptor.extension !== "tex") ||
    descriptor.kind === "document" ||
    descriptor.kind === "presentation" ||
    descriptor.kind === "binary" ||
    (descriptor.kind === "spreadsheet" &&
      !["csv", "tsv"].includes(descriptor.extension))
  )
}

export function isPreviewableSidePanelEntry(
  entry: AstraFlowSidePanelDirectoryEntry
) {
  return (
    entry.kind === "file" &&
    !isVirtualSidePanelPath(entry.path) &&
    isStudioFilePreviewable(entry.path)
  )
}

export function inferCodeLanguage(entry: AstraFlowSidePanelDirectoryEntry) {
  return getStudioFileDescriptor(entry.path).language || "plaintext"
}

export function parseMarkdownFrontmatter(content: string) {
  const normalized = content.replace(/^\uFEFF/, "")
  const lines = normalized.split(/\r?\n/)

  if (lines[0]?.trim() !== "---") {
    return { body: content, metadata: [] as Array<[string, string]> }
  }

  const endIndex = lines.findIndex((line, index) => {
    return index > 0 && line.trim() === "---"
  })

  if (endIndex < 0) {
    return { body: content, metadata: [] as Array<[string, string]> }
  }

  const metadata = parseSimpleYamlMetadata(lines.slice(1, endIndex).join("\n"))
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .replace(/^\s+/, "")

  return { body, metadata }
}

export function parseSimpleYamlMetadata(yaml: string): Array<[string, string]> {
  const metadata: Array<[string, string]> = []
  let currentKey = ""

  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)

    if (keyValueMatch) {
      currentKey = keyValueMatch[1]
      const value = cleanYamlScalar(keyValueMatch[2])

      metadata.push([currentKey, value])
      continue
    }

    const listItemMatch = line.match(/^\s*-\s*(.+)$/)

    if (listItemMatch && currentKey) {
      const lastItem = metadata.at(-1)
      const value = cleanYamlScalar(listItemMatch[1])

      if (lastItem?.[0] === currentKey) {
        lastItem[1] = lastItem[1] ? `${lastItem[1]}, ${value}` : value
      }
    }
  }

  return metadata.filter(([, value]) => value.trim().length > 0)
}

export function cleanYamlScalar(value: string) {
  return value.trim().replace(/^['"]|['"]$/g, "")
}

export function formatFileBreadcrumb(path: string | null | undefined) {
  const tail = getPathTail(path)

  return tail || "~"
}
