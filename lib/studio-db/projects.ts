import { randomUUID } from "node:crypto"

import type { StudioLocalProject } from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import { mapLocalProject, nowIso } from "./helpers"
import type { CreateLocalProjectInput, DbLocalProjectRow } from "./types"
import {
  ensureStudioLocalWorkspaceForProject,
  getStudioWorkspaceForLocalProject,
  touchStudioWorkspace,
} from "./workspaces"

export function listStudioLocalProjects() {
  const rows = getDb()
    .prepare(
      `
        SELECT id, name, path, created_at, updated_at, last_opened_at
        FROM studio_local_projects
        ORDER BY COALESCE(last_opened_at, updated_at) DESC, name ASC
      `
    )
    .all() as DbLocalProjectRow[]

  return rows.map(mapLocalProject)
}

export function getStudioLocalProject(projectId: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, name, path, created_at, updated_at, last_opened_at
        FROM studio_local_projects
        WHERE id = ?
      `
    )
    .get(projectId) as DbLocalProjectRow | undefined

  return row ? mapLocalProject(row) : null
}

export function getStudioLocalProjectByPath(path: string) {
  const row = getDb()
    .prepare(
      `
        SELECT id, name, path, created_at, updated_at, last_opened_at
        FROM studio_local_projects
        WHERE path = ?
      `
    )
    .get(path) as DbLocalProjectRow | undefined

  return row ? mapLocalProject(row) : null
}

export function createStudioLocalProject({
  name,
  path,
}: CreateLocalProjectInput) {
  const existing = getStudioLocalProjectByPath(path)
  const timestamp = nowIso()

  if (existing) {
    getDb()
      .prepare(
        `
          UPDATE studio_local_projects
          SET name = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(name, timestamp, existing.id)

    const project = getStudioLocalProject(existing.id) ?? existing
    ensureStudioLocalWorkspaceForProject(project)
    return project
  }

  const project: StudioLocalProject = {
    id: randomUUID(),
    name,
    path,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: null,
  }

  getDb()
    .prepare(
      `
        INSERT INTO studio_local_projects
          (id, name, path, created_at, updated_at, last_opened_at)
        VALUES
          (@id, @name, @path, @createdAt, @updatedAt, @lastOpenedAt)
      `
    )
    .run(project)

  ensureStudioLocalWorkspaceForProject(project)
  return project
}

export function touchStudioLocalProject(projectId: string) {
  const timestamp = nowIso()

  getDb()
    .prepare(
      `
        UPDATE studio_local_projects
        SET last_opened_at = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(timestamp, timestamp, projectId)

  const workspace = getStudioWorkspaceForLocalProject(projectId)

  if (workspace) {
    touchStudioWorkspace(workspace.id, timestamp)
  }

  return getStudioLocalProject(projectId)
}

export function deleteStudioLocalProject(projectId: string) {
  const database = getDb()

  const transaction = database.transaction(() => {
    database
      .prepare(
        `
          UPDATE studio_sessions
          SET project_id = NULL, updated_at = ?
          WHERE project_id = ?
        `
      )
      .run(nowIso(), projectId)

    database
      .prepare(
        `
          DELETE FROM studio_local_projects
          WHERE id = ?
        `
      )
      .run(projectId)

    database
      .prepare(
        `
          DELETE FROM studio_permission_rules
          WHERE project_id = ?
        `
      )
      .run(projectId)
  })

  transaction()
}
