import { randomUUID } from "node:crypto"
import { join } from "node:path"

import { removeAcpAttachmentDirectory } from "@/lib/agent/acp/attachments"
import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import {
  removeStudioDirectory,
  removeStudioFile,
  safeFileName,
} from "@/lib/studio-file-storage"
import type {
  StudioPublicPermissionMode,
  StudioSession,
  StudioStoredPermissionMode,
  StudioTokenUsage,
  StudioWorkspace,
} from "@/lib/studio-types"
import {
  isRuntimePreambleSessionTitle,
  recoverSessionTitleFromUserPrompt,
  RUNTIME_PREAMBLE_TITLE_PREFIXES,
} from "@/lib/studio-session-title"

import { getStudioDatabase as getDb } from "./connection"
import {
  mapSession,
  normalizeSlashCommandDescriptors,
  normalizeTitle,
  nowIso,
  parseSlashCommandDescriptors,
  STUDIO_LOCAL_FULL_ACCESS_GRANT_VERSION,
  STUDIO_PERMISSION_SCHEMA_VERSION,
} from "./helpers"
import { getStudioLocalProject, touchStudioLocalProject } from "./projects"
import type { CreateSessionInput, DbSessionRow } from "./types"
import {
  ensureStudioLocalWorkspaceForProject,
  getStudioWorkspace,
  touchStudioWorkspace,
} from "./workspaces"

function repairPollutedRuntimeSessionTitles() {
  const db = getDb()
  const titleConditions = RUNTIME_PREAMBLE_TITLE_PREFIXES.map(
    () => "session.title LIKE ?"
  ).join(" OR ")
  const sessions = db
    .prepare(
      `
        SELECT
          session.id,
          (
            SELECT message.content
            FROM studio_messages AS message
            WHERE message.session_id = session.id
              AND message.role = 'user'
              AND message.visible = 1
            ORDER BY message.created_at ASC
            LIMIT 1
          ) AS first_user_prompt
        FROM studio_sessions AS session
        WHERE ${titleConditions}
      `
    )
    .all(
      ...RUNTIME_PREAMBLE_TITLE_PREFIXES.map((prefix) => `${prefix}%`)
    ) as Array<{
    id: string
    first_user_prompt: string | null
  }>
  const update = db.prepare("UPDATE studio_sessions SET title = ? WHERE id = ?")

  for (const session of sessions) {
    update.run(
      normalizeTitle(
        recoverSessionTitleFromUserPrompt(session.first_user_prompt ?? "")
      ),
      session.id
    )
  }
}

function repairPollutedRuntimeSessionRow(row: DbSessionRow) {
  if (!isRuntimePreambleSessionTitle(row.title)) {
    return row
  }

  const database = getDb()
  const firstUserPrompt = database
    .prepare(
      `
        SELECT content
        FROM studio_messages
        WHERE session_id = ?
          AND role = 'user'
          AND visible = 1
        ORDER BY created_at ASC
        LIMIT 1
      `
    )
    .get(row.id) as { content: string | null } | undefined
  const title = normalizeTitle(
    recoverSessionTitleFromUserPrompt(firstUserPrompt?.content ?? "")
  )

  database
    .prepare("UPDATE studio_sessions SET title = ? WHERE id = ?")
    .run(title, row.id)

  return { ...row, title }
}

