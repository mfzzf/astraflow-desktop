import { randomUUID } from "node:crypto"
import { join } from "node:path"

import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import {
  removeStudioDirectory,
  removeStudioFile,
  safeFileName,
} from "@/lib/studio-file-storage"
import type {
  StudioPermissionMode,
  StudioSession,
  StudioTokenUsage,
} from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import {
  mapSession,
  normalizeSlashCommandDescriptors,
  normalizeTitle,
  nowIso,
  parseSlashCommandDescriptors,
} from "./helpers"
import { getStudioLocalProject, touchStudioLocalProject } from "./projects"
import type { CreateSessionInput, DbSessionRow } from "./types"
import {
  ensureStudioLocalWorkspaceForProject,
  getStudioWorkspace,
  touchStudioWorkspace,
} from "./workspaces"

export function listStudioSessions() {
  const rows = getDb()
    .prepare(
      `
        SELECT
          id,
          mode,
          title,
          workspace_id,
          project_id,
          permission_mode,
          chat_model,
          chat_runtime_id,
          chat_reasoning_effort,
          latest_run_usage,
          pinned_at,
          archived_at,
          EXISTS (
            SELECT 1
            FROM studio_messages
            WHERE studio_messages.session_id = studio_sessions.id
              AND studio_messages.status = 'streaming'
          ) AS is_running,
          created_at,
          updated_at
        FROM studio_sessions
        ORDER BY pinned_at IS NULL, pinned_at DESC, updated_at DESC
      `
    )
    .all() as DbSessionRow[]

  return rows.map(mapSession)
}

export function getStudioSession(sessionId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT
          id,
          mode,
          title,
          workspace_id,
          project_id,
          permission_mode,
          chat_model,
          chat_runtime_id,
          chat_reasoning_effort,
          latest_run_usage,
          pinned_at,
          archived_at,
          EXISTS (
            SELECT 1
            FROM studio_messages
            WHERE studio_messages.session_id = studio_sessions.id
              AND studio_messages.status = 'streaming'
          ) AS is_running,
          created_at,
          updated_at
        FROM studio_sessions
        WHERE id = ?
      `
    )
    .get(sessionId) as DbSessionRow | undefined

  return row ? mapSession(row) : null
}

export function getStudioSessionAvailableCommands(
  sessionId: string
): SlashCommandDescriptor[] {
  const row = getDb()
    .prepare(
      `
        SELECT available_commands
        FROM studio_sessions
        WHERE id = ?
      `
    )
    .get(sessionId) as { available_commands: string | null } | undefined

  return parseSlashCommandDescriptors(row?.available_commands)
}

export function setStudioSessionAvailableCommands(
  sessionId: string,
  commands: SlashCommandDescriptor[]
) {
  const result = getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET available_commands = ?
        WHERE id = ?
      `
    )
    .run(JSON.stringify(normalizeSlashCommandDescriptors(commands)), sessionId)

  return result.changes > 0
}

