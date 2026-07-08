"use client"

import type {
  StudioOpenReviewPanelDetail,
  StudioReviewFileChange,
} from "@/lib/studio-review-panel"

export type StudioProjectReviewData = {
  files: StudioReviewFileChange[]
  truncated: boolean
}

const projectReviewRequests = new Map<string, Promise<StudioProjectReviewData>>()

export async function loadStudioProjectReviewData(
  projectId: string,
  fallbackErrorMessage: string
): Promise<StudioProjectReviewData> {
  const existingRequest = projectReviewRequests.get(projectId)

  if (existingRequest) {
    return existingRequest
  }

  const request = fetch(
    `/api/studio/local-projects/git?id=${encodeURIComponent(projectId)}`
  )
    .then(async (response) => {
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean
        error?: string
        data?: {
          files?: StudioReviewFileChange[]
          truncated?: boolean
        }
      } | null

      if (!response.ok || !payload?.ok) {
        throw new Error(
          typeof payload?.error === "string"
            ? payload.error
            : fallbackErrorMessage
        )
      }

      return {
        files: payload.data?.files ?? [],
        truncated: payload.data?.truncated === true,
      }
    })
    .finally(() => {
      projectReviewRequests.delete(projectId)
    })

  projectReviewRequests.set(projectId, request)
  return request
}

export function createStudioProjectReviewDetail({
  files,
  scopeLabel,
  truncated,
}: StudioProjectReviewData & {
  scopeLabel: string
}): StudioOpenReviewPanelDetail {
  return {
    scopeLabel,
    files,
    truncated,
  }
}
