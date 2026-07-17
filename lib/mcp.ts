import { z } from "zod"

export const mcpTransportTypes = ["stdio", "streamable-http", "sse"] as const
export const mcpServerSources = ["manual", "registry"] as const
export const MCP_REGISTRY_PROVIDER = "official"

export type McpTransportType = (typeof mcpTransportTypes)[number]
export type McpServerSource = (typeof mcpServerSources)[number]

export const mcpKeyValueSchema = z.object({
  name: z.string().trim().min(1),
  value: z.string().optional(),
  isSecret: z.boolean().optional().default(false),
  hasValue: z.boolean().optional(),
})

export const mcpStdioTransportConfigSchema = z.object({
  type: z.literal("stdio"),
  command: z.string().trim().min(1),
  args: z.array(z.string()).optional().default([]),
  env: z.array(mcpKeyValueSchema).optional().default([]),
  cwd: z.string().trim().optional().nullable(),
})

export const mcpRemoteTransportConfigSchema = z.object({
  type: z.enum(["streamable-http", "sse"]),
  url: z.string().trim().url(),
  headers: z.array(mcpKeyValueSchema).optional().default([]),
})

export const mcpTransportConfigSchema = z.discriminatedUnion("type", [
  mcpStdioTransportConfigSchema,
  mcpRemoteTransportConfigSchema,
])

export const installedMcpServerSchema = z
  .object({
    id: z.string().trim().optional(),
    name: z.string().trim().min(1),
    title: z.string().trim().optional(),
    description: z.string().optional(),
    source: z.enum(mcpServerSources).optional().default("manual"),
    registryName: z.string().trim().optional().nullable(),
    registryVersion: z.string().trim().optional().nullable(),
    enabled: z.boolean().optional().default(true),
    config: mcpTransportConfigSchema,
    localCommandConfirmed: z.boolean().optional().default(false),
  })
  .superRefine((value, context) => {
    if (value.config.type === "stdio" && !value.localCommandConfirmed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local stdio MCP servers require command confirmation.",
        path: ["localCommandConfirmed"],
      })
    }
  })

export const patchInstalledMcpServerSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    title: z.string().trim().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    config: mcpTransportConfigSchema.optional(),
    localCommandConfirmed: z.boolean().optional().default(false),
  })
  .superRefine((value, context) => {
    if (value.config?.type === "stdio" && !value.localCommandConfirmed) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local stdio MCP servers require command confirmation.",
        path: ["localCommandConfirmed"],
      })
    }
  })

export type McpKeyValue = z.infer<typeof mcpKeyValueSchema>
export type McpStdioTransportConfig = z.infer<
  typeof mcpStdioTransportConfigSchema
>
export type McpRemoteTransportConfig = z.infer<
  typeof mcpRemoteTransportConfigSchema
>
export type McpTransportConfig = z.infer<typeof mcpTransportConfigSchema>

export type McpServerCapabilities = {
  tools?: boolean
  resources?: boolean
  prompts?: boolean
  roots?: boolean
  sampling?: boolean
  elicitation?: boolean
  raw?: Record<string, unknown>
}

export type McpServerToolSummary = {
  name: string
  title?: string
  description?: string
}

export type McpServerResourceSummary = {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export type McpServerPromptSummary = {
  name: string
  title?: string
  description?: string
}

export type InstalledMcpServer = {
  id: string
  name: string
  title: string
  description: string
  enabled: boolean
  source: McpServerSource
  registryName: string | null
  registryVersion: string | null
  transport: McpTransportType
  config: McpTransportConfig
  capabilities: McpServerCapabilities
  tools: McpServerToolSummary[]
  resources: McpServerResourceSummary[]
  prompts: McpServerPromptSummary[]
  lastConnectedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type McpRegistryServer = {
  id: string
  name: string
  title: string
  description: string
  version: string
  status: string
  latest: boolean
  source: typeof MCP_REGISTRY_PROVIDER
  transports: McpTransportType[]
  serverJson: Record<string, unknown>
  serverJsonUrl: string
  registryMeta: Record<string, unknown>
  updatedAt: string
  syncedAt: string
}

export type InstalledMcpServersApiResponse =
  | {
      ok: true
      data: InstalledMcpServer[]
    }
  | {
      ok: false
      message: string
    }

export type InstalledMcpServerApiResponse =
  | {
      ok: true
      data: InstalledMcpServer
    }
  | {
      ok: false
      message: string
    }

export type McpRegistryServersApiResponse =
  | {
      ok: true
      data: McpRegistryServer[]
      totalCount: number
      nextCursor: string | null
      allRegistryTypes: string[]
      allTransports: string[]
    }
  | {
      ok: false
      message: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false
}

function toRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function isMcpTransportType(value: string): value is McpTransportType {
  return (mcpTransportTypes as readonly string[]).includes(value)
}

export function normalizeMcpServerId(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)

  return normalized || "mcp-server"
}

export function sanitizeMcpToolNameSegment(value: string) {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64)

  if (!sanitized) {
    return "server"
  }

  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `server_${sanitized}`
}

export function getMcpToolServerName(serverId: string) {
  return `mcp_${sanitizeMcpToolNameSegment(serverId)}`
}

export function isMcpToolName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    /^mcp_[A-Za-z_][A-Za-z0-9_]*__.+$/.test(name)
  )
}

