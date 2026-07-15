import { callUCloudAction, type UCloudCredentials } from "@/lib/ucloud"
import { MODELVERSE_BASE_URL_V1 } from "@/lib/modelverse-config"
import { withAstraflowClientHeaders } from "@/lib/review-client"

export type ModelverseApiKeyOption = {
  id: string
  name: string
}

export type ModelverseApiKey = ModelverseApiKeyOption & {
  key?: string
  status: number | null
  createdAt: number | null
  expireTime: number | null
  modelverseDisabled: number | null
  sandboxDisabled: number | null
  dailyLimitAmount: string
  dailyUsedAmount: string
  monthlyLimitAmount: string
  monthlyUsedAmount: string
  grantAllModels: boolean
  grantedModels: string[]
  ipWhitelist: string
}

export type ModelverseApiKeyMutationInput = {
  name?: string
  modelverseDisabled?: number
  sandboxDisabled?: number
  dailyLimitAmount?: string
  monthlyLimitAmount?: string
  grantAllModels?: boolean
  grantedModels?: string[]
  ipWhitelist?: string
}

export type UCloudProjectOption = {
  id: string
  name: string
  memberCount: number | null
  resourceCount: number | null
  createdAt: number | null
  isDefault: boolean | null
}

type ModelverseModelsResponse = {
  data?: unknown[]
  error?: {
    message?: string
  }
}

type UMInferAPIKey = {
  KeyId?: string
  Name?: string
  Key?: string
  Status?: number
  CreateTime?: number
  ExpireTime?: number
  ModelverseDisabled?: number
  SandBoxDisabled?: number
  DailyLimitAmount?: string | number
  DailyUsedAmount?: string | number
  MonthlyLimitAmount?: string | number
  MonthlyUsedAmount?: string | number
  GrantAllModels?: boolean
  GrantedModels?: string[] | string
  IPWhitelist?: string
}

type ListUMInferAPIKeyResponse = {
  Action?: string
  RetCode?: number
  Message?: string
  Data?: UMInferAPIKey[] | Record<string, UMInferAPIKey>
  TotalCount?: number
}

type CreateUMInferAPIKeyResponse = {
  Action?: string
  RetCode?: number
  Message?: string
  Data?: UMInferAPIKey
  TotalCount?: number
}

type UpdateUMInferAPIKeyResponse = {
  Action?: string
  RetCode?: number
  Message?: string
  UminferID?: string
}

type DeleteUMInferAPIKeyResponse = {
  Action?: string
  RetCode?: number
  Message?: string
  UminferID?: string
}

type UCloudProject = {
  ProjectId?: string
  ProjectName?: string
  ParentId?: string
  ParentName?: string
  CreateTime?: number
  IsDefault?: boolean
  MemberCount?: number
  ResourceCount?: number
}

type GetProjectListResponse = {
  ProjectCount?: number
  ProjectSet?: UCloudProject[] | Record<string, UCloudProject>
}

function normalizeApiKeys(data: ListUMInferAPIKeyResponse["Data"]) {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.values(data)
  }

  return []
}

function normalizeAmount(value: string | number | undefined) {
  if (value === undefined || value === null) {
    return ""
  }

  return String(value)
}

