import { randomUUID } from "node:crypto"

import type { StudioLocalProject, StudioWorkspace } from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import {
  mapWorkspace,
  nowIso,
  STUDIO_LOCAL_FULL_ACCESS_GRANT_VERSION,
  STUDIO_PERMISSION_SCHEMA_VERSION,
} from "./helpers"
import type {
  CreateLocalWorkspaceInput,
  CreateLegacyWorkspaceInput,
  CreateManagedWorkspaceInput,
  CreateSandboxWorkspaceInput,
  DbWorkspaceRow,
} from "./types"

const workspaceColumns = `
  id,
  type,
  name,
  root_path,
  local_project_id,
  sandbox_id,
  origin,
  allocation_key,
  created_by_session_id,
  created_at,
  updated_at,
  last_opened_at
`

export function listStudioWorkspaces() {
  const rows = getDb()
    .prepare(
      `
        SELECT ${workspaceColumns}
        FROM studio_workspaces
        ORDER BY COALESCE(last_opened_at, updated_at) DESC, name ASC
      `
    )
    .all() as DbWorkspaceRow[]

  return rows.map(mapWorkspace)
}

export function getStudioWorkspace(workspaceId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT ${workspaceColumns}
        FROM studio_workspaces
        WHERE id = ?
      `
    )
    .get(workspaceId) as DbWorkspaceRow | undefined

  return row ? mapWorkspace(row) : null
}

export function getStudioWorkspaceForLocalProject(localProjectId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT ${workspaceColumns}
        FROM studio_workspaces
        WHERE origin = 'selected_local' AND local_project_id = ?
      `
    )
    .get(localProjectId) as DbWorkspaceRow | undefined

  return row ? mapWorkspace(row) : null
}

export function getStudioWorkspaceForAllocationKey(allocationKey: string) {
  const row = getDb()
    .prepare(
      `
        SELECT ${workspaceColumns}
        FROM studio_workspaces
        WHERE allocation_key = ?
      `
    )
    .get(allocationKey) as DbWorkspaceRow | undefined

  return row ? mapWorkspace(row) : null
}

export function getStudioOwnedLocalWorkspaceForRootPath(rootPath: string) {
  const row = getDb()
    .prepare(
      `
        SELECT ${workspaceColumns}
        FROM studio_workspaces
        WHERE origin IN ('managed_local', 'legacy_local')
          AND root_path = ?
      `
    )
    .get(rootPath) as DbWorkspaceRow | undefined

  return row ? mapWorkspace(row) : null
}

export function getStudioWorkspaceForSandboxPath(
  sandboxId: string,
  rootPath: string
) {
  const row = getDb()
    .prepare(
      `
        SELECT ${workspaceColumns}
        FROM studio_workspaces
        WHERE origin = 'remote_sandbox'
          AND sandbox_id = ?
          AND root_path = ?
      `
    )
    .get(sandboxId, rootPath) as DbWorkspaceRow | undefined

  return row ? mapWorkspace(row) : null
}

export function getStudioSessionWorkspace(sessionId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT
          workspaces.id,
          workspaces.type,
          workspaces.name,
          workspaces.root_path,
          workspaces.local_project_id,
          workspaces.sandbox_id,
          workspaces.origin,
          workspaces.allocation_key,
          workspaces.created_by_session_id,
          workspaces.created_at,
          workspaces.updated_at,
          workspaces.last_opened_at
        FROM studio_sessions AS sessions
        INNER JOIN studio_workspaces AS workspaces
          ON workspaces.id = sessions.workspace_id
        WHERE sessions.id = ?
      `
    )
    .get(sessionId) as DbWorkspaceRow | undefined

  return row ? mapWorkspace(row) : null
}

export function ensureStudioLocalWorkspaceForProject(
  project: StudioLocalProject
) {
  const existing = getStudioWorkspaceForLocalProject(project.id)

  if (existing) {
    return existing
  }

  return createStudioLocalWorkspace({
    name: project.name,
    rootPath: project.path,
    localProjectId: project.id,
  })
}

export function createStudioLocalWorkspace({
  name,
  rootPath,
  localProjectId,
}: CreateLocalWorkspaceInput) {
  const existing = getStudioWorkspaceForLocalProject(localProjectId)

  if (existing) {
    return existing
  }

  const timestamp = nowIso()
  const workspace: StudioWorkspace = {
    id: randomUUID(),
    type: "local",
    origin: "selected_local",
    name,
    rootPath,
    localProjectId,
    allocationKey: null,
    createdBySessionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_workspaces
          (id, type, name, root_path, local_project_id, sandbox_id, origin,
           allocation_key, created_by_session_id, created_at, updated_at,
           last_opened_at)
        VALUES
          (@id, @type, @name, @rootPath, @localProjectId, NULL,
           @origin, NULL, NULL, @createdAt, @updatedAt, @lastOpenedAt)
      `
    )
    .run(workspace)

  return workspace
}

