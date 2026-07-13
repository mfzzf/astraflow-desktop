import { randomUUID } from "node:crypto"

import type { StudioLocalProject, StudioWorkspace } from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import { mapWorkspace, nowIso } from "./helpers"
import type {
  CreateLocalWorkspaceInput,
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
        WHERE type = 'local' AND local_project_id = ?
      `
    )
    .get(localProjectId) as DbWorkspaceRow | undefined

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
        WHERE type = 'sandbox'
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
    name,
    rootPath,
    localProjectId,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_workspaces
          (id, type, name, root_path, local_project_id, sandbox_id,
           created_at, updated_at, last_opened_at)
        VALUES
          (@id, @type, @name, @rootPath, @localProjectId, NULL,
           @createdAt, @updatedAt, @lastOpenedAt)
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
    name,
    rootPath,
    sandboxId,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_workspaces
          (id, type, name, root_path, local_project_id, sandbox_id,
           created_at, updated_at, last_opened_at)
        VALUES
          (@id, @type, @name, @rootPath, NULL, @sandboxId,
           @createdAt, @updatedAt, @lastOpenedAt)
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

    if (workspace.type === "local") {
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

    if (workspace.type === "local") {
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
    database
      .prepare(
        `
          UPDATE studio_sessions
          SET workspace_id = NULL,
              project_id = CASE
                WHEN workspace_id = ? THEN NULL
                ELSE project_id
              END,
              updated_at = ?
          WHERE workspace_id = ?
        `
      )
      .run(workspaceId, nowIso(), workspaceId)

    if (workspace.type === "local") {
      database
        .prepare(
          `
            UPDATE studio_sessions
            SET workspace_id = NULL, project_id = NULL, updated_at = ?
            WHERE project_id = ?
          `
        )
        .run(nowIso(), workspace.localProjectId)

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