function normalizeGrantedModels(value: UMInferAPIKey["GrantedModels"]) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean)
  }

  if (typeof value !== "string") {
    return []
  }

  const trimmed = value.trim()

  if (!trimmed || trimmed === "all") {
    return trimmed ? [trimmed] : []
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown

    if (Array.isArray(parsed)) {
      return parsed.map(String).filter(Boolean)
    }
  } catch {
    // Fall through to comma/newline splitting for legacy response shapes.
  }

  return trimmed
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function toModelverseApiKey(apiKey: UMInferAPIKey): ModelverseApiKey | null {
  if (!apiKey.KeyId) {
    return null
  }

  return {
    id: apiKey.KeyId,
    name: apiKey.Name || apiKey.KeyId || "Unnamed key",
    key: apiKey.Key,
    status: typeof apiKey.Status === "number" ? apiKey.Status : null,
    createdAt: typeof apiKey.CreateTime === "number" ? apiKey.CreateTime : null,
    expireTime:
      typeof apiKey.ExpireTime === "number" ? apiKey.ExpireTime : null,
    modelverseDisabled:
      typeof apiKey.ModelverseDisabled === "number"
        ? apiKey.ModelverseDisabled
        : null,
    sandboxDisabled:
      typeof apiKey.SandBoxDisabled === "number"
        ? apiKey.SandBoxDisabled
        : null,
    dailyLimitAmount: normalizeAmount(apiKey.DailyLimitAmount),
    dailyUsedAmount: normalizeAmount(apiKey.DailyUsedAmount),
    monthlyLimitAmount: normalizeAmount(apiKey.MonthlyLimitAmount),
    monthlyUsedAmount: normalizeAmount(apiKey.MonthlyUsedAmount),
    grantAllModels: apiKey.GrantAllModels !== false,
    grantedModels: normalizeGrantedModels(apiKey.GrantedModels),
    ipWhitelist: apiKey.IPWhitelist ?? "",
  }
}

function addOptionalParam(
  params: Record<string, string | number | boolean>,
  key: string,
  value: string | number | boolean | undefined,
  options: { omitEmptyString?: boolean } = {}
) {
  if (value === undefined) {
    return
  }

  if (
    options.omitEmptyString &&
    typeof value === "string" &&
    value.trim() === ""
  ) {
    return
  }

  params[key] = value
}

function addApiKeyMutationParams({
  params,
  input,
  omitEmptyStrings,
}: {
  params: Record<string, string | number | boolean>
  input: ModelverseApiKeyMutationInput
  omitEmptyStrings: boolean
}) {
  addOptionalParam(params, "Name", input.name, {
    omitEmptyString: omitEmptyStrings,
  })
  addOptionalParam(params, "ModelverseDisabled", input.modelverseDisabled)
  addOptionalParam(params, "SandBoxDisabled", input.sandboxDisabled)
  addOptionalParam(params, "DailyLimitAmount", input.dailyLimitAmount, {
    omitEmptyString: omitEmptyStrings,
  })
  addOptionalParam(params, "MonthlyLimitAmount", input.monthlyLimitAmount, {
    omitEmptyString: omitEmptyStrings,
  })
  addOptionalParam(params, "GrantAllModels", input.grantAllModels)

  if (input.grantAllModels === false || input.grantedModels !== undefined) {
    addOptionalParam(
      params,
      "GrantedModels",
      JSON.stringify(input.grantedModels ?? []),
      { omitEmptyString: false }
    )
  }

  addOptionalParam(params, "IPWhitelist", input.ipWhitelist, {
    omitEmptyString: omitEmptyStrings,
  })
}

function normalizeProjects(data: GetProjectListResponse["ProjectSet"]) {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.values(data)
  }

  return []
}

function getProjectId(project: UCloudProject) {
  return project.ProjectId?.trim() || ""
}

export async function listUCloudProjects({
  credentials,
}: {
  credentials: UCloudCredentials
}): Promise<UCloudProjectOption[]> {
  const response = await callUCloudAction<GetProjectListResponse>({
    credentials,
    params: {
      Action: "GetProjectList",
    },
  })
  const projects = normalizeProjects(response.ProjectSet)

  return projects
    .map((project) => {
      const id = getProjectId(project)

      return {
        id,
        name: project.ProjectName || id || "Unnamed project",
        memberCount:
          typeof project.MemberCount === "number" ? project.MemberCount : null,
        resourceCount:
          typeof project.ResourceCount === "number"
            ? project.ResourceCount
            : null,
        createdAt:
          typeof project.CreateTime === "number" ? project.CreateTime : null,
        isDefault:
          typeof project.IsDefault === "boolean" ? project.IsDefault : null,
      }
    })
    .filter((project) => project.id)
}

export function getDefaultUCloudProject(projects: UCloudProjectOption[]) {
  return (
    projects.find((project) => project.isDefault === true) ??
    projects.find((project) => project.id.trim()) ??
    null
  )
}

