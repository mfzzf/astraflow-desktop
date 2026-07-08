import { randomUUID } from "node:crypto"

import { getStudioDatabase as getDb } from "./connection"
import { nowIso } from "./helpers"
import type { DbPermissionRuleRow } from "./types"

export function hasStudioPermissionRule({
  projectId,
  toolName,
}: {
  projectId: string | null
  toolName: string
}) {
  const normalizedToolName = toolName.trim()

  if (!normalizedToolName || !projectId) {
    return false
  }

  const row = getDb()
    .prepare(
      `
        SELECT id, project_id, tool_name, created_at
        FROM studio_permission_rules
        WHERE tool_name = ?
          AND project_id = ?
        LIMIT 1
      `
    )
    .get(normalizedToolName, projectId) as DbPermissionRuleRow | undefined

  return Boolean(row)
}

export function createStudioPermissionRule({
  projectId,
  toolName,
}: {
  projectId: string | null
  toolName: string
}) {
  const normalizedToolName = toolName.trim()

  if (!normalizedToolName || !projectId) {
    return null
  }

  const id = randomUUID()
  const createdAt = nowIso()

  getDb()
    .prepare(
      `
        INSERT OR IGNORE INTO studio_permission_rules
          (id, project_id, tool_name, created_at)
        VALUES
          (?, ?, ?, ?)
      `
    )
    .run(id, projectId, normalizedToolName, createdAt)

  return {
    id,
    projectId,
    toolName: normalizedToolName,
    createdAt,
  }
}

export function countStudioPermissionRules(projectId: string | null) {
  const row = getDb()
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM studio_permission_rules
        WHERE ${projectId === null ? "project_id IS NULL" : "project_id = ?"}
      `
    )
    .get(...(projectId === null ? [] : [projectId])) as
    { count: number } | undefined

  return row?.count ?? 0
}

export function deleteStudioPermissionRules(projectId: string | null) {
  const result = getDb()
    .prepare(
      `
        DELETE FROM studio_permission_rules
        WHERE ${projectId === null ? "project_id IS NULL" : "project_id = ?"}
      `
    )
    .run(...(projectId === null ? [] : [projectId]))

  return result.changes
}