export function createStudioManagedWorkspace({
  name,
  rootPath,
  allocationKey,
  createdBySessionId,
}: CreateManagedWorkspaceInput) {
  const existing = getStudioWorkspaceForAllocationKey(allocationKey)

  if (existing) {
    if (
      existing.origin !== "managed_local" ||
      existing.createdBySessionId !== createdBySessionId ||
      existing.rootPath !== rootPath
    ) {
      throw new Error(
        `Workspace allocation ${allocationKey} is already bound to another path.`
      )
    }

    return existing
  }

  const timestamp = nowIso()
  const workspace = {
    id: randomUUID(),
    type: "local" as const,
    origin: "managed_local" as const,
    name,
    rootPath,
    localProjectId: null,
    allocationKey,
    createdBySessionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_workspaces
          (id, type, name, root_path, local_project_id, sandbox_id, origin,
           allocation_key, created_by_session_id, created_at, updated_at,
           last_opened_at)
        VALUES
          (@id, @type, @name, @rootPath, NULL, NULL, @origin,
           @allocationKey, @createdBySessionId, @createdAt, @updatedAt,
           @lastOpenedAt)
      `
    )
    .run(workspace)

  return workspace
}

export function allocateAndBindStudioManagedWorkspace({
  name,
  rootPath,
  allocationKey,
  createdBySessionId,
}: CreateManagedWorkspaceInput) {
  const database = getDb()
  let workspaceId = ""

  database.transaction(() => {
    const session = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            permission_mode,
            permission_schema_version,
            local_full_access_grant_version,
            local_full_access_granted_at,
            local_full_access_grant_scope
          FROM studio_sessions
          WHERE id = ?
        `
      )
      .get(createdBySessionId) as
      | {
          id: string
          workspace_id: string | null
          permission_mode: string
          permission_schema_version: number
          local_full_access_grant_version: number | null
          local_full_access_granted_at: string | null
          local_full_access_grant_scope: string | null
        }
      | undefined

    if (!session) {
      throw new Error("Session not found")
    }

    const existing = database
      .prepare(
        `
          SELECT ${workspaceColumns}
          FROM studio_workspaces
          WHERE allocation_key = ?
        `
      )
      .get(allocationKey) as DbWorkspaceRow | undefined

    if (existing) {
      const mapped = mapWorkspace(existing)

      if (
        mapped.type !== "local" ||
        mapped.origin !== "managed_local" ||
        mapped.createdBySessionId !== createdBySessionId ||
        mapped.rootPath !== rootPath
      ) {
        throw new Error(
          `Workspace allocation ${allocationKey} is already bound to another path.`
        )
      }

      workspaceId = mapped.id
    } else {
      const timestamp = nowIso()

      workspaceId = randomUUID()
      database
        .prepare(
          `
            INSERT INTO studio_workspaces
              (id, type, name, root_path, local_project_id, sandbox_id, origin,
               allocation_key, created_by_session_id, created_at, updated_at,
               last_opened_at)
            VALUES
              (?, 'local', ?, ?, NULL, NULL, 'managed_local',
               ?, ?, ?, ?, ?)
          `
        )
        .run(
          workspaceId,
          name,
          rootPath,
          allocationKey,
          createdBySessionId,
          timestamp,
          timestamp,
          timestamp
        )
    }

    if (session.workspace_id && session.workspace_id !== workspaceId) {
      throw new Error(
        "The Studio task was concurrently bound to another workspace."
      )
    }

    const updatedAt = nowIso()
    const preservesManagedFullAccess =
      session.permission_mode === "full_access" &&
      session.permission_schema_version === STUDIO_PERMISSION_SCHEMA_VERSION &&
      session.local_full_access_grant_version ===
        STUDIO_LOCAL_FULL_ACCESS_GRANT_VERSION &&
      Boolean(session.local_full_access_granted_at) &&
      session.local_full_access_grant_scope ===
        `managed:${createdBySessionId}`

    database
      .prepare(
        `
          UPDATE studio_sessions
          SET workspace_id = ?,
              project_id = NULL,
              permission_mode = CASE
                WHEN permission_mode = 'readonly' THEN 'readonly'
                WHEN ? THEN 'full_access'
                ELSE 'default'
              END,
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
              provider_session_reset_at = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        workspaceId,
        preservesManagedFullAccess ? 1 : 0,
        STUDIO_PERMISSION_SCHEMA_VERSION,
        preservesManagedFullAccess ? 1 : 0,
        preservesManagedFullAccess ? 1 : 0,
        preservesManagedFullAccess ? 1 : 0,
        updatedAt,
        updatedAt,
        createdBySessionId
      )
    database
      .prepare(
        `
          UPDATE studio_agent_provider_events
          SET provider_session_id = NULL
          WHERE session_id = ?
        `
      )
      .run(createdBySessionId)
    database
      .prepare(
        `
          UPDATE studio_workspaces
          SET last_opened_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(updatedAt, updatedAt, workspaceId)
  })()

  const workspace = getStudioWorkspace(workspaceId)

  if (!workspace || workspace.type !== "local") {
    throw new Error("The managed workspace allocation could not be loaded.")
  }

  return workspace
}

