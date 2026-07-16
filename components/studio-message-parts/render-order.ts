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
      anchorTextIndex: number | null
    }

function isVisibleTextPart(part: RenderableStudioMessagePart) {
  return part.type === "text" && Boolean(part.content.trim())
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

function movePlansToEnd(parts: RenderableStudioMessagePart[]) {
  return [
    ...parts.filter((part) => part.type !== "plan"),
    ...parts.filter((part) => part.type === "plan"),
  ]
}

export function arrangeMessagePartsForDisplay(
  parts: RenderableStudioMessagePart[],
  shouldGroupActivityPart: (part: RenderableStudioMessagePart) => boolean
): MessagePartRenderItem[] {
  const firstTextIndex = parts.findIndex(isVisibleTextPart)

  if (firstTextIndex < 0) {
    const activityParts = movePlansToEnd(parts.filter(shouldGroupActivityPart))
    const firstActivityIndex = parts.findIndex(shouldGroupActivityPart)

    if (firstActivityIndex < 0) {
      return parts.map((part, sourceIndex) => ({
        type: "part",
        part,
        sourceIndex,
      }))
    }

    return parts.flatMap((part, sourceIndex): MessagePartRenderItem[] => {
      if (!shouldGroupActivityPart(part)) {
        return [{ type: "part", part, sourceIndex }]
      }

      return sourceIndex === firstActivityIndex
        ? [
            {
              type: "activity_group",
              id: "turn-activity-summary-unanchored",
              parts: activityParts,
              anchorTextIndex: null,
            },
          ]
        : []
    })
  }

  const textIndices = parts.flatMap((part, sourceIndex) =>
    isVisibleTextPart(part) ? [sourceIndex] : []
  )
  const lastTextIndex = textIndices.at(-1) ?? firstTextIndex
  const activityPartsByTextIndex = new Map<
    number,
    RenderableStudioMessagePart[]
  >()
  let nextTextCursor = 0

  for (let sourceIndex = 0; sourceIndex < parts.length; sourceIndex += 1) {
    const part = parts[sourceIndex]

    while (
      nextTextCursor < textIndices.length &&
      textIndices[nextTextCursor] <= sourceIndex
    ) {
      nextTextCursor += 1
    }

    if (!shouldGroupActivityPart(part)) {
      continue
    }

    // Activity belongs before the next model output. Providers occasionally
    // deliver reasoning metadata after the text it produced, so trailing
    // activity falls back to the final output instead of appearing below it.
    // A plan summarizes the whole turn and therefore belongs at the end of
    // the final activity group.
    const anchorTextIndex =
      part.type === "plan"
        ? lastTextIndex
        : (textIndices[nextTextCursor] ?? lastTextIndex)
    const group = activityPartsByTextIndex.get(anchorTextIndex) ?? []
    group.push(part)
    activityPartsByTextIndex.set(anchorTextIndex, group)
  }

  return parts.flatMap((part, sourceIndex): MessagePartRenderItem[] => {
    if (shouldGroupActivityPart(part)) {
      return []
    }

    const items: MessagePartRenderItem[] = []
    const activityParts = activityPartsByTextIndex.get(sourceIndex)

    if (isVisibleTextPart(part) && activityParts?.length) {
      items.push({
        type: "activity_group",
        id: `turn-activity-summary-${part.id}`,
        parts: movePlansToEnd(activityParts),
        anchorTextIndex: sourceIndex,
      })
    }

    items.push({ type: "part", part, sourceIndex })

    return items
  })
}