export function getMcpToolDisplayName(name: string) {
  if (!isMcpToolName(name)) {
    return name
  }

  return name.split("__").slice(1).join("__") || name
}

export function keyValuesToRecord(entries: McpKeyValue[] | undefined) {
  const record: Record<string, string> = {}

  for (const entry of entries ?? []) {
    const name = entry.name.trim()
    const value = entry.value ?? ""

    if (name && value) {
      record[name] = value
    }
  }

  return record
}

export function normalizeMcpTransportConfig(
  config: McpTransportConfig
): McpTransportConfig {
  if (config.type === "stdio") {
    return {
      type: "stdio",
      command: config.command.trim(),
      args: (config.args ?? []).map((arg) => String(arg)),
      env: normalizeKeyValues(config.env),
      cwd: config.cwd?.trim() || null,
    }
  }

  return {
    type: config.type,
    url: config.url.trim(),
    headers: normalizeKeyValues(config.headers),
  }
}

export function maskMcpTransportConfig(
  config: McpTransportConfig
): McpTransportConfig {
  if (config.type === "stdio") {
    return {
      ...config,
      env: maskKeyValues(config.env),
    }
  }

  return {
    ...config,
    headers: maskKeyValues(config.headers),
  }
}

export function applyMcpConfigSecrets(
  config: McpTransportConfig,
  secrets: Record<string, string>
): McpTransportConfig {
  const applyValues = (entries: McpKeyValue[] | undefined) =>
    normalizeKeyValues(entries).map((entry) =>
      entry.isSecret && secrets[entry.name] !== undefined
        ? {
            ...entry,
            value: secrets[entry.name],
            hasValue: true,
          }
        : entry
    )

  if (config.type === "stdio") {
    return {
      ...config,
      env: applyValues(config.env),
    }
  }

  return {
    ...config,
    headers: applyValues(config.headers),
  }
}

export function getMcpSecretEntries(config: McpTransportConfig) {
  const entries = config.type === "stdio" ? config.env : config.headers

  return normalizeKeyValues(entries).filter((entry) => entry.isSecret)
}

export function getMcpConfigSecretNames(config: McpTransportConfig) {
  return getMcpSecretEntries(config).map((entry) => entry.name)
}

export function extractMcpRegistryTransports(
  serverJson: Record<string, unknown>
) {
  const transports = new Set<McpTransportType>()

  for (const remote of toArray(serverJson.remotes)) {
    const remoteRecord = toRecord(remote)
    const type = readString(remoteRecord.type)

    if (isMcpTransportType(type)) {
      transports.add(type)
    }
  }

  for (const packageEntry of toArray(serverJson.packages)) {
    const packageRecord = toRecord(packageEntry)
    const rawTransport = packageRecord.transport
    const transport =
      typeof rawTransport === "string"
        ? rawTransport.trim()
        : readString(toRecord(rawTransport).type)

    if (isMcpTransportType(transport)) {
      transports.add(transport)
    }
  }

  return Array.from(transports)
}

export function normalizeMcpRegistryServerEntry(
  value: unknown,
  syncedAt = new Date().toISOString()
): McpRegistryServer | null {
  const entry = toRecord(value)
  const server = toRecord(entry.server ?? entry)
  const meta = toRecord(entry._meta)
  const name =
    readString(server.name) ||
    readString(server.id) ||
    readString(entry.name) ||
    readString(entry.id)
  const version =
    readString(server.version) ||
    readString(entry.version) ||
    readString(toRecord(server.server).version) ||
    "latest"

  if (!name) {
    return null
  }

  const title =
    readString(server.title) ||
    readString(server.displayName) ||
    readString(entry.title) ||
    name
  const updatedAt =
    readString(server.updatedAt) ||
    readString(server.updated_at) ||
    readString(server.publishedAt) ||
    readString(entry.updatedAt) ||
    syncedAt

  return {
    id: `${name}@${version}`,
    name,
    title,
    description:
      readString(server.description) || readString(entry.description) || "",
    version,
    status: readString(server.status) || readString(entry.status) || "",
    latest: readBoolean(server.latest) || readBoolean(entry.latest),
    source: MCP_REGISTRY_PROVIDER,
    transports: extractMcpRegistryTransports(server),
    serverJson: server,
    serverJsonUrl:
      readString(server.serverJsonUrl) || readString(entry.serverJsonUrl),
    registryMeta: meta,
    updatedAt,
    syncedAt,
  }
}

function normalizeKeyValues(entries: McpKeyValue[] | undefined) {
  return (entries ?? [])
    .map((entry) => ({
      name: entry.name.trim(),
      value: entry.value,
      isSecret: Boolean(entry.isSecret),
      hasValue: Boolean(entry.hasValue) || Boolean(entry.value),
    }))
    .filter((entry) => entry.name)
}

function maskKeyValues(entries: McpKeyValue[] | undefined) {
  return normalizeKeyValues(entries).map((entry) => {
    if (!entry.isSecret) {
      return {
        name: entry.name,
        value: entry.value ?? "",
        isSecret: false,
        hasValue: Boolean(entry.value),
      }
    }

    return {
      name: entry.name,
      value: "",
      isSecret: true,
      hasValue: Boolean(entry.hasValue || entry.value),
    }
  })
}
