import {
  deleteStudioSetting,
  readStudioSetting,
  SELECTED_UCLOUD_PROJECT_SETTING,
  STUDIO_AGENT_MODEL_SETTINGS,
  STUDIO_SESSION_SANDBOX_VOLUME_SETTING,
  writeStudioSetting,
} from "./helpers"

export function getStudioSessionSandboxVolumeRecord() {
  const row = readStudioSetting(STUDIO_SESSION_SANDBOX_VOLUME_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      volumeId?: string
      name?: string
    }

    if (!parsed.volumeId || !parsed.name) {
      return null
    }

    return {
      volumeId: parsed.volumeId,
      name: parsed.name,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function saveStudioSessionSandboxVolumeRecord({
  volumeId,
  name,
}: {
  volumeId: string
  name: string
}) {
  const updatedAt = writeStudioSetting(
    STUDIO_SESSION_SANDBOX_VOLUME_SETTING,
    JSON.stringify({ volumeId, name })
  )

  return {
    volumeId,
    name,
    updatedAt,
  }
}

export function clearStudioSessionSandboxVolumeRecord() {
  deleteStudioSetting(STUDIO_SESSION_SANDBOX_VOLUME_SETTING)
}

export function getStudioAgentModelSettingsRecord() {
  const row = readStudioSetting(STUDIO_AGENT_MODEL_SETTINGS)

  if (!row?.value) {
    return null
  }

  try {
    return {
      value: JSON.parse(row.value) as unknown,
      updatedAt: row.updated_at,
    }
  } catch {
    return null
  }
}

export function saveStudioAgentModelSettingsRecord(value: unknown) {
  return writeStudioSetting(STUDIO_AGENT_MODEL_SETTINGS, JSON.stringify(value))
}

export function getSelectedUCloudProjectId() {
  const row = readStudioSetting(SELECTED_UCLOUD_PROJECT_SETTING)

  if (!row?.value) {
    return null
  }

  try {
    const parsed = JSON.parse(row.value) as {
      projectId?: string
    }

    return parsed.projectId?.trim() || null
  } catch {
    return row.value.trim() || null
  }
}

export function saveSelectedUCloudProjectId(projectId: string) {
  const normalizedProjectId = projectId.trim()

  if (!normalizedProjectId) {
    deleteStudioSetting(SELECTED_UCLOUD_PROJECT_SETTING)
    return null
  }

  const updatedAt = writeStudioSetting(
    SELECTED_UCLOUD_PROJECT_SETTING,
    JSON.stringify({
      projectId: normalizedProjectId,
    })
  )

  return {
    projectId: normalizedProjectId,
    updatedAt,
  }
}
