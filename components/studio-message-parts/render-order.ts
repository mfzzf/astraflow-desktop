import type { RenderableStudioMessagePart } from "./types"

export type MessagePartRenderItem =
  | {
      type: "part"
      part: RenderableStudioMessagePart
      sourceIndex: number
    }
  | {
      type: "activity_group"
      id: string
      parts: RenderableStudioMessagePart[]
    }

export function isCollapsibleActivityPart(
  part: RenderableStudioMessagePart
) {
  return (
    part.type === "tool" ||
    part.type === "reasoning" ||
    part.type === "plan" ||
    part.type === "file" ||
    part.type === "file_group" ||
    part.type === "media_generation"
  )
}

// Permission and user-input parts render no DOM inside the message body
// (pending ones surface as the composer-level decision card), so they must
// not split an otherwise consecutive activity run.
function isTransparentPart(part: RenderableStudioMessagePart) {
  return part.type === "permission" || part.type === "user_input"
}

function movePlansToEnd(parts: RenderableStudioMessagePart[]) {
  return [
    ...parts.filter((part) => part.type !== "plan"),
    ...parts.filter((part) => part.type === "plan"),
  ]
}

// Keep render order strictly chronological: collapsible activity parts are
// folded into a summary card exactly where they were produced, instead of
// being re-anchored in front of the next text part. Re-anchoring could move
// trailing activity (e.g. tools that ran after the final streamed text)
// above content the model actually emitted earlier.
export function arrangeMessagePartsForDisplay(
  parts: RenderableStudioMessagePart[],
  shouldGroupActivityPart: (part: RenderableStudioMessagePart) => boolean
): MessagePartRenderItem[] {
  const items: MessagePartRenderItem[] = []
  let groupParts: RenderableStudioMessagePart[] = []

  function flushGroup() {
    if (groupParts.length === 0) {
      return
    }

    const firstPart = groupParts[0]

    items.push({
      type: "activity_group",
      id: `turn-activity-summary-${firstPart.id}`,
      parts: movePlansToEnd(groupParts),
    })
    groupParts = []
  }

  parts.forEach((part, sourceIndex) => {
    if (shouldGroupActivityPart(part)) {
      groupParts.push(part)
      return
    }

    if (isTransparentPart(part)) {
      return
    }

    flushGroup()
    items.push({ type: "part", part, sourceIndex })
  })

  flushGroup()

  return items
}
