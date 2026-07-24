import type {
  ExpertDetailData,
  ExpertSummonData,
  ExpertTypeFilter,
  ExpertsCatalogData,
} from "./types"

type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; message?: string; error?: unknown }

export async function readExpertJson<T>(response: Response) {
  const payload = (await response.json()) as ApiEnvelope<T>

  if (!response.ok || !payload.ok) {
    throw new Error(
      (payload.ok ? "" : payload.message) || `Request failed (${response.status})`
    )
  }

  return payload.data
}

export async function fetchExpertsCatalog({
  categoryId,
  pageSize,
  pageToken,
  query,
  signal,
  type,
}: {
  categoryId: string
  pageSize: number
  pageToken: string
  query: string
  signal?: AbortSignal
  type: ExpertTypeFilter
}) {
  const params = new URLSearchParams()
  params.set("pageSize", String(pageSize))

  if (pageToken) {
    params.set("pageToken", pageToken)
  }
  if (query) {
    params.set("query", query)
  }
  if (categoryId !== "__all__") {
    params.set("categoryId", categoryId)
  }
  if (type !== "all") {
    params.set("type", type)
  }

  const response = await fetch(`/api/experts?${params.toString()}`, {
    cache: "no-store",
    signal,
  })

  return readExpertJson<ExpertsCatalogData>(response)
}

export async function fetchExpertDetail(expertId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/experts/${encodeURIComponent(expertId)}`, {
    cache: "no-store",
    signal,
  })

  return readExpertJson<ExpertDetailData>(response)
}

export async function summonExpert(expertId: string, prompt?: string) {
  const response = await fetch(
    `/api/experts/${encodeURIComponent(expertId)}/summon`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt?.trim() || "" }),
    }
  )

  return readExpertJson<ExpertSummonData>(response)
}
