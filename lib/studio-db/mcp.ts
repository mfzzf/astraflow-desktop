import { normalizeMcpServerId, type McpRegistryServer } from "@/lib/mcp"

import { getStudioDatabase as getDb } from "./connection"
import {
  mapInstalledMcpServer,
  mapMcpRegistryServer,
  nowIso,
  prepareMcpConfigForStorage,
  readMcpServerSecretMap,
} from "./helpers"
import type {
  DbInstalledMcpServerRow,
  DbMcpRegistryServerRow,
  ListStudioMcpRegistryServersInput,
  UpdateStudioMcpServerDiscoveryInput,
  UpdateStudioMcpServerInput,
  UpsertStudioMcpServerInput,
} from "./types"

export function listStudioMcpServers({
  enabledOnly = false,
  includeSecrets = false,
}: {
  enabledOnly?: boolean
  includeSecrets?: boolean
} = {}) {
  const rows = getDb()
    .prepare(
      `
        SELECT
          id,
          name,
          title,
          description,
          source,
          registry_name,
          registry_version,
          transport,
          config,
          capabilities,
          tools,
          resources,
          prompts,
          enabled,
          last_connected_at,
          last_error,
          created_at,
          updated_at
        FROM studio_mcp_servers
        ${enabledOnly ? "WHERE enabled = 1" : ""}
        ORDER BY updated_at DESC, title ASC
      `
    )
    .all() as DbInstalledMcpServerRow[]

  return rows.map((row) =>
    mapInstalledMcpServer(row, {
      includeSecrets,
    })
  )
}

export function getStudioMcpServer(
  id: string,
  {
    includeSecrets = false,
  }: {
    includeSecrets?: boolean
  } = {}
) {
  const normalizedId = id.trim()

  if (!normalizedId) {
    return null
  }

  const row = getDb()
    .prepare(
      `
        SELECT
          id,
          name,
          title,
          description,
          source,
          registry_name,
          registry_version,
          transport,
          config,
          capabilities,
          tools,
          resources,
          prompts,
          enabled,
          last_connected_at,
          last_error,
          created_at,
          updated_at
        FROM studio_mcp_servers
        WHERE id = ?
      `
    )
    .get(normalizedId) as DbInstalledMcpServerRow | undefined

  return row ? mapInstalledMcpServer(row, { includeSecrets }) : null
}

export function upsertStudioMcpServer(input: UpsertStudioMcpServerInput) {
  const id = normalizeMcpServerId(input.id || input.name)
  const existing = getStudioMcpServer(id)
  const createdAt = existing?.createdAt ?? nowIso()
  const updatedAt = nowIso()
  const title = input.title?.trim() || input.name.trim()
  const { storedConfig, secretNames, secretsToDelete, secretsToSave } =
    prepareMcpConfigForStorage({
      config: input.config,
      serverId: id,
    })
  const database = getDb()
  const saveTransaction = database.transaction(() => {
    database
      .prepare(
        `
          INSERT INTO studio_mcp_servers
            (
              id,
              name,
              title,
              description,
              source,
              registry_name,
              registry_version,
              transport,
              config,
              capabilities,
              tools,
              resources,
              prompts,
              enabled,
              last_connected_at,
              last_error,
              created_at,
              updated_at
            )
          VALUES
            (
              @id,
              @name,
              @title,
              @description,
              @source,
              @registryName,
              @registryVersion,
              @transport,
              @config,
              @capabilities,
              @tools,
              @resources,
              @prompts,
              @enabled,
              @lastConnectedAt,
              @lastError,
              @createdAt,
              @updatedAt
            )
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            title = excluded.title,
            description = excluded.description,
            source = excluded.source,
            registry_name = excluded.registry_name,
            registry_version = excluded.registry_version,
            transport = excluded.transport,
            config = excluded.config,
            capabilities = excluded.capabilities,
            tools = excluded.tools,
            resources = excluded.resources,
            prompts = excluded.prompts,
            enabled = excluded.enabled,
            last_connected_at = excluded.last_connected_at,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        `
      )
      .run({
        id,
        name: input.name.trim(),
        title,
        description: input.description ?? "",
        source: input.source ?? "manual",
        registryName: input.registryName ?? null,
        registryVersion: input.registryVersion ?? null,
        transport: storedConfig.type,
        config: JSON.stringify(storedConfig),
        capabilities: JSON.stringify(input.capabilities ?? {}),
        tools: JSON.stringify(input.tools ?? []),
        resources: JSON.stringify(input.resources ?? []),
        prompts: JSON.stringify(input.prompts ?? []),
        enabled: input.enabled === false ? 0 : 1,
        lastConnectedAt: input.lastConnectedAt ?? null,
        lastError: input.lastError ?? null,
        createdAt,
        updatedAt,
      })

    const currentSecretNames = Object.keys(readMcpServerSecretMap(id))

    for (const secretName of currentSecretNames) {
      if (!secretNames.has(secretName) || secretsToDelete.has(secretName)) {
        database
          .prepare(
            `
              DELETE FROM studio_mcp_server_secrets
              WHERE server_id = ?
                AND name = ?
            `
          )
          .run(id, secretName)
      }
    }

    for (const [secretName, value] of Object.entries(secretsToSave)) {
      database
        .prepare(
          `
            INSERT INTO studio_mcp_server_secrets
              (server_id, name, value, updated_at)
            VALUES
              (?, ?, ?, ?)
            ON CONFLICT(server_id, name) DO UPDATE SET
              value = excluded.value,
              updated_at = excluded.updated_at
          `
        )
        .run(id, secretName, value, updatedAt)
    }
  })

  saveTransaction()

  return getStudioMcpServer(id)
}

