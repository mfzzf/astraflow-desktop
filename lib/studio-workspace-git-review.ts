export const EMPTY_STUDIO_WORKSPACE_GIT_REVIEW = {
  files: [],
  truncated: false,
  gitAvailable: false,
  git: null,
} as const

export function isStudioWorkspaceGitReviewUnsupported(
  status: number,
  payload: unknown
) {
  if (status === 404 || status === 405 || status === 501) {
    return true
  }

  if (!payload || typeof payload !== "object") {
    return false
  }

  const error = "error" in payload ? payload.error : null
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : null

  return code === "CAPABILITY_NOT_SUPPORTED"
}
