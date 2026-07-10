export const STUDIO_OPEN_REVIEW_PANEL_EVENT = "astraflow:open-review-panel"

export type StudioReviewFileChange = {
  path: string
  kind: "create" | "edit" | "delete"
  additions: number
  deletions: number
  diff: string | null
}

export type StudioOpenReviewPanelDetail = {
  scopeLabel?: string | null
  files: StudioReviewFileChange[]
  truncated?: boolean
  focusPath?: string | null
}

export function openStudioReviewPanel(detail: StudioOpenReviewPanelDetail) {
  if (typeof window === "undefined") {
    return
  }

  window.dispatchEvent(
    new CustomEvent<StudioOpenReviewPanelDetail>(
      STUDIO_OPEN_REVIEW_PANEL_EVENT,
      { detail }
    )
  )
}
