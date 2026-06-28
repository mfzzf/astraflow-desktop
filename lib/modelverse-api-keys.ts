import { callUCloudAction, type UCloudCredentials } from "@/lib/ucloud"

export type ModelverseApiKeyOption = {
  id: string
  name: string
}

export type ModelverseApiKey = ModelverseApiKeyOption & {
  key?: string
}

type UMInferAPIKey = {
  KeyId?: string
  Name?: string
  Key?: string
  Status?: number
  ModelverseDisabled?: number
}

type ListUMInferAPIKeyResponse = {
  Action?: string
  RetCode?: number
  Message?: string
  Data?: UMInferAPIKey[] | Record<string, UMInferAPIKey>
  TotalCount?: number
}

type UCloudProject = {
  ProjectId?: string
  ProjectName?: string
  Name?: string
}

type GetProjectListResponse = {
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

function normalizeProjects(data: GetProjectListResponse["ProjectSet"]) {
  if (Array.isArray(data)) {
    return data
  }

  if (data && typeof data === "object") {
    return Object.values(data)
  }

  return []
}

export async function resolveModelverseProjectId({
  credentials,
  preferredProjectId,
}: {
  credentials: UCloudCredentials
  preferredProjectId?: string
}) {
  if (preferredProjectId?.trim()) {
    return preferredProjectId.trim()
  }

  const response = await callUCloudAction<GetProjectListResponse>({
    credentials,
    params: {
      Action: "GetProjectList",
    },
  })

  const project = normalizeProjects(response.ProjectSet).find((item) =>
    item.ProjectId?.trim()
  )

  if (!project?.ProjectId) {
    throw new Error("No UCloud project is available for Modelverse API keys.")
  }

  return project.ProjectId
}

export async function listModelverseApiKeys({
  credentials,
  projectId,
}: {
  credentials: UCloudCredentials
  projectId: string
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
    .filter(
      (apiKey) =>
        apiKey.KeyId &&
        (apiKey.Status === undefined || apiKey.Status === 1) &&
        apiKey.ModelverseDisabled !== 1
    )
    .map((apiKey) => ({
      id: apiKey.KeyId as string,
      name: apiKey.Name || apiKey.KeyId || "Unnamed key",
      key: apiKey.Key,
    }))
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
