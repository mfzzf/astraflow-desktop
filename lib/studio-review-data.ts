"use client"

import type {
  StudioOpenReviewPanelDetail,
  StudioReviewFileChange,
  StudioReviewGitSummary,
} from "@/lib/studio-review-panel"
import type { StudioWorkspace } from "@/lib/studio-types"

export type StudioProjectReviewData = {
  files: StudioReviewFileChange[]
  truncated: boolean
  // False when the workspace root is not exactly a Git repository root;
  // callers should fall back to session-derived file changes.
  gitAvailable: boolean
  git: StudioReviewGitSummary | null
}

const workspaceReviewRequests = new Map<
  string,
  Promise<StudioProjectReviewData>
>()

function getPayloadError(
  payload:
    | { error?: string | { message?: string }; message?: string }
    | null,
  fallback: string
) {
  if (typeof payload?.error === "string") {
    return payload.error
  }

  return payload?.error?.message || payload?.message || fallback
}

function loadReviewData(
  requestKey: string,
  endpoint: string,
  fallbackErrorMessage: string,
  environment: "local" | "remote"
) {
  const existingRequest = workspaceReviewRequests.get(requestKey)

  if (existingRequest) {
    return existingRequest
  }

  const request = fetch(endpoint)
    .then(async (response) => {
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: string | { message?: string }
        message?: string
        data?: {
          files?: StudioReviewFileChange[]
          truncated?: boolean
          gitAvailable?: boolean
          git?: StudioReviewGitSummary | null
        }
      } | null

      if (!response.ok || !payload?.ok) {
        throw new Error(getPayloadError(payload, fallbackErrorMessage))
      }

      return {
        files: (payload.data?.files ?? []).map((file) => ({
          ...file,
          environment,
        })),
        truncated: payload.data?.truncated === true,
        gitAvailable: payload.data?.gitAvailable !== false,
        git: payload.data?.git ?? null,
      }
    })
    .finally(() => {
      workspaceReviewRequests.delete(requestKey)
    })

  workspaceReviewRequests.set(requestKey, request)
  return request
}

export function getStudioWorkspaceReviewEndpoint(workspace: StudioWorkspace) {
  if (workspace.type === "local") {
    const search = new URLSearchParams({
      id: workspace.localProjectId,
      workspaceId: workspace.id,
    })

    return `/api/studio/local-projects/git?${search}`
  }

  return `/api/studio/workspaces/${encodeURIComponent(
    workspace.id
  )}/git/review`
}

export function loadStudioWorkspaceReviewData(
  workspace: StudioWorkspace,
  fallbackErrorMessage: string
): Promise<StudioProjectReviewData> {
  return loadReviewData(
    `${workspace.type}:${workspace.id}`,
    getStudioWorkspaceReviewEndpoint(workspace),
    fallbackErrorMessage,
    workspace.type === "local" ? "local" : "remote"
  )
}

/** @deprecated Use the explicit workspace transport instead. */
export function loadStudioProjectReviewData(
  projectId: string,
  fallbackErrorMessage: string
): Promise<StudioProjectReviewData> {
  return loadReviewData(
    `legacy-local:${projectId}`,
    `/api/studio/local-projects/git?id=${encodeURIComponent(projectId)}`,
    fallbackErrorMessage,
    "local"
  )
}

export function createStudioProjectReviewDetail({
  files,
  git,
  scopeLabel,
  truncated,
}: StudioProjectReviewData & {
  scopeLabel: string
}): StudioOpenReviewPanelDetail {
  return {
    scopeLabel,
    files,
    truncated,
    git,
  }
}

export const createStudioWorkspaceReviewDetail =
  createStudioProjectReviewDetail
