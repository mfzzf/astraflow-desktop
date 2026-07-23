import {
  readFileMutationDiff,
  type FileMutationBlob,
} from "@/lib/agent/file-mutation-store"

const DIGEST_PATTERN = /^[a-f0-9]{64}$/i

export type StudioFileMutationRouteResult =
  | {
      ok: true
      mutation: FileMutationBlob
    }
  | {
      ok: false
      status: 400 | 404
      error: string
    }

export function resolveStudioFileMutationRoute(input: {
  sessionId: string
  blobId: string
  path: string | null
  revision: string | null
  sessionExists: (sessionId: string) => boolean
}): StudioFileMutationRouteResult {
  const sessionId = input.sessionId.trim()
  const blobId = input.blobId.trim().toLowerCase()
  const path = input.path?.trim() ?? ""
  const revision = input.revision?.trim().toLowerCase() ?? ""

  if (!sessionId || !input.sessionExists(sessionId)) {
    return {
      ok: false,
      status: 404,
      error: "Session not found.",
    }
  }

  if (
    !DIGEST_PATTERN.test(blobId) ||
    !DIGEST_PATTERN.test(revision) ||
    !path ||
    path.length > 16_384 ||
    path.includes("\0")
  ) {
    return {
      ok: false,
      status: 400,
      error: "Invalid file mutation reference.",
    }
  }

  const mutation = readFileMutationDiff({
    sessionId,
    id: blobId,
    path,
    revision,
  })

  return mutation
    ? { ok: true, mutation }
    : {
        ok: false,
        status: 404,
        error: "File mutation diff is unavailable or expired.",
      }
}
