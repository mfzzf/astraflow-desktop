import type { StudioFileWorkspaceTarget } from "@/lib/studio-file-workspace"

export const STUDIO_OPEN_REVIEW_PANEL_EVENT = "astraflow:open-review-panel"

export type StudioReviewFileChange = {
  path: string
  kind: "create" | "edit" | "delete"
  additions: number
  deletions: number
  diff: string | null
  environment?: "local" | "remote"
  workspace?: StudioFileWorkspaceTarget
}

export type StudioReviewGitSummary = {
  branch: string | null
  branches: string[]
  remote: string | null
  ahead: number | null
  behind: number | null
}

export type StudioOpenReviewPanelDetail = {
  scopeLabel?: string | null
  files: StudioReviewFileChange[]
  truncated?: boolean
  focusPath?: string | null
  git?: StudioReviewGitSummary | null
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
