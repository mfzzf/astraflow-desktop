import { randomUUID } from "node:crypto"

import type { CodeBoxGithubStatus } from "@/lib/codebox-types"
import type {
  StudioExaApiKey,
  StudioModelverseApiKey,
  StudioOAuthStatus,
  StudioOAuthTokens,
} from "@/lib/studio-types"

import {
  CODEBOX_GITHUB_SETTING,
  deleteStudioSetting,
  maskStudioApiKey,
  nowIso,
  readSecretSetting,
  readStudioSetting,
  STUDIO_ASTRAFLOW_API_KEY_SESSION_SETTING,
  STUDIO_EXA_API_KEY_SETTING,
  STUDIO_MODELVERSE_API_KEY_SETTING,
  STUDIO_OAUTH_SETTING,
  writeSecretSetting,
  writeStudioSetting,
} from "./helpers"
import { getSelectedUCloudProjectId } from "./settings"
import type {
  CodeBoxGithubTokens,
  StudioAstraFlowApiKeySessionStatus,
  StudioAstraFlowApiKeyStatus,
} from "./types"

export type {
  StudioAstraFlowApiKeySessionStatus,
  StudioAstraFlowApiKeyStatus,
} from "./types"

export function createManualStudioModelverseApiKeyRecord(apiKey: string) {
  const normalized = apiKey.trim()

  return {
    id: `manual-${randomUUID()}`,
    name: "AstraFlow API Key",
    key: normalized,
    projectId: "manual",
  } satisfies Omit<StudioModelverseApiKey, "updatedAt">
}

export function getStudioAstraFlowApiKeyStatus(): StudioAstraFlowApiKeyStatus {
  const apiKey = getStudioModelverseApiKey()

  if (!apiKey?.key) {
    return {
      configured: false,
      keyPreview: null,
      updatedAt: null,
    }
  }

  return {
    configured: true,
    keyPreview: maskStudioApiKey(apiKey.key),
    updatedAt: apiKey.updatedAt,
    fullKey: apiKey.key,
  }
}

export function saveStudioAstraFlowApiKeySession() {
  const apiKey = getStudioModelverseApiKey()

  if (!apiKey) {
    return null
  }

  const updatedAt = writeStudioSetting(
    STUDIO_ASTRAFLOW_API_KEY_SESSION_SETTING,
    JSON.stringify({
      modelverseApiKeyId: apiKey.id,
      keyPreview: maskStudioApiKey(apiKey.key),
      createdAt: nowIso(),
    })
  )

  return {
    authenticated: true,
    updatedAt,
  } satisfies StudioAstraFlowApiKeySessionStatus
}

export function getStudioAstraFlowApiKeySessionStatus(): StudioAstraFlowApiKeySessionStatus {
  const apiKey = getStudioModelverseApiKey()
  const row = readStudioSetting(STUDIO_ASTRAFLOW_API_KEY_SESSION_SETTING)

  if (!apiKey || !row?.value) {
    return {
      authenticated: false,
      updatedAt: null,
    }
  }

  try {
    const parsed = JSON.parse(row.value) as {
      modelverseApiKeyId?: string
    }

    return {
      authenticated: parsed.modelverseApiKeyId === apiKey.id,
      updatedAt: row.updated_at,
    }
  } catch {
    return {
      authenticated: false,
      updatedAt: null,
    }
  }
}

export function clearStudioAstraFlowApiKeySession() {
  deleteStudioSetting(STUDIO_ASTRAFLOW_API_KEY_SESSION_SETTING)
}

