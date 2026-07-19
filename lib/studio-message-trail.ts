import type { StudioMessage } from "@/lib/studio-types"

type StudioMessageTrailSource = Pick<
  StudioMessage,
  "id" | "role" | "content" | "attachments"
>

export type StudioMessageTrailItem = {
  id: string
  ordinal: number
  preview: string
  responsePreview: string
  attachmentCount: number
}

export type StudioMessageTrailGeometry = {
  startY: number
  spacing: number
  centerYs: number[]
  contentHeight: number
}

const MAX_PREVIEW_LENGTH = 280

function normalizePreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim()

  return normalized.length > MAX_PREVIEW_LENGTH
    ? `${normalized.slice(0, MAX_PREVIEW_LENGTH).trimEnd()}…`
    : normalized
}

export function deriveStudioMessageTrailItems(
  messages: readonly StudioMessageTrailSource[]
) {
  const items: StudioMessageTrailItem[] = []
  let currentTurnIndex = -1

  for (const message of messages) {
    if (message.role === "user") {
      items.push({
        id: message.id,
        ordinal: items.length + 1,
        preview: normalizePreview(message.content),
        responsePreview: "",
        attachmentCount: message.attachments.length,
      })
      currentTurnIndex = items.length - 1
      continue
    }

    if (message.role === "assistant" && currentTurnIndex >= 0) {
      const responsePreview = normalizePreview(message.content)

      if (responsePreview) {
        items[currentTurnIndex]!.responsePreview = responsePreview
      }
    }
  }

  return items
}

export function clampMessageTrailNumber(
  value: number,
  minimum: number,
  maximum: number
) {
  if (!Number.isFinite(value) || maximum < minimum) return minimum
  return Math.min(maximum, Math.max(minimum, value))
}

export function computeStudioMessageTrailGeometry({
  count,
  spacing = 10,
  padding = 12,
}: {
  count: number
  spacing?: number
  padding?: number
}): StudioMessageTrailGeometry | null {
  if (count <= 0) return null

  const effectiveSpacing = count <= 1 ? 0 : spacing
  const centerYs = Array.from(
    { length: count },
    (_value, index) => padding + index * effectiveSpacing
  )

  return {
    startY: padding,
    spacing: effectiveSpacing,
    centerYs,
    contentHeight: padding * 2 + (count - 1) * effectiveSpacing,
  }
}

export function computeStudioMessageTrailFocusedIndex(
  pointerY: number,
  geometry: StudioMessageTrailGeometry
) {
  if (geometry.centerYs.length <= 1 || geometry.spacing === 0) return 0

  const endY =
    geometry.startY + (geometry.centerYs.length - 1) * geometry.spacing
  const clamped = clampMessageTrailNumber(
    pointerY,
    geometry.startY,
    endY
  )

  return clampMessageTrailNumber(
    Math.round((clamped - geometry.startY) / geometry.spacing),
    0,
    geometry.centerYs.length - 1
  )
}

export function computeStudioMessageTrailWeights(
  centerYs: readonly number[],
  pointerY: number,
  sigma: number
) {
  if (sigma <= 0) {
    return centerYs.map((centerY) => (centerY === pointerY ? 1 : 0))
  }

  const twoSigmaSquared = 2 * sigma * sigma

  return centerYs.map((centerY) => {
    const distance = centerY - pointerY
    return Math.exp(-(distance * distance) / twoSigmaSquared)
  })
}

export function clampStudioMessageTrailTooltip(
  centerY: number,
  tooltipHeight: number,
  railHeight: number,
  margin = 4
) {
  const half = tooltipHeight / 2 + margin
  return clampMessageTrailNumber(
    centerY,
    half,
    Math.max(half, railHeight - half)
  )
}
