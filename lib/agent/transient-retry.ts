const DEFAULT_TRANSIENT_RETRY_DELAYS_MS = [250, 750] as const

const TRANSIENT_ERROR_PATTERNS = [
  /\bterminated\b/i,
  /socket connection was closed unexpectedly/i,
  /socket hang up/i,
  /connection (?:was )?(?:closed|lost|reset|refused)/i,
  /error reading a body from connection/i,
  /network error/i,
  /fetch failed/i,
  /other side closed/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /\b(?:ECONNRESET|ECONNREFUSED|ENETDOWN|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR_SOCKET)\b/i,
] as const

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function collectErrorText(error: unknown, depth = 0): string[] {
  if (depth > 3) {
    return []
  }

  if (typeof error === "string") {
    return [error]
  }

  if (error instanceof Error) {
    return [
      error.name,
      error.message,
      ...collectErrorText(error.cause, depth + 1),
    ]
  }

  const record = getRecord(error)

  if (!record) {
    return [String(error)]
  }

  const text = ["name", "message", "code", "rawMessage"]
    .map((key) => record[key])
    .filter(
      (value): value is string | number =>
        typeof value === "string" || typeof value === "number"
    )
    .map(String)

  return [...text, ...collectErrorText(record.cause, depth + 1)]
}

export function getAstraFlowRuntimeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  const record = getRecord(error)

  return typeof record?.message === "string" ? record.message : String(error)
}

export function isAstraFlowTransientRuntimeError(error: unknown) {
  const record = getRecord(error)
  const name = typeof record?.name === "string" ? record.name : ""

  if (name === "AbortError" || name === "ResponseAborted") {
    return false
  }

  const status =
    typeof record?.status === "number"
      ? record.status
      : typeof record?.statusCode === "number"
        ? record.statusCode
        : null

  if (status !== null && [408, 429, 500, 502, 503, 504].includes(status)) {
    return true
  }

  const text = collectErrorText(error).join(" ")

  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  if (!signal) {
    return new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  }

  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Aborted", "AbortError")
    )
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort)
      resolve()
    }, delayMs)
    const handleAbort = () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
    }

    signal.addEventListener("abort", handleAbort, { once: true })
  })
}

export async function retryAstraFlowTransientOperation<T>({
  operation,
  signal,
  retryDelaysMs = DEFAULT_TRANSIENT_RETRY_DELAYS_MS,
  onRetry,
}: {
  operation: (attempt: number) => Promise<T>
  signal?: AbortSignal
  retryDelaysMs?: readonly number[]
  onRetry?: (error: unknown, retry: number) => void | Promise<void>
}) {
  let attempt = 0

  while (true) {
    try {
      return await operation(attempt)
    } catch (error) {
      const delayMs = retryDelaysMs[attempt]

      if (
        delayMs === undefined ||
        signal?.aborted ||
        !isAstraFlowTransientRuntimeError(error)
      ) {
        throw error
      }

      attempt += 1
      await onRetry?.(error, attempt)
      await waitForRetry(delayMs, signal)
    }
  }
}
