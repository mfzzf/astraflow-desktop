import { isStudioFilePreviewable } from "@/lib/studio-file-support"

function escapeMarkdownLabel(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
}

export function toStudioFilePreviewHref(path: string) {
  const normalizedPath = path.trim().replaceAll("\\", "/")
  const encodedPath = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")

  return `sandbox:${encodedPath.startsWith("/") ? encodedPath : `/${encodedPath}`}`
}

export function formatStudioFileDeliveryLinks({
  fileId,
  fileName,
  filePath,
}: {
  fileId: string
  fileName: string
  filePath: string
}) {
  const label = escapeMarkdownLabel(fileName)
  const downloadUrl = `/api/studio/files/${encodeURIComponent(fileId)}/content?download=1`
  const previewable = isStudioFilePreviewable(filePath)
  const lines = previewable
    ? [
        `Preview: [${label}](${toStudioFilePreviewHref(filePath)})`,
        `Download: [${label}](${downloadUrl})`,
        "Final response requirement: include both the Preview and Download links above.",
      ]
    : [
        `Download: [${label}](${downloadUrl})`,
        "Final response requirement: include the Download link above; this file type has no AstraFlow preview.",
      ]

  return lines.join("\n")
}
