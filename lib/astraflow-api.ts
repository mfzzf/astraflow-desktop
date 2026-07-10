const ASTRAFLOW_API_HOST = "117.50.180.196"
const ASTRAFLOW_API_HTTP_PORT = 8000
const ASTRAFLOW_API_GRPC_PORT = 9000

export const DEFAULT_ASTRAFLOW_API_BASE_URL = `http://${ASTRAFLOW_API_HOST}:${ASTRAFLOW_API_HTTP_PORT}`
export const DEFAULT_ASTRAFLOW_API_GRPC_TARGET = `${ASTRAFLOW_API_HOST}:${ASTRAFLOW_API_GRPC_PORT}`

export class AstraFlowApiError extends Error {
  status: number
  payload: unknown

  constructor(status: number, message: string, payload?: unknown) {
    super(message)
    this.name = "AstraFlowApiError"
    this.status = status
    this.payload = payload
  }
}

export function getAstraFlowApiBaseUrl() {
  return (
    process.env.ASTRAFLOW_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_ASTRAFLOW_API_BASE_URL?.trim() ||
    DEFAULT_ASTRAFLOW_API_BASE_URL
  ).replace(/\/+$/, "")
}

export function getAstraFlowApiGrpcTarget() {
  return (
    process.env.ASTRAFLOW_API_GRPC_TARGET?.trim() ||
    process.env.NEXT_PUBLIC_ASTRAFLOW_API_GRPC_TARGET?.trim() ||
    DEFAULT_ASTRAFLOW_API_GRPC_TARGET
  )
}

export function unwrapAstraFlowApiResult<T>(
  result: { data?: T; error?: unknown; response?: Response },
  fallbackMessage: string
) {
  if (result.data !== undefined) {
    return result.data
  }

  throw new AstraFlowApiError(
    result.response?.status ?? 503,
    readAstraFlowApiErrorMessage(result.error, fallbackMessage),
    result.error
  )
}

function readAstraFlowApiErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  if (typeof error === "string" && error) {
    return error
  }
  if (isRecord(error)) {
    if (typeof error.message === "string" && error.message) {
      return error.message
    }
    if (typeof error.error === "string" && error.error) {
      return error.error
    }
  }

  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