export function getStudioOAuthTokens(): StudioOAuthTokens | null {
  const row = readSecretSetting(STUDIO_OAUTH_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      accessToken?: string
      refreshToken?: string | null
      tokenType?: string | null
      expiresAt?: number | null
      email?: string | null
    }

    if (!parsed.accessToken) {
      return null
    }

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
      tokenType: parsed.tokenType ?? null,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : null,
      email: parsed.email ?? null,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function getStudioOAuthStatus(): StudioOAuthStatus {
  const tokens = getStudioOAuthTokens()

  return {
    configured: Boolean(tokens?.accessToken),
    email: tokens?.email ?? null,
    expiresAt: tokens?.expiresAt ?? null,
    updatedAt: tokens?.updatedAt ?? null,
  }
}

export function saveStudioOAuthTokens(
  input: Omit<StudioOAuthTokens, "updatedAt">
) {
  const updatedAt = writeSecretSetting(
    STUDIO_OAUTH_SETTING,
    JSON.stringify({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? null,
      tokenType: input.tokenType ?? null,
      expiresAt: input.expiresAt ?? null,
      email: input.email ?? null,
    })
  )

  return {
    configured: true,
    email: input.email ?? null,
    expiresAt: input.expiresAt ?? null,
    updatedAt,
  } satisfies StudioOAuthStatus
}

export function clearStudioOAuthTokens() {
  deleteStudioSetting(STUDIO_OAUTH_SETTING)
}

export function getCodeBoxGithubTokens(): CodeBoxGithubTokens | null {
  const row = readSecretSetting(CODEBOX_GITHUB_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      accessToken?: string
      login?: string | null
      name?: string | null
      email?: string | null
    }

    if (!parsed.accessToken) {
      return null
    }

    return {
      configured: true,
      accessToken: parsed.accessToken,
      login: parsed.login ?? null,
      name: parsed.name ?? null,
      email: parsed.email ?? null,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function getCodeBoxGithubStatus(): CodeBoxGithubStatus {
  const tokens = getCodeBoxGithubTokens()

  return {
    configured: Boolean(tokens?.accessToken),
    login: tokens?.login ?? null,
    name: tokens?.name ?? null,
    email: tokens?.email ?? null,
    updatedAt: tokens?.updatedAt ?? null,
  }
}

export function saveCodeBoxGithubTokens({
  accessToken,
  login,
  name,
  email,
}: {
  accessToken: string
  login?: string | null
  name?: string | null
  email?: string | null
}) {
  const updatedAt = writeSecretSetting(
    CODEBOX_GITHUB_SETTING,
    JSON.stringify({
      accessToken,
      login: login ?? null,
      name: name ?? null,
      email: email ?? null,
    })
  )

  return {
    configured: true,
    login: login ?? null,
    name: name ?? null,
    email: email ?? null,
    updatedAt,
  } satisfies CodeBoxGithubStatus
}

export function clearCodeBoxGithubTokens() {
  deleteStudioSetting(CODEBOX_GITHUB_SETTING)
}

export function getStudioModelverseApiKey(): StudioModelverseApiKey | null {
  const row = readSecretSetting(STUDIO_MODELVERSE_API_KEY_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      id?: string
      name?: string
      key?: string
      projectId?: string
    }

    if (!parsed.id || !parsed.name || !parsed.key || !parsed.projectId) {
      return null
    }

    const selectedProjectId = getSelectedUCloudProjectId()

    if (
      selectedProjectId &&
      parsed.projectId !== "manual" &&
      parsed.projectId !== selectedProjectId
    ) {
      return null
    }

    return {
      id: parsed.id,
      name: parsed.name,
      key: parsed.key,
      projectId: parsed.projectId,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function saveStudioModelverseApiKey(
  input: Omit<StudioModelverseApiKey, "updatedAt">
) {
  const updatedAt = writeSecretSetting(
    STUDIO_MODELVERSE_API_KEY_SETTING,
    JSON.stringify({
      id: input.id,
      name: input.name,
      key: input.key,
      projectId: input.projectId,
    })
  )

  return {
    ...input,
    updatedAt,
  } satisfies StudioModelverseApiKey
}

export function clearStudioModelverseApiKey() {
  deleteStudioSetting(STUDIO_MODELVERSE_API_KEY_SETTING)
}

export function getStudioExaApiKey(): StudioExaApiKey | null {
  const row = readStudioSetting(STUDIO_EXA_API_KEY_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      key?: string
    }

    if (!parsed.key) {
      return null
    }

    return {
      key: parsed.key,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function saveStudioExaApiKey(key: string) {
  const updatedAt = writeStudioSetting(
    STUDIO_EXA_API_KEY_SETTING,
    JSON.stringify({ key })
  )

  return {
    key,
    updatedAt,
  } satisfies StudioExaApiKey
}

export function clearStudioExaApiKey() {
  deleteStudioSetting(STUDIO_EXA_API_KEY_SETTING)
}