export function updateStudioMcpServer(
  id: string,
  updates: UpdateStudioMcpServerInput
) {
  const existing = getStudioMcpServer(id, { includeSecrets: true })

  if (!existing) {
    return null
  }

  return upsertStudioMcpServer({
    id: existing.id,
    name: updates.name ?? existing.name,
    title: updates.title ?? existing.title,
    description: updates.description ?? existing.description,
    source: updates.source ?? existing.source,
    registryName: updates.registryName ?? existing.registryName,
    registryVersion: updates.registryVersion ?? existing.registryVersion,
    enabled: updates.enabled ?? existing.enabled,
    config: updates.config ?? existing.config,
    capabilities: updates.capabilities ?? existing.capabilities,
    tools: updates.tools ?? existing.tools,
    resources: updates.resources ?? existing.resources,
    prompts: updates.prompts ?? existing.prompts,
    lastConnectedAt:
      updates.lastConnectedAt === undefined
        ? existing.lastConnectedAt
        : updates.lastConnectedAt,
    lastError:
      updates.lastError === undefined ? existing.lastError : updates.lastError,
  })
}

export function updateStudioMcpServerEnabled(id: string, enabled: boolean) {
  const updatedAt = nowIso()
  const result = getDb()
    .prepare(
      `
        UPDATE studio_mcp_servers
        SET enabled = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(enabled ? 1 : 0, updatedAt, id)

  return result.changes > 0 ? getStudioMcpServer(id) : null
}

export function updateStudioMcpServerDiscovery({
  id,
  capabilities,
  tools,
  resources,
  prompts,
  lastConnectedAt = nowIso(),
  lastError = null,
}: UpdateStudioMcpServerDiscoveryInput) {
  const updatedAt = nowIso()
  const result = getDb()
    .prepare(
      `
        UPDATE studio_mcp_servers
        SET capabilities = ?,
            tools = ?,
            resources = ?,
            prompts = ?,
            last_connected_at = ?,
            last_error = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(
      JSON.stringify(capabilities),
      JSON.stringify(tools),
      JSON.stringify(resources),
      JSON.stringify(prompts),
      lastConnectedAt,
      lastError,
      updatedAt,
      id
    )

  return result.changes > 0 ? getStudioMcpServer(id) : null
}

export function updateStudioMcpServerConnectionError(
  id: string,
  lastError: string
) {
  const updatedAt = nowIso()
  const result = getDb()
    .prepare(
      `
        UPDATE studio_mcp_servers
        SET last_error = ?,
            updated_at = ?
        WHERE id = ?
      `
    )
    .run(lastError, updatedAt, id)

  return result.changes > 0 ? getStudioMcpServer(id) : null
}

export function deleteStudioMcpServer(id: string) {
  const result = getDb()
    .prepare(
      `
        DELETE FROM studio_mcp_servers
        WHERE id = ?
      `
    )
    .run(id)

  return result.changes > 0
}

export function upsertStudioMcpRegistryServers(servers: McpRegistryServer[]) {
  if (servers.length === 0) {
    return 0
  }

  const database = getDb()
  const saveTransaction = database.transaction(() => {
    let count = 0

    for (const server of servers) {
      const result = database
        .prepare(
          `
            INSERT INTO studio_mcp_registry_servers
              (
                id,
                name,
                version,
                title,
                description,
                status,
                latest,
                source,
                transports,
                server_json,
                registry_meta,
                updated_at,
                synced_at
              )
            VALUES
              (
                @id,
                @name,
                @version,
                @title,
                @description,
                @status,
                @latest,
                @source,
                @transports,
                @serverJson,
                @registryMeta,
                @updatedAt,
                @syncedAt
              )
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              version = excluded.version,
              title = excluded.title,
              description = excluded.description,
              status = excluded.status,
              latest = excluded.latest,
              source = excluded.source,
              transports = excluded.transports,
              server_json = excluded.server_json,
              registry_meta = excluded.registry_meta,
              updated_at = excluded.updated_at,
              synced_at = excluded.synced_at
          `
        )
        .run({
          id: server.id,
          name: server.name,
          version: server.version,
          title: server.title,
          description: server.description,
          status: server.status,
          latest: server.latest ? 1 : 0,
          source: server.source,
          transports: JSON.stringify(server.transports),
          serverJson: JSON.stringify(server.serverJson),
          registryMeta: JSON.stringify(server.registryMeta),
          updatedAt: server.updatedAt,
          syncedAt: server.syncedAt,
        })

      if (result.changes > 0) {
        count += 1
      }
    }

    return count
  })

  return saveTransaction()
}

export function listStudioMcpRegistryServers({
  keyword = "",
  transport = "",
  status = "",
  source = "",
  offset = 0,
  limit = 24,
}: ListStudioMcpRegistryServersInput = {}) {
  const normalizedKeyword = keyword.trim().toLowerCase()
  const normalizedStatus = status.trim().toLowerCase()
  const normalizedSource = source.trim().toLowerCase()
  const rows = getDb()
    .prepare(
      `
        SELECT
          id,
          name,
          version,
          title,
          description,
          status,
          latest,
          source,
          transports,
          server_json,
          registry_meta,
          updated_at,
          synced_at
        FROM studio_mcp_registry_servers
        ORDER BY latest DESC, updated_at DESC, title ASC
      `
    )
    .all() as DbMcpRegistryServerRow[]
  const filtered = rows.map(mapMcpRegistryServer).filter((server) => {
    if (
      normalizedKeyword &&
      ![server.name, server.title, server.description, server.version]
        .join(" ")
        .toLowerCase()
        .includes(normalizedKeyword)
    ) {
      return false
    }

    if (
      transport &&
      transport !== "all" &&
      !server.transports.includes(transport)
    ) {
      return false
    }

    if (normalizedStatus && server.status.toLowerCase() !== normalizedStatus) {
      return false
    }

    if (normalizedSource && server.source.toLowerCase() !== normalizedSource) {
      return false
    }

    return true
  })
  const safeOffset = Math.max(0, offset)
  const safeLimit = Math.max(1, Math.min(limit, 100))

  return {
    data: filtered.slice(safeOffset, safeOffset + safeLimit),
    totalCount: filtered.length,
  }
}

export function getStudioMcpRegistryServer(id: string) {
  const row = getDb()
    .prepare(
      `
        SELECT
          id,
          name,
          version,
          title,
          description,
          status,
          latest,
          source,
          transports,
          server_json,
          registry_meta,
          updated_at,
          synced_at
        FROM studio_mcp_registry_servers
        WHERE id = ?
      `
    )
    .get(id) as DbMcpRegistryServerRow | undefined

  return row ? mapMcpRegistryServer(row) : null
}
