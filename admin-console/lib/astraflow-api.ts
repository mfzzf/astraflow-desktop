export const DEFAULT_ASTRAFLOW_API_BASE_URL =
  "https://astraflow-desktop.modelverse.cn/astraflow-desktop/api"

export function getAstraFlowApiBaseUrl() {
  return (
    process.env.ASTRAFLOW_API_BASE_URL?.trim() || DEFAULT_ASTRAFLOW_API_BASE_URL
  ).replace(/\/+$/, "")
}

export function getAdminAuthorization() {
  const apiKey = process.env.ASTRAFLOW_ADMIN_API_KEY?.trim()

  if (!apiKey) {
    throw new Error("ASTRAFLOW_ADMIN_API_KEY is not configured.")
  }

  return `Bearer ${apiKey}`
}

export function getAdminHeaders() {
  return {
    Accept: "application/json",
    Authorization: getAdminAuthorization(),
  }
}

export function unwrapAdminResult<T>(
  result: { data?: T; error?: unknown; response?: Response },
  fallbackMessage: string
) {
  if (result.data !== undefined) {
    return result.data
  }

  const message = readErrorMessage(result.error) || fallbackMessage
  throw new Error(message)
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message
    return typeof message === "string" ? message : ""
  }
  return ""
}
