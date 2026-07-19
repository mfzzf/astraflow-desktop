export type ApiResult<T> = {
  data?: T
  error?: unknown
  response?: Response
}

export function requireApiData<T>(result: ApiResult<T>, fallback: string): T {
  if (result.data !== undefined) return result.data
  throw new Error(apiErrorMessage(result.error, fallback))
}

export function apiErrorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    for (const key of ["message", "reason", "error_description", "error"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }
  return fallback
}

export function authorizationHeaders(authorization: string) {
  return { Authorization: authorization }
}
