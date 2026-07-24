const SHA256_PATTERN = /^[a-f0-9]{64}$/i

export type StudioReviewDiffReference = {
  key: string
  url: string
  sessionId: string
  id: string
  path: string
  revision: string
}

export function getStudioReviewDiffReference({
  sessionId,
  diffBlobId,
  path,
  revision,
}: {
  sessionId: string
  diffBlobId: string | null | undefined
  path: string
  revision: string | null | undefined
}): StudioReviewDiffReference | null {
  const normalizedSessionId = sessionId.trim()
  const normalizedId = diffBlobId?.trim().toLowerCase() ?? ""
  const normalizedPath = path.trim()
  const normalizedRevision = revision?.trim().toLowerCase() ?? ""

  if (
    !normalizedSessionId ||
    !SHA256_PATTERN.test(normalizedId) ||
    !normalizedPath ||
    normalizedPath.length > 16_384 ||
    normalizedPath.includes("\0") ||
    !SHA256_PATTERN.test(normalizedRevision)
  ) {
    return null
  }

  const search = new URLSearchParams({
    path: normalizedPath,
    revision: normalizedRevision,
  })

  return {
    key: JSON.stringify([
      normalizedSessionId,
      normalizedId,
      normalizedPath,
      normalizedRevision,
    ]),
    url: `/api/studio/sessions/${encodeURIComponent(
      normalizedSessionId
    )}/file-mutations/${normalizedId}?${search}`,
    sessionId: normalizedSessionId,
    id: normalizedId,
    path: normalizedPath,
    revision: normalizedRevision,
  }
}

export async function loadStudioReviewDiff(
  reference: StudioReviewDiffReference,
  options: {
    signal?: AbortSignal
    fetcher?: typeof fetch
  } = {}
) {
  const response = await (options.fetcher ?? fetch)(reference.url, {
    cache: "no-store",
    signal: options.signal,
  })
  const payload = (await response.json().catch(() => null)) as {
    ok?: unknown
    data?: {
      id?: unknown
      path?: unknown
      revision?: unknown
      diff?: unknown
    }
  } | null
  const data = payload?.data

  if (
    !response.ok ||
    payload?.ok !== true ||
    data?.id !== reference.id ||
    data.path !== reference.path ||
    data.revision !== reference.revision ||
    typeof data.diff !== "string" ||
    !data.diff.trim()
  ) {
    throw new Error("The full diff is unavailable.")
  }

  return data.diff
}
