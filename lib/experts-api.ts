import type { paths } from "@/lib/generated/openapi/astraflow-api"

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

function getAstraFlowApiBaseUrl() {
  return (
    process.env.ASTRAFLOW_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_ASTRAFLOW_API_BASE_URL?.trim() ||
    "http://127.0.0.1:8000"
  ).replace(/\/+$/, "")
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
  return (await response.json()) as T
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.json()) as { message?: unknown; error?: unknown }
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
