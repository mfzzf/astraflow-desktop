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
