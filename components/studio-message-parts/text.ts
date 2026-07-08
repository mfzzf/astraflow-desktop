import type { StudioMessageActivity, StudioMessagePart } from "@/lib/studio-types"

import type { RenderableStudioMessagePart, StudioFilePart } from "./types"

function getFallbackMessageParts(
  content: string,
  activities: StudioMessageActivity[]
): StudioMessagePart[] {
  const fallbackParts: StudioMessagePart[] = activities.map((activity) => ({
    id: activity.id,
    type: "tool",
    activity,
  }))

  if (content.trim()) {
    fallbackParts.push({
      id: "content",
      type: "text",
      content,
    })
  }

  return fallbackParts
}

export function hasRenderableReasoningParts(parts: StudioMessagePart[]) {
  return parts.some(
    (part) => part.type === "reasoning" && part.content.trim().length > 0
  )
}

function groupFileParts(
  parts: StudioMessagePart[]
): RenderableStudioMessagePart[] {
  const groupedParts: RenderableStudioMessagePart[] = []
  let fileBuffer: StudioFilePart[] = []

  function flushFileBuffer() {
    if (fileBuffer.length === 0) {
      return
    }

    groupedParts.push({
      id: `file-group-${fileBuffer[0]?.id ?? groupedParts.length}`,
      type: "file_group",
      files: fileBuffer,
    })
    fileBuffer = []
  }

  for (const part of parts) {
    if (part.type === "file") {
      fileBuffer.push(part)
      continue
    }

    flushFileBuffer()
    groupedParts.push(part)
  }

  flushFileBuffer()

  return groupedParts
}

export function getRenderableMessageParts({
  content,
  activities,
  parts,
}: {
  content: string
  activities: StudioMessageActivity[]
  parts: StudioMessagePart[]
}) {
  return groupFileParts(
    parts.length > 0 ? parts : getFallbackMessageParts(content, activities)
  )
}