export function listStudioSessions() {
  repairPollutedRuntimeSessionTitles()
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
          permission_schema_version,
          local_full_access_grant_version,
          local_full_access_granted_at,
          local_full_access_grant_scope,
          (
            SELECT type
            FROM studio_workspaces
            WHERE studio_workspaces.id = studio_sessions.workspace_id
          ) AS workspace_type,
          (
            SELECT origin
            FROM studio_workspaces
            WHERE studio_workspaces.id = studio_sessions.workspace_id
          ) AS workspace_origin,
          (
            SELECT created_by_session_id
            FROM studio_workspaces
            WHERE studio_workspaces.id = studio_sessions.workspace_id
          ) AS workspace_created_by_session_id,
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
        WHERE NOT EXISTS (
          SELECT 1
          FROM studio_scheduled_task_runs
          WHERE studio_scheduled_task_runs.session_id = studio_sessions.id
        )
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
          permission_schema_version,
          local_full_access_grant_version,
          local_full_access_granted_at,
          local_full_access_grant_scope,
          (
            SELECT type
            FROM studio_workspaces
            WHERE studio_workspaces.id = studio_sessions.workspace_id
          ) AS workspace_type,
          (
            SELECT origin
            FROM studio_workspaces
            WHERE studio_workspaces.id = studio_sessions.workspace_id
          ) AS workspace_origin,
          (
            SELECT created_by_session_id
            FROM studio_workspaces
            WHERE studio_workspaces.id = studio_sessions.workspace_id
          ) AS workspace_created_by_session_id,
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

  return row ? mapSession(repairPollutedRuntimeSessionRow(row)) : null
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

export function resetStudioSessionProviderResume(sessionId: string) {
  const database = getDb()
  const timestamp = nowIso()
  const result = database.transaction(() => {
    const update = database
      .prepare(
        `
          UPDATE studio_sessions
          SET provider_session_reset_at = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(timestamp, timestamp, sessionId)

    database
      .prepare(
        `
          UPDATE studio_agent_provider_events
          SET provider_session_id = NULL
          WHERE session_id = ?
        `
      )
      .run(sessionId)

    return update
  })()

  return result.changes > 0
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

    if (workspace.origin === "selected_local") {
      if (projectId && projectId !== workspace.localProjectId) {
        throw new Error("Workspace and local project do not match.")
      }

      return {
        workspaceId: workspace.id,
        projectId: workspace.localProjectId,
      }
    }

    if (workspace.type === "local") {
      if (projectId) {
        throw new Error(
          "Managed and legacy local workspaces cannot bind a local project."
        )
      }

      return { workspaceId: workspace.id, projectId: null }
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

export function resolveStudioSessionConfigurationWorkspaceSelection(
  current: Pick<StudioSession, "workspaceId" | "projectId">,
  input: Pick<
    UpdateStudioSessionConfigurationInput,
    "workspaceId" | "projectId"
  >
) {
  if (input.workspaceId !== undefined) {
    return resolveSessionWorkspaceSelection({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    })
  }

  if (input.projectId !== undefined) {
    return resolveSessionWorkspaceSelection({
      workspaceId: undefined,
      projectId: input.projectId,
    })
  }

  return {
    workspaceId: current.workspaceId,
    projectId: current.projectId,
  }
}

export function getStudioLocalFullAccessGrantScope(
  sessionId: string,
  workspace: StudioWorkspace | null
) {
  if (workspace?.type === "sandbox") {
    return null
  }

  if (!workspace) {
    return `managed:${sessionId}`
  }

  if (
    workspace.origin === "managed_local" &&
    workspace.createdBySessionId === sessionId
  ) {
    return `managed:${sessionId}`
  }

  return `workspace:${workspace.id}`
}

export function createStudioSession(input: CreateSessionInput) {
  const {
    mode,
    title,
    permissionMode = "default",
    confirmLocalFullAccess = false,
    chatModel = null,
    chatRuntimeId = null,
    chatReasoningEffort = null,
  } = input

  if (permissionMode !== "default" && permissionMode !== "full_access") {
    throw new Error("Unsupported Studio permission mode.")
  }

  const selection = resolveSessionWorkspaceSelection(input)
  const sessionId = randomUUID()
  const workspace = selection.workspaceId
    ? getStudioWorkspace(selection.workspaceId)
    : null
  const grantScope = getStudioLocalFullAccessGrantScope(sessionId, workspace)

  if (
    permissionMode === "full_access" &&
    grantScope &&
    !confirmLocalFullAccess
  ) {
    throw new Error(
      "Local Full Access requires an explicit confirmation for this workspace."
    )
  }

  const timestamp = nowIso()
  const insert = {
    id: sessionId,
    mode,
    title: normalizeTitle(title),
    workspaceId: selection.workspaceId,
    projectId: selection.projectId,
    permissionMode,
    permissionSchemaVersion: STUDIO_PERMISSION_SCHEMA_VERSION,
    localFullAccessGrantVersion:
      permissionMode === "full_access" && grantScope
        ? STUDIO_LOCAL_FULL_ACCESS_GRANT_VERSION
        : null,
    localFullAccessGrantedAt:
      permissionMode === "full_access" && grantScope ? timestamp : null,
    localFullAccessGrantScope:
      permissionMode === "full_access" ? grantScope : null,
    chatModel,
    chatRuntimeId,
    chatReasoningEffort,
    latestRunUsage: null,
    pinnedAt: null,
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
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
            permission_schema_version,
            local_full_access_grant_version,
            local_full_access_granted_at,
            local_full_access_grant_scope,
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
            @permissionSchemaVersion,
            @localFullAccessGrantVersion,
            @localFullAccessGrantedAt,
            @localFullAccessGrantScope,
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
    .run(insert)

  if (insert.workspaceId) {
    touchStudioWorkspace(insert.workspaceId)
  } else if (insert.projectId) {
    touchStudioLocalProject(insert.projectId)
  }

  return {
    id: insert.id,
    mode: insert.mode,
    title: insert.title,
    workspaceId: insert.workspaceId,
    projectId: insert.projectId,
    permissionMode: insert.permissionMode,
    storedPermissionMode: insert.permissionMode,
    permissionSchemaVersion: insert.permissionSchemaVersion,
    requiresPermissionMigration: false,
    localFullAccessGranted:
      insert.permissionMode === "full_access" && grantScope !== null,
    chatModel: insert.chatModel,
    chatRuntimeId: insert.chatRuntimeId,
    chatReasoningEffort: insert.chatReasoningEffort,
    latestRunUsage: null,
    pinnedAt: null,
    archivedAt: null,
    isRunning: false,
    createdAt: insert.createdAt,
    updatedAt: insert.updatedAt,
  } satisfies StudioSession
}

export type UpdateStudioSessionConfigurationInput = {
  title?: string
  workspaceId?: string | null
  projectId?: string | null
  permissionMode?: StudioPublicPermissionMode
  confirmLocalFullAccess?: boolean
  confirmedLocalFullAccessGrantScope?: string
  chatModel?: string | null
  chatRuntimeId?: string | null
  chatReasoningEffort?: string | null
  pinned?: boolean
  archived?: boolean
}

/**
 * Apply the session settings edited by the Studio PATCH route as one SQLite
 * transaction. In particular, workspace selection, Full Access validation,
 * and provider-continuation invalidation must either all commit or all roll
 * back.
 */
export function updateStudioSessionConfiguration(
  sessionId: string,
  input: UpdateStudioSessionConfigurationInput
) {
  const database = getDb()

  return database
    .transaction(() => {
      const current = getStudioSession(sessionId)

      if (!current) {
        return null
      }

      const selection =
        resolveStudioSessionConfigurationWorkspaceSelection(current, input)

      const currentWorkspace = current.workspaceId
        ? getStudioWorkspace(current.workspaceId)
        : null
      const nextWorkspace = selection.workspaceId
        ? getStudioWorkspace(selection.workspaceId)
        : null

      if (selection.workspaceId && !nextWorkspace) {
        throw new Error("Studio workspace was not found.")
      }

      const workspaceChanged =
        current.workspaceId !== selection.workspaceId
      const currentGrantScope = getStudioLocalFullAccessGrantScope(
        sessionId,
        currentWorkspace
      )
      const nextGrantScope = getStudioLocalFullAccessGrantScope(
        sessionId,
        nextWorkspace
      )
      const canPreserveLocalGrant =
        !workspaceChanged ||
        (nextGrantScope !== null && currentGrantScope === nextGrantScope)
      let nextPermissionMode: StudioStoredPermissionMode

      if (input.permissionMode !== undefined) {
        if (
          input.permissionMode !== "default" &&
          input.permissionMode !== "full_access"
        ) {
          throw new Error("Unsupported Studio permission mode.")
        }

        if (
          input.permissionMode === "full_access" &&
          nextGrantScope &&
          (!input.confirmLocalFullAccess ||
            input.confirmedLocalFullAccessGrantScope !== nextGrantScope)
        ) {
          throw new Error(
            "Local Full Access requires an explicit confirmation for this exact workspace."
          )
        }

        nextPermissionMode = input.permissionMode
      } else if (current.storedPermissionMode === "readonly") {
        nextPermissionMode = "readonly"
      } else if (
        current.storedPermissionMode === "full_access" &&
        (nextWorkspace?.type === "sandbox" || canPreserveLocalGrant)
      ) {
        nextPermissionMode = "full_access"
      } else {
        nextPermissionMode = "default"
      }

      const timestamp = nowIso()
      const explicitLocalGrant =
        input.permissionMode === "full_access" && nextGrantScope !== null
      const preserveLocalGrant =
        input.permissionMode === undefined &&
        nextPermissionMode === "full_access" &&
        nextGrantScope !== null &&
        current.localFullAccessGranted &&
        canPreserveLocalGrant
      const nextRuntimeId =
        input.chatRuntimeId !== undefined
          ? input.chatRuntimeId
          : current.chatRuntimeId
      const runtimeChanged = nextRuntimeId !== current.chatRuntimeId
      const permissionChanged =
        nextPermissionMode !== current.storedPermissionMode
      const resetContinuation =
        workspaceChanged || runtimeChanged || permissionChanged

      database
        .prepare(
          `
            UPDATE studio_sessions
            SET title = @title,
                workspace_id = @workspaceId,
                project_id = @projectId,
                permission_mode = @permissionMode,
                permission_schema_version = @permissionSchemaVersion,
                local_full_access_grant_version = CASE
                  WHEN @preserveLocalGrant THEN local_full_access_grant_version
                  ELSE @localFullAccessGrantVersion
                END,
                local_full_access_granted_at = CASE
                  WHEN @preserveLocalGrant THEN local_full_access_granted_at
                  ELSE @localFullAccessGrantedAt
                END,
                local_full_access_grant_scope = CASE
                  WHEN @preserveLocalGrant THEN local_full_access_grant_scope
                  ELSE @localFullAccessGrantScope
                END,
                chat_model = @chatModel,
                chat_runtime_id = @chatRuntimeId,
                chat_reasoning_effort = @chatReasoningEffort,
                pinned_at = @pinnedAt,
                archived_at = @archivedAt,
                provider_session_reset_at = CASE
                  WHEN @resetContinuation THEN @updatedAt
                  ELSE provider_session_reset_at
                END,
                updated_at = @updatedAt
            WHERE id = @id
          `
        )
        .run({
          id: sessionId,
          title:
            input.title !== undefined
              ? normalizeTitle(input.title)
              : current.title,
          workspaceId: selection.workspaceId,
          projectId: selection.projectId,
          permissionMode: nextPermissionMode,
          permissionSchemaVersion: STUDIO_PERMISSION_SCHEMA_VERSION,
          preserveLocalGrant: preserveLocalGrant ? 1 : 0,
          localFullAccessGrantVersion: explicitLocalGrant
            ? STUDIO_LOCAL_FULL_ACCESS_GRANT_VERSION
            : null,
          localFullAccessGrantedAt: explicitLocalGrant ? timestamp : null,
          localFullAccessGrantScope:
            nextPermissionMode === "full_access" ? nextGrantScope : null,
          chatModel:
            input.chatModel !== undefined
              ? input.chatModel
              : current.chatModel,
          chatRuntimeId: nextRuntimeId,
          chatReasoningEffort:
            input.chatReasoningEffort !== undefined
              ? input.chatReasoningEffort
              : current.chatReasoningEffort,
          pinnedAt:
            input.pinned !== undefined
              ? input.pinned
                ? timestamp
                : null
              : current.pinnedAt,
          archivedAt:
            input.archived !== undefined
              ? input.archived
                ? timestamp
                : null
              : current.archivedAt,
          resetContinuation: resetContinuation ? 1 : 0,
          updatedAt: timestamp,
        })

      if (resetContinuation) {
        database
          .prepare(
            `
              UPDATE studio_agent_provider_events
              SET provider_session_id = NULL
              WHERE session_id = ?
            `
          )
          .run(sessionId)
      }

      if (selection.workspaceId) {
        touchStudioWorkspace(selection.workspaceId, timestamp)
      }

      return {
        session: getStudioSession(sessionId),
        workspaceChanged,
        runtimeChanged,
        permissionChanged,
        previousRuntimeId: current.chatRuntimeId,
      }
    })
    .immediate()
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
  workspaceId: string | null,
  options: {
    preserveProviderContinuation?: boolean
  } = {}
) {
  const database = getDb()

  return database
    .transaction(() => {
      const current = getStudioSession(sessionId)

      if (!current) {
        return null
      }

      const workspace = workspaceId
        ? getStudioWorkspace(workspaceId)
        : null

      if (workspaceId && !workspace) {
        return null
      }

      const projectId =
        workspace?.origin === "selected_local"
          ? workspace.localProjectId
          : null
      const updatedAt = nowIso()
      const currentWorkspace = current.workspaceId
        ? getStudioWorkspace(current.workspaceId)
        : null
      const currentGrantScope = getStudioLocalFullAccessGrantScope(
        sessionId,
        currentWorkspace
      )
      const nextGrantScope = getStudioLocalFullAccessGrantScope(
        sessionId,
        workspace
      )
      const workspaceChanged = current.workspaceId !== workspaceId
      const resetContinuation =
        workspaceChanged && !options.preserveProviderContinuation
      const canPreserveLocalGrant =
        !workspaceChanged ||
        (nextGrantScope !== null && currentGrantScope === nextGrantScope)
      const nextStoredPermissionMode: StudioStoredPermissionMode =
        current.storedPermissionMode === "readonly"
          ? "readonly"
          : current.storedPermissionMode === "full_access" &&
              (workspace?.type === "sandbox" || canPreserveLocalGrant)
            ? "full_access"
            : "default"

      const result = database
        .prepare(
          `
            UPDATE studio_sessions
            SET workspace_id = ?,
                project_id = ?,
                permission_mode = ?,
                permission_schema_version = ?,
                local_full_access_grant_version = CASE
                  WHEN ? THEN local_full_access_grant_version
                  ELSE NULL
                END,
                local_full_access_granted_at = CASE
                  WHEN ? THEN local_full_access_granted_at
                  ELSE NULL
                END,
                local_full_access_grant_scope = CASE
                  WHEN ? THEN local_full_access_grant_scope
                  ELSE NULL
                END,
                provider_session_reset_at = CASE
                  WHEN ? THEN ?
                  ELSE provider_session_reset_at
                END,
                updated_at = ?
            WHERE id = ?
          `
        )
        .run(
          workspaceId,
          projectId,
          nextStoredPermissionMode,
          STUDIO_PERMISSION_SCHEMA_VERSION,
          canPreserveLocalGrant ? 1 : 0,
          canPreserveLocalGrant ? 1 : 0,
          canPreserveLocalGrant ? 1 : 0,
          resetContinuation ? 1 : 0,
          updatedAt,
          updatedAt,
          sessionId
        )

      if (resetContinuation) {
        database
          .prepare(
            `
              UPDATE studio_agent_provider_events
              SET provider_session_id = NULL
              WHERE session_id = ?
            `
          )
          .run(sessionId)
      }

      if (result.changes > 0 && workspaceId) {
        touchStudioWorkspace(workspaceId, updatedAt)
      }

      return getStudioSession(sessionId)
    })
    .immediate()
}

export function updateStudioSessionPermissionMode(
  sessionId: string,
  permissionMode: StudioPublicPermissionMode,
  options: {
    confirmLocalFullAccess?: boolean
  } = {}
) {
  if (permissionMode !== "default" && permissionMode !== "full_access") {
    throw new Error("Unsupported Studio permission mode.")
  }

  const session = getStudioSession(sessionId)

  if (!session) {
    return null
  }

  const workspace = session.workspaceId
    ? getStudioWorkspace(session.workspaceId)
    : null
  const grantScope = getStudioLocalFullAccessGrantScope(sessionId, workspace)

  if (
    permissionMode === "full_access" &&
    grantScope &&
    !options.confirmLocalFullAccess
  ) {
    throw new Error(
      "Local Full Access requires an explicit confirmation for this workspace."
    )
  }

  const updatedAt = nowIso()
  const grantVersion =
    permissionMode === "full_access" && grantScope
      ? STUDIO_LOCAL_FULL_ACCESS_GRANT_VERSION
      : null
  const grantedAt =
    permissionMode === "full_access" && grantScope ? updatedAt : null

  getDb()
    .prepare(
      `
        UPDATE studio_sessions
        SET permission_mode = ?,
            permission_schema_version = ?,
            local_full_access_grant_version = ?,
            local_full_access_granted_at = ?,
            local_full_access_grant_scope = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      permissionMode,
      STUDIO_PERMISSION_SCHEMA_VERSION,
      grantVersion,
      grantedAt,
      permissionMode === "full_access" ? grantScope : null,
      updatedAt,
      sessionId
    )

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
    try {
      removeAcpAttachmentDirectory(sessionId)
    } catch {
      // Best-effort cleanup; invalid or unreadable private data must not fail.
    }

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
