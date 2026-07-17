import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"
import { resolveModelverseProjectId } from "@/lib/modelverse-api-keys"
import {
  getSelectedUCloudProjectId,
  getStudioModelverseApiKey,
} from "@/lib/studio-db"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"
import {
  callUCloudAction,
  type UCloudCredentials,
} from "@/lib/ucloud"

const LIST_PAGE_SIZE = 50
const CHAT_MODEL_CATALOG_CACHE_TTL = 60_000

type SquareModel = {
  Id?: string
  Name?: string
  OutputModalities?: string[] | null
}

type ListResponse = {
  TotalCount?: number | string
  SquareModels?: SquareModel[] | Record<string, SquareModel>
}

type CatalogCacheEntry = {
  expiresAt: number
  modelKeys: Set<string>
}

const catalogCache = new Map<string, CatalogCacheEntry>()
const pendingCatalogRequests = new Map<string, Promise<Set<string>>>()

function normalizeList(data: ListResponse["SquareModels"]): SquareModel[] {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.values(data)
  }

  return []
}

function normalizeTotal(value: ListResponse["TotalCount"], fallback: number) {
  if (typeof value === "number") {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

function normalizeModelKey(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ""
}

function hasPublisherModelReference(model: SquareModel) {
  return [model.Id, model.Name].some((value) =>
    normalizeModelKey(value).includes("publisher")
  )
}

function outputsText(model: SquareModel) {
  return (model.OutputModalities ?? []).some(
    (modality) => normalizeModelKey(modality) === "text"
  )
}

function getCatalogModelKeys(models: SquareModel[]) {
  const keys = new Set<string>()

  for (const model of models) {
    if (hasPublisherModelReference(model) || !outputsText(model)) {
      continue
    }

    for (const value of [model.Id, model.Name]) {
      const key = normalizeModelKey(value)

      if (key) {
        keys.add(key)
      }
    }
  }

  return keys
}

async function fetchChatModelCatalog({
  credentials,
  projectId,
}: {
  credentials: UCloudCredentials
  projectId: string
}) {
  const fetchPage = (offset: number) =>
    callUCloudAction<ListResponse>({
      credentials,
      params: {
        Action: "ListUFSquareModel",
        ...(projectId ? { ProjectId: projectId } : {}),
        Offset: offset,
        Limit: LIST_PAGE_SIZE,
        OrderBy: "Name",
        Order: "Asc",
      },
    })

  const first = await fetchPage(0)
  const models = normalizeList(first.SquareModels)
  const total = normalizeTotal(first.TotalCount, models.length)

  for (let offset = LIST_PAGE_SIZE; offset < total; offset += LIST_PAGE_SIZE) {
    const page = await fetchPage(offset)
    models.push(...normalizeList(page.SquareModels))
  }

  return getCatalogModelKeys(models)
}

async function loadChatModelCatalog({
  credentials,
  projectId,
}: {
  credentials: UCloudCredentials
  projectId: string
}) {
  const cached = catalogCache.get(projectId)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.modelKeys
  }

  let pending = pendingCatalogRequests.get(projectId)

  if (!pending) {
    pending = fetchChatModelCatalog({ credentials, projectId })
      .then((modelKeys) => {
        catalogCache.set(projectId, {
          expiresAt: Date.now() + CHAT_MODEL_CATALOG_CACHE_TTL,
          modelKeys,
        })
        return modelKeys
      })
      .finally(() => {
        pendingCatalogRequests.delete(projectId)
      })
    pendingCatalogRequests.set(projectId, pending)
  }

  return pending
}

export function filterAgentModelsByModelSquare(
  models: AgentModelDefinition[],
  modelKeys: Iterable<string>
) {
  const availableKeys = new Set(
    Array.from(modelKeys, (modelKey) => normalizeModelKey(modelKey)).filter(
      Boolean
    )
  )

  return models.filter((model) => {
    if (!model.builtin) {
      return true
    }

    return [model.id, model.providerModel].some((value) =>
      availableKeys.has(normalizeModelKey(value))
    )
  })
}

export async function listAgentModelsAvailableInModelSquare(
  models: AgentModelDefinition[]
) {
  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return filterAgentModelsByModelSquare(models, [])
  }

  const projectId = await resolveModelverseProjectId({
    credentials,
    preferredProjectId:
      getSelectedUCloudProjectId() ||
      getStudioModelverseApiKey()?.projectId ||
      credentials.projectId,
  })
  const modelKeys = await loadChatModelCatalog({ credentials, projectId })

  return filterAgentModelsByModelSquare(models, modelKeys)
}
