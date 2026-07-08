import type { StudioAttachment } from "@/lib/studio-types"

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function formatAttachmentSize(bytes: number | null | undefined) {
  if (typeof bytes !== "number") {
    return ""
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getAttachmentRenderKey(attachment: StudioAttachment) {
  return (
    attachment.id ??
    [
      attachment.type,
      attachment.name,
      attachment.mimeType,
      attachment.size ?? "unknown-size",
      attachment.storagePath ?? attachment.sandboxPath ?? "inline",
    ].join(":")
  )
}
