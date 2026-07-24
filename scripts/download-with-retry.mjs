const RETRYABLE_HTTP_STATUSES = new Set([
  408,
  425,
  429,
  500,
  502,
  503,
  504,
])
const DEFAULT_RETRY_DELAYS_MS = [1_000, 3_000, 7_000]

function responseError(url, response) {
  return new Error(`Failed to download ${url}: HTTP ${response.status}`)
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel()
  } catch {
    // The failed response is already unusable; cancellation is best-effort.
  }
}

/**
 * Fetch a release asset with bounded retries for transient transport and
 * server failures. Integrity remains the caller's responsibility.
 */
export async function fetchDownloadWithRetry(
  url,
  {
    fetchImpl = fetch,
    onRetry = ({ attempt, delayMs, error }) => {
      console.warn(
        `${error.message}; retrying download after ${delayMs}ms (attempt ${attempt + 1}).`
      )
    },
    request = { redirect: "follow" },
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    wait = (delayMs) =>
      new Promise((resolve) => setTimeout(resolve, delayMs)),
  } = {}
) {
  const maxAttempts = retryDelaysMs.length + 1
  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response

    try {
      response = await fetchImpl(url, request)
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error))
      if (attempt === maxAttempts) {
        throw lastError
      }
    }

    if (response) {
      if (response.ok) {
        return response
      }

      lastError = responseError(url, response)
      await cancelResponseBody(response)
      if (
        !RETRYABLE_HTTP_STATUSES.has(response.status) ||
        attempt === maxAttempts
      ) {
        throw lastError
      }
    }

    const delayMs = retryDelaysMs[attempt - 1]
    onRetry({ attempt, delayMs, error: lastError })
    await wait(delayMs)
  }

  throw lastError ?? new Error(`Failed to download ${url}.`)
}

function parseGitHubReleaseAssetUrl(url) {
  let parsed

  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.hostname !== "github.com") {
    return null
  }

  const segments = parsed.pathname.split("/").filter(Boolean)

  if (
    segments.length < 6 ||
    segments[2] !== "releases" ||
    segments[3] !== "download"
  ) {
    return null
  }

  return {
    owner: decodeURIComponent(segments[0]),
    repository: decodeURIComponent(segments[1]),
    tag: decodeURIComponent(segments[4]),
    assetName: decodeURIComponent(segments.slice(5).join("/")),
  }
}

function githubApiHeaders({ accept, apiToken }) {
  return {
    Accept: accept,
    "X-GitHub-Api-Version": "2022-11-28",
    ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
  }
}

/**
 * Download a public GitHub release asset. GitHub-hosted runners occasionally
 * receive persistent gateway errors from github.com/releases/download even
 * while api.github.com and the backing release-assets CDN remain healthy.
 * Resolve the same asset through the release API as an independent path.
 */
export async function fetchGitHubReleaseAssetWithRetry(
  url,
  {
    apiBaseUrl = "https://api.github.com",
    apiToken = process.env.GITHUB_TOKEN?.trim() || "",
    fetchImpl = fetch,
    onFallback = ({ error, strategy }) => {
      console.warn(
        `${error.message}; retrying GitHub release asset through ${strategy}.`
      )
    },
    ...retryOptions
  } = {}
) {
  const releaseAsset = parseGitHubReleaseAssetUrl(url)

  if (!releaseAsset) {
    return fetchDownloadWithRetry(url, {
      fetchImpl,
      ...retryOptions,
    })
  }

  const fetchDirect = () =>
    fetchDownloadWithRetry(url, {
      fetchImpl,
      ...retryOptions,
    })
  const fetchThroughApi = async () => {
    const releaseUrl = `${apiBaseUrl}/repos/${encodeURIComponent(
      releaseAsset.owner
    )}/${encodeURIComponent(
      releaseAsset.repository
    )}/releases/tags/${encodeURIComponent(releaseAsset.tag)}`
    const releaseResponse = await fetchDownloadWithRetry(releaseUrl, {
      fetchImpl,
      request: {
        headers: githubApiHeaders({
          accept: "application/vnd.github+json",
          apiToken,
        }),
        redirect: "follow",
      },
      ...retryOptions,
    })
    const release = await releaseResponse.json()
    const asset = release.assets?.find(
      (candidate) => candidate.name === releaseAsset.assetName
    )

    if (!asset?.url) {
      throw new Error(
        `GitHub release ${releaseAsset.owner}/${releaseAsset.repository}@${releaseAsset.tag} does not contain ${releaseAsset.assetName}.`
      )
    }

    return fetchDownloadWithRetry(asset.url, {
      fetchImpl,
      request: {
        headers: githubApiHeaders({
          accept: "application/octet-stream",
          apiToken,
        }),
        redirect: "follow",
      },
      ...retryOptions,
    })
  }

  const primaryStrategy = apiToken ? fetchThroughApi : fetchDirect
  const fallbackStrategy = apiToken ? fetchDirect : fetchThroughApi
  const fallbackName = apiToken
    ? "the direct release URL"
    : "the GitHub release API"

  try {
    return await primaryStrategy()
  } catch (error) {
    onFallback({
      error: error instanceof Error ? error : new Error(String(error)),
      strategy: fallbackName,
    })
    return fallbackStrategy()
  }
}