export function getLatestStudioAgentProviderSessionId(
  sessionId: string,
  runtimeId: string
) {
  const row = getDb()
    .prepare(
      `
        SELECT provider_session_id
        FROM studio_agent_provider_events
        WHERE session_id = ?
          AND runtime_id = ?
          AND provider_session_id IS NOT NULL
          AND provider_session_id != ''
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
    .get(sessionId, runtimeId) as
    { provider_session_id: string | null } | undefined

  return row?.provider_session_id ?? null
}

function resolveSessionWorkspaceSelection({
  workspaceId,
  projectId,
}: Pick<CreateSessionInput, "workspaceId" | "projectId">) {
  if (workspaceId === null) {
    if (projectId) {
      throw new Error(
        "A session cannot clear workspaceId while binding a local project."
      )
    }

    return { workspaceId: null, projectId: null }
  }

  if (workspaceId) {
    const workspace = getStudioWorkspace(workspaceId)

    if (!workspace) {
      throw new Error("Studio workspace was not found.")
    }

    if (workspace.type === "local") {
      if (projectId && projectId !== workspace.localProjectId) {
        throw new Error("Workspace and local project do not match.")
      }

      return {
        workspaceId: workspace.id,
        projectId: workspace.localProjectId,
      }
    }

    if (projectId) {
      throw new Error("A sandbox workspace cannot bind a local project.")
    }

    return { workspaceId: workspace.id, projectId: null }
  }

  if (projectId) {
    const project = getStudioLocalProject(projectId)

    if (!project) {
      throw new Error("Local project was not found.")
    }

    const workspace = ensureStudioLocalWorkspaceForProject(project)

    return { workspaceId: workspace.id, projectId: project.id }
  }

  return { workspaceId: null, projectId: null }
}

export function createStudioSession(input: CreateSessionInput) {
  const {
    mode,
    title,
    permissionMode = "ask",
    chatModel = null,
    chatRuntimeId = null,
    chatReasoningEffort = null,
  } = input
  const selection = resolveSessionWorkspaceSelection(input)
  const session: StudioSession = {
    id: randomUUID(),
    mode,
    title: normalizeTitle(title),
    workspaceId: selection.workspaceId,
    projectId: selection.projectId,
    permissionMode,
    chatModel,
    chatRuntimeId,
    chatReasoningEffort,
    latestRunUsage: null,
    pinnedAt: null,
    archivedAt: null,
    isRunning: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_sessions
          (
            id,
            mode,
            title,
            workspace_id,
            project_id,
            permission_mode,
            chat_model,
            chat_runtime_id,
            chat_reasoning_effort,
            latest_run_usage,
            pinned_at,
            archived_at,
            created_at,
            updated_at
          )
        VALUES
          (
            @id,
            @mode,
            @title,
            @workspaceId,
            @projectId,
            @permissionMode,
            @chatModel,
            @chatRuntimeId,
            @chatReasoningEffort,
            @latestRunUsage,
            @pinnedAt,
            @archivedAt,
            @createdAt,
            @updatedAt
          )
      `
    )
    .run(session)

  if (session.workspaceId) {
    touchStudioWorkspace(session.workspaceId)
  } else if (session.projectId) {
    touchStudioLocalProject(session.projectId)
  }

  return session
}

export function updateStudioSessionTitle(sessionId: string, title: string) {
  const normalized = normalizeTitle(title)
  const updatedAt = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET title = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(normalized, updatedAt, sessionId)

  return getStudioSession(sessionId)
}

export function updateStudioSessionPinned(sessionId: string, pinned: boolean) {
  const pinnedAt = pinned ? nowIso() : null

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET pinned_at = ?
        WHERE id = ?
      `
    )
    .run(pinnedAt, sessionId)

  return getStudioSession(sessionId)
}

export function updateStudioSessionArchived(
  sessionId: string,
  archived: boolean
) {
  const archivedAt = archived ? nowIso() : null

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET archived_at = ?
        WHERE id = ?
      `
    )
    .run(archivedAt, sessionId)

  return getStudioSession(sessionId)
}

export function updateStudioSessionProject(
  sessionId: string,
  projectId: string | null
) {
  if (!projectId) {
    return updateStudioSessionWorkspace(sessionId, null)
  }

  const project = getStudioLocalProject(projectId)

  if (!project) {
    return null
  }

  const workspace = ensureStudioLocalWorkspaceForProject(project)

  return updateStudioSessionWorkspace(sessionId, workspace.id)
}

export function updateStudioSessionWorkspace(
  sessionId: string,
  workspaceId: string | null
) {
  const workspace = workspaceId ? getStudioWorkspace(workspaceId) : null

  if (workspaceId && !workspace) {
    return null
  }

  const projectId =
    workspace?.type === "local" ? workspace.localProjectId : null
  const updatedAt = nowIso()

  const result = getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET workspace_id = ?,
            project_id = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(workspaceId, projectId, updatedAt, sessionId)

  if (result.changes > 0 && workspaceId) {
    touchStudioWorkspace(workspaceId)
  }

  return getStudioSession(sessionId)
}