export async function resolveModelverseProjectId({
  credentials,
  preferredProjectId,
}: {
  credentials: UCloudCredentials
  preferredProjectId?: string
}) {
  const projects = await listUCloudProjects({ credentials })
  const normalizedPreferredProjectId = preferredProjectId?.trim()

  if (
    normalizedPreferredProjectId &&
    projects.some((project) => project.id === normalizedPreferredProjectId)
  ) {
    return normalizedPreferredProjectId
  }

  const project = getDefaultUCloudProject(projects)

  if (!project?.id) {
    throw new Error("No UCloud project is available for Modelverse API keys.")
  }

  return project.id
}

export async function listModelverseApiKeys({
  credentials,
  projectId,
  includeDisabled = false,
}: {
  credentials: UCloudCredentials
  projectId: string
  includeDisabled?: boolean
}): Promise<ModelverseApiKey[]> {
  const response = await callUCloudAction<ListUMInferAPIKeyResponse>({
    credentials,
    params: {
      Action: "ListUMInferAPIKey",
      ProjectId: projectId,
      Offset: 0,
      Limit: 100,
    },
  })

  return normalizeApiKeys(response.Data)
    .map(toModelverseApiKey)
    .filter((apiKey): apiKey is ModelverseApiKey => Boolean(apiKey))
    .filter(
      (apiKey) =>
        (apiKey.status === null || apiKey.status === 1) &&
        (includeDisabled || apiKey.modelverseDisabled !== 1)
    )
}

export async function findModelverseApiKey({
  credentials,
  projectId,
  apiKeyId,
}: {
  credentials: UCloudCredentials
  projectId: string
  apiKeyId: string
}) {
  const apiKeys = await listModelverseApiKeys({
    credentials,
    projectId,
  })

  return apiKeys.find((apiKey) => apiKey.id === apiKeyId)
}

export async function createModelverseApiKey({
  credentials,
  projectId,
  input,
}: {
  credentials: UCloudCredentials
  projectId: string
  input: ModelverseApiKeyMutationInput & { name: string }
}) {
  const params: Record<string, string | number | boolean> = {
    Action: "CreateUMInferAPIKey",
    ProjectId: projectId,
    Name: input.name,
  }

  addApiKeyMutationParams({
    params,
    input,
    omitEmptyStrings: true,
  })

  const response = await callUCloudAction<CreateUMInferAPIKeyResponse>({
    credentials,
    params,
  })

  return response.Data ? toModelverseApiKey(response.Data) : null
}

export async function updateModelverseApiKey({
  credentials,
  projectId,
  apiKeyId,
  input,
}: {
  credentials: UCloudCredentials
  projectId: string
  apiKeyId: string
  input: ModelverseApiKeyMutationInput
}) {
  const params: Record<string, string | number | boolean> = {
    Action: "UpdateUMInferAPIKey",
    ProjectId: projectId,
    KeyId: apiKeyId,
  }

  addApiKeyMutationParams({
    params,
    input,
    omitEmptyStrings: false,
  })

  return callUCloudAction<UpdateUMInferAPIKeyResponse>({
    credentials,
    params,
  })
}

export async function deleteModelverseApiKey({
  credentials,
  projectId,
  apiKeyId,
}: {
  credentials: UCloudCredentials
  projectId: string
  apiKeyId: string
}) {
  return callUCloudAction<DeleteUMInferAPIKeyResponse>({
    credentials,
    params: {
      Action: "DeleteUMInferAPIKey",
      ProjectId: projectId,
      KeyId: apiKeyId,
    },
  })
}

export async function validateModelverseApiKey(apiKey: string) {
  const normalized = apiKey.trim()

  if (!normalized) {
    throw new Error("Enter a Modelverse API key.")
  }

  let response: Response

  try {
    response = await fetch(`${MODELVERSE_BASE_URL_V1}/models`, {
      method: "GET",
      headers: withAstraflowClientHeaders({
        Authorization: `Bearer ${normalized}`,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    throw new Error("Unable to reach Modelverse to validate this API key.")
  }

  const payload = (await response
    .json()
    .catch(() => null)) as ModelverseModelsResponse | null

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        "The API key could not be validated by Modelverse."
    )
  }

  return {
    modelCount: Array.isArray(payload?.data) ? payload.data.length : null,
  }
}
