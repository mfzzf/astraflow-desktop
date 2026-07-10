import type { paths } from "@/lib/generated/openapi/astraflow-api"

const ASTRAFLOW_EXPERT_SERVICE_HOST = "117.50.180.196"
const ASTRAFLOW_EXPERT_SERVICE_HTTP_PORT = 8000
const ASTRAFLOW_EXPERT_SERVICE_GRPC_PORT = 9000

export const DEFAULT_ASTRAFLOW_API_BASE_URL = `http://${ASTRAFLOW_EXPERT_SERVICE_HOST}:${ASTRAFLOW_EXPERT_SERVICE_HTTP_PORT}`
export const DEFAULT_ASTRAFLOW_API_GRPC_TARGET = `${ASTRAFLOW_EXPERT_SERVICE_HOST}:${ASTRAFLOW_EXPERT_SERVICE_GRPC_PORT}`

type JsonResponse<
  Path extends keyof paths,
  Method extends keyof paths[Path],
> = paths[Path][Method] extends {
  responses: {
    200: {
      content: {
        "application/json": infer Body
      }
    }
  }
}
  ? Body
  : never

export type ExpertCategoriesResponse = JsonResponse<
  "/v1/expert-categories",
  "get"
>
export type ExpertsListResponse = JsonResponse<"/v1/experts", "get">
export type ExpertDetailResponse = JsonResponse<"/v1/experts/{expertId}", "get">
export type ExpertRuntimeResponse = JsonResponse<
  "/v1/experts/{expertId}/runtime",
  "get"
>

export type ListExpertsParams = {
  pageSize?: number
  pageToken?: string
  categoryId?: string
  type?: "agent" | "team" | string
  status?: "downloaded" | "metadata_only" | string
  query?: string
  orderBy?: "recent" | "name" | string
  locale?: "zh" | "en"
}

export class AstraFlowExpertsApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "AstraFlowExpertsApiError"
    this.status = status
  }
}

export async function listExpertCategories({
  locale = "zh",
}: {
  locale?: "zh" | "en"
} = {}) {
  return fetchAstraFlowExpertJson<ExpertCategoriesResponse>(
    "/v1/expert-categories",
    { locale }
  )
}

export async function listExperts(params: ListExpertsParams = {}) {
  return fetchAstraFlowExpertJson<ExpertsListResponse>("/v1/experts", {
    pageSize: params.pageSize,
    pageToken: params.pageToken,
    categoryId: params.categoryId,
    type: params.type,
    status: params.status,
    query: params.query,
    orderBy: params.orderBy,
    locale: params.locale,
  })
}

export async function getExpert(
  expertId: string,
  { locale = "zh" }: { locale?: "zh" | "en" } = {}
) {
  return fetchAstraFlowExpertJson<ExpertDetailResponse>(
    `/v1/experts/${encodeURIComponent(expertId)}`,
    { locale }
  )
}

export async function getExpertRuntime(expertId: string) {
  return fetchAstraFlowExpertJson<ExpertRuntimeResponse>(
    `/v1/experts/${encodeURIComponent(expertId)}/runtime`
  )
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

async function fetchAstraFlowExpertJson<T>(
  pathname: string,
  params: Record<string, string | number | undefined> = {}
): Promise<T> {
  const url = new URL(`${getAstraFlowApiBaseUrl()}${pathname}`)
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue
    }
    url.searchParams.set(key, String(value))
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  })
  if (!response.ok) {
    throw new AstraFlowExpertsApiError(
      response.status,
      await readErrorMessage(response)
    )
  }
  return camelizeResponseKeys<T>(await response.json())
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as {
      message?: unknown
      error?: unknown
    }
    if (typeof body.message === "string") {
      return body.message
    }
    if (typeof body.error === "string") {
      return body.error
    }
  } catch {
    // Fall through to status text.
  }
  return response.statusText || "AstraFlow expert API request failed"
}

function camelizeResponseKeys<T>(value: unknown): T {
  if (Array.isArray(value)) {
    return value.map((item) => camelizeResponseKeys(item)) as T
  }

  if (!isPlainObject(value)) {
    return value as T
  }

  if (isProtobufTimestamp(value)) {
    return protobufTimestampToIso(value) as T
  }

  const output: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    output[snakeToCamel(key)] = camelizeResponseKeys(nestedValue)
  }

  return output as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

function isProtobufTimestamp(
  value: Record<string, unknown>
): value is { seconds: number | string; nanos?: number | string } {
  return (
    ("seconds" in value || "nanos" in value) &&
    (typeof value.seconds === "number" || typeof value.seconds === "string") &&
    (value.nanos === undefined ||
      typeof value.nanos === "number" ||
      typeof value.nanos === "string") &&
    Object.keys(value).every((key) => key === "seconds" || key === "nanos")
  )
}

function protobufTimestampToIso({
  nanos,
  seconds,
}: {
  seconds: number | string
  nanos?: number | string
}) {
  const secondsNumber =
    typeof seconds === "number" ? seconds : Number.parseFloat(seconds)
  const nanosNumber =
    typeof nanos === "number" ? nanos : Number.parseFloat(nanos ?? "0")

  if (!Number.isFinite(secondsNumber)) {
    return ""
  }

  return new Date(
    secondsNumber * 1000 +
      (Number.isFinite(nanosNumber) ? Math.floor(nanosNumber / 1_000_000) : 0)
  ).toISOString()
}

function snakeToCamel(value: string) {
  return value.replace(/_([a-z0-9])/g, (_, character: string) =>
    character.toUpperCase()
  )
}
