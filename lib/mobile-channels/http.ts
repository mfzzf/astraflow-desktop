import "server-only"

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20_000
): Promise<T> {
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs)
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal

  try {
    const response = await fetch(url, { ...init, signal })
    const raw = await response.text()

    if (!response.ok) {
      throw new Error(
        `Remote service returned ${response.status}${raw ? `: ${raw.slice(0, 300)}` : ""}`
      )
    }

    try {
      return JSON.parse(raw) as T
    } catch {
      throw new Error("Remote service returned an invalid JSON response.")
    }
  } finally {
    clearTimeout(timeout)
  }
}

export function postJson<T>(
  url: string,
  body: unknown,
  init: RequestInit = {},
  timeoutMs?: number
) {
  return fetchJson<T>(
    url,
    {
      ...init,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...init.headers,
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  )
}

export function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
      return
    }

    const onAbort = () => {
      clearTimeout(timeout)
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"))
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    timeout.unref?.()
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