export function updateStudioSessionPermissionMode(
  sessionId: string,
  permissionMode: StudioPermissionMode
) {
  const updatedAt = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET permission_mode = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(permissionMode, updatedAt, sessionId)

  return getStudioSession(sessionId)
}

export function updateStudioSessionChatPreferences(
  sessionId: string,
  input: {
    chatModel?: string | null
    chatRuntimeId?: string | null
    chatReasoningEffort?: string | null
  }
) {
  const current = getStudioSession(sessionId)

  if (!current) {
    return null
  }

  const next = {
    chatModel:
      input.chatModel !== undefined ? input.chatModel : current.chatModel,
    chatRuntimeId:
      input.chatRuntimeId !== undefined
        ? input.chatRuntimeId
        : current.chatRuntimeId,
    chatReasoningEffort:
      input.chatReasoningEffort !== undefined
        ? input.chatReasoningEffort
        : current.chatReasoningEffort,
  }

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET chat_model = ?,
            chat_runtime_id = ?,
            chat_reasoning_effort = ?
        WHERE id = ?
      `
    )
    .run(
      next.chatModel,
      next.chatRuntimeId,
      next.chatReasoningEffort,
      sessionId
    )

  return getStudioSession(sessionId)
}

export function updateStudioSessionLatestRunUsage(
  sessionId: string,
  usage: StudioTokenUsage | null
) {
  const updatedAt = nowIso()

  const result = getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET latest_run_usage = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(usage ? JSON.stringify(usage) : null, updatedAt, sessionId)

  return result.changes > 0
}

export function deleteStudioSession(sessionId: string) {
  const database = getDb()

  // Collect on-disk artifacts before the DB rows (and their storage paths)
  // are gone. File removal is best-effort so it never blocks the deletion.
  const storagePaths = new Set<string>()

  const mediaQueries = [
    `SELECT outputs.storage_path AS storage_path
       FROM studio_image_outputs AS outputs
       INNER JOIN studio_image_generations AS generations
         ON generations.id = outputs.generation_id
       WHERE generations.session_id = ?`,
    `SELECT outputs.storage_path AS storage_path
       FROM studio_audio_outputs AS outputs
       INNER JOIN studio_audio_generations AS generations
         ON generations.id = outputs.generation_id
       WHERE generations.session_id = ?`,
    `SELECT outputs.storage_path AS storage_path
       FROM studio_video_outputs AS outputs
       INNER JOIN studio_video_generations AS generations
         ON generations.id = outputs.generation_id
       WHERE generations.session_id = ?`,
    `SELECT storage_path FROM studio_session_files WHERE session_id = ?`,
  ]

  for (const sql of mediaQueries) {
    try {
      const rows = database.prepare(sql).all(sessionId) as Array<{
        storage_path: string | null
      }>

      for (const row of rows) {
        if (row.storage_path) {
          storagePaths.add(row.storage_path)
        }
      }
    } catch {
      // Media tables may not exist yet; ignore and continue.
    }
  }

  const result = database
    .prepare(
      `
        DELETE FROM studio_sessions
        WHERE id = ?
      `
    )
    .run(sessionId)

  if (result.changes > 0) {
    for (const storagePath of storagePaths) {
      try {
        removeStudioFile(storagePath)
      } catch {
        // Best-effort cleanup; a missing or unreadable file must not fail.
      }
    }

    for (const directory of [
      join("attachments", safeFileName(sessionId)),
      join("generated", safeFileName(sessionId)),
    ]) {
      try {
        removeStudioDirectory(directory)
      } catch {
        // Best-effort cleanup; ignore removal errors.
      }
    }
  }

  return result.changes > 0
}