export function createStudioLegacyWorkspace({
  name,
  rootPath,
  allocationKey,
  createdBySessionId = null,
}: CreateLegacyWorkspaceInput) {
  const existing = getStudioWorkspaceForAllocationKey(allocationKey)

  if (existing) {
    if (existing.origin !== "legacy_local" || existing.rootPath !== rootPath) {
      throw new Error(
        `Workspace allocation ${allocationKey} is already bound to another path.`
      )
    }

    return existing
  }

  const timestamp = nowIso()
  const workspace = {
    id: randomUUID(),
    type: "local" as const,
    origin: "legacy_local" as const,
    name,
    rootPath,
    localProjectId: null,
    allocationKey,
    createdBySessionId,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_workspaces
          (id, type, name, root_path, local_project_id, sandbox_id, origin,
           allocation_key, created_by_session_id, created_at, updated_at,
           last_opened_at)
        VALUES
          (@id, @type, @name, @rootPath, NULL, NULL, @origin,
           @allocationKey, @createdBySessionId, @createdAt, @updatedAt,
           @lastOpenedAt)
      `
    )
    .run(workspace)

  return workspace
}

export function createStudioSandboxWorkspace({
  name,
  rootPath,
  sandboxId,
}: CreateSandboxWorkspaceInput) {
  const existing = getStudioWorkspaceForSandboxPath(sandboxId, rootPath)
  const timestamp = nowIso()

  if (existing) {
    getDb()
      .prepare(
        `
          UPDATE studio_workspaces
          SET name = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(name, timestamp, existing.id)

    return getStudioWorkspace(existing.id) ?? existing
  }

  const workspace: StudioWorkspace = {
    id: randomUUID(),
    type: "sandbox",
    origin: "remote_sandbox",
    name,
    rootPath,
    sandboxId,
    allocationKey: null,
    createdBySessionId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_workspaces
          (id, type, name, root_path, local_project_id, sandbox_id, origin,
           allocation_key, created_by_session_id, created_at, updated_at,
           last_opened_at)
        VALUES
          (@id, @type, @name, @rootPath, NULL, @sandboxId, @origin,
           NULL, NULL, @createdAt, @updatedAt, @lastOpenedAt)
      `
    )
    .run(workspace)

  return workspace
}

export function updateStudioWorkspaceName(workspaceId: string, name: string) {
  const workspace = getStudioWorkspace(workspaceId)

  if (!workspace) {
    return null
  }

  const database = getDb()
  const timestamp = nowIso()

  database.transaction(() => {
    database
      .prepare(
        `
          UPDATE studio_workspaces
          SET name = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(name, timestamp, workspaceId)

    if (workspace.origin === "selected_local") {
      database
        .prepare(
          `
            UPDATE studio_local_projects
            SET name = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(name, timestamp, workspace.localProjectId)
    }
  })()

  return getStudioWorkspace(workspaceId)
}

export function touchStudioWorkspace(workspaceId: string, openedAt = nowIso()) {
  const workspace = getStudioWorkspace(workspaceId)

  if (!workspace) {
    return null
  }

  const database = getDb()

  database.transaction(() => {
    database
      .prepare(
        `
          UPDATE studio_workspaces
          SET last_opened_at = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(openedAt, openedAt, workspaceId)

    if (workspace.origin === "selected_local") {
      database
        .prepare(
          `
            UPDATE studio_local_projects
            SET last_opened_at = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(openedAt, openedAt, workspace.localProjectId)
    }
  })()

  return getStudioWorkspace(workspaceId)
}

export function setStudioWorkspaceLastOpenedAt(
  workspaceId: string,
  lastOpenedAt: string | null
) {
  const timestamp = nowIso()
  const result = getDb()
    .prepare(
      `
        UPDATE studio_workspaces
        SET last_opened_at = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(lastOpenedAt, timestamp, workspaceId)

  return result.changes > 0 ? getStudioWorkspace(workspaceId) : null
}

export function deleteStudioWorkspace(workspaceId: string) {
  const workspace = getStudioWorkspace(workspaceId)

  if (!workspace) {
    return false
  }

  const database = getDb()

  database.transaction(() => {
    const timestamp = nowIso()

    // A scheduled task must never silently fall back to a newly allocated
    // local workspace after its explicitly selected workspace disappears.
    database
      .prepare(
        `
          UPDATE studio_scheduled_task_runs
          SET status = 'cancelled',
              finished_at = COALESCE(finished_at, ?),
              error = COALESCE(
                error,
                'Task disabled because its workspace was removed.'
              ),
              updated_at = ?
          WHERE status = 'queued'
            AND task_id IN (
              SELECT id
              FROM studio_scheduled_tasks
              WHERE workspace_id = ?
            )
        `
      )
      .run(timestamp, timestamp, workspaceId)
    database
      .prepare(
        `
          UPDATE studio_scheduled_tasks
          SET enabled = 0,
              next_run_at = NULL,
              updated_at = ?
          WHERE workspace_id = ?
        `
      )
      .run(timestamp, workspaceId)

    database
      .prepare(
        `
          UPDATE studio_sessions
          SET workspace_id = NULL,
              project_id = CASE
                WHEN workspace_id = ? THEN NULL
                ELSE project_id
              END,
              permission_mode = CASE
                WHEN permission_mode = 'readonly' THEN 'readonly'
                ELSE 'default'
              END,
              permission_schema_version = ?,
              local_full_access_grant_version = NULL,
              local_full_access_granted_at = NULL,
              local_full_access_grant_scope = NULL,
              updated_at = ?
          WHERE workspace_id = ?
        `
      )
      .run(
        workspaceId,
        STUDIO_PERMISSION_SCHEMA_VERSION,
        timestamp,
        workspaceId
      )

    if (workspace.origin === "selected_local") {
      database
        .prepare(
          `
            UPDATE studio_sessions
            SET workspace_id = NULL,
                project_id = NULL,
                permission_mode = CASE
                  WHEN permission_mode = 'readonly' THEN 'readonly'
                  ELSE 'default'
                END,
                permission_schema_version = ?,
                local_full_access_grant_version = NULL,
                local_full_access_granted_at = NULL,
                local_full_access_grant_scope = NULL,
                updated_at = ?
            WHERE project_id = ?
          `
        )
        .run(
          STUDIO_PERMISSION_SCHEMA_VERSION,
          timestamp,
          workspace.localProjectId
        )

      database
        .prepare(
          `
            DELETE FROM studio_permission_rules
            WHERE project_id = ?
          `
        )
        .run(workspace.localProjectId)

      database
        .prepare(
          `
            DELETE FROM studio_local_projects
            WHERE id = ?
          `
        )
        .run(workspace.localProjectId)
    } else {
      // A Studio workspace only references a CodeBox. Removing it must never
      // pause, kill, or delete the underlying sandbox.
      database
        .prepare(
          `
            DELETE FROM studio_workspaces
            WHERE id = ?
          `
        )
        .run(workspaceId)
    }
  })()

  return true
}
