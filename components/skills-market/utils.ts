import type { McpTransportType } from "@/lib/mcp"
import {
  extractMcpRegistryTransports,
  normalizeMcpServerId,
  type InstalledMcpServer,
  type InstalledMcpServerApiResponse,
  type InstalledMcpServersApiResponse,
  type McpKeyValue,
  type McpRegistryServer,
  type McpRegistryServerDetailApiResponse,
  type McpRegistryServersApiResponse,
} from "@/lib/mcp"
import {
  type SkillDetailApiResponse,
  type InstalledSkill,
  type InstalledSkillApiResponse,
  type InstalledSkillsApiResponse,
  type SkillImportApiResponse,
  type SkillImportCandidatesApiResponse,
  type SkillImportResultData,
  type SkillImportScanData,
  type SkillMarketApiResponse,
  type SkillMeta,
  type SkillOrderBy,
} from "@/lib/skill-market"
import { cn } from "@/lib/utils"
import {
  allCategoriesValue,
  defaultMcpTransport,
  type McpManualFormState,
  type ParsedSkillMarkdown,
  type SkillCardSize,
  type InstallMcpPayload,
  PAGE_SIZE,
} from "./types"

export { allCategoriesValue, defaultMcpTransport }

class LoginRequiredError extends Error {
  constructor() {
    super("Login required.")
    this.name = "LoginRequiredError"
  }
}

export function isLoginRequiredError(error: unknown) {
  return error instanceof LoginRequiredError
}

export function throwIfUnauthorized(response: Response) {
  if (response.status === 401) {
    throw new LoginRequiredError()
  }
}

export function getSkillGridClass(size: SkillCardSize, spacious = false) {
  void size
  void spacious
  return "flex flex-col"
}

export function getLocaleTag(locale: string) {
  return locale === "zh" ? "zh-CN" : "en-US"
}

export function compactNumber(value: number | undefined, locale: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-"
  }

  return new Intl.NumberFormat(getLocaleTag(locale), {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-"
  }

  const units = ["B", "KB", "MB", "GB"]
  let size = value
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

export function formatUpdatedAt(value: number | undefined, locale: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "-"
  }

  const timestamp = value < 1_000_000_000_000 ? value * 1000 : value
  const date = new Date(timestamp)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

export function formatIsoDate(value: string | undefined, locale: string) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)
}

export function formatIsoDateTime(
  value: string | null | undefined,
  locale: string
) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(getLocaleTag(locale), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function getSkillTitle(skill: SkillMeta) {
  return skill.Name?.trim() || skill.Slug?.trim() || "Untitled skill"
}

export function getSkillDescription(skill: SkillMeta, locale: string) {
  const preferred = locale === "zh" ? skill.DescZh : skill.Desc
  const fallback = locale === "zh" ? skill.Desc : skill.DescZh

  return preferred?.trim() || fallback?.trim() || ""
}

export function getSkillSearchText(skill: SkillMeta) {
  return [
    skill.Slug,
    skill.Name,
    skill.Author,
    skill.Desc,
    skill.DescZh,
    skill.Category,
    skill.UpStream,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function categoryLabel(category: string) {
  return category
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function getMcpSearchText(
  server: InstalledMcpServer | McpRegistryServer
) {
  return [
    server.id,
    server.name,
    server.title,
    server.description,
    "version" in server ? server.version : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function getMcpTransportLabel(
  transport: McpTransportType,
  t: {
    mcpTransportStdio: string
    mcpTransportHttp: string
    mcpTransportSse: string
  }
) {
  if (transport === "stdio") {
    return t.mcpTransportStdio
  }

  if (transport === "sse") {
    return t.mcpTransportSse
  }

  return t.mcpTransportHttp
}

export function createEmptyMcpForm(): McpManualFormState {
  return {
    id: "",
    name: "",
    title: "",
    description: "",
    source: "manual",
    registryName: "",
    registryVersion: "",
    transport: defaultMcpTransport,
    url: "",
    command: "",
    args: "",
    cwd: "",
    headers: [],
    env: "",
    localCommandConfirmed: false,
  }
}

export function cleanSkillYamlScalar(value: string) {
  const trimmed = value.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }

  return trimmed
}

export function parseSkillMetadataLines(lines: string[]) {
  const metadata: Record<string, string> = {}

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]
    const trimmed = rawLine.trim()

    if (!trimmed || trimmed.startsWith("#")) {
      continue
    }

    const scalarMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)

    if (!scalarMatch) {
      continue
    }

    const key = scalarMatch[1]
    const value = scalarMatch[2]
    const normalizedValue = value.trim()

    if (normalizedValue === "|" || normalizedValue === ">") {
      const blockLines: string[] = []
      let nextIndex = index + 1

      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex]

        if (/^[A-Za-z0-9_-]+:\s*/.test(nextLine)) {
          break
        }

        blockLines.push(nextLine.replace(/^\s{2,}/, ""))
        nextIndex += 1
      }

      metadata[key] =
        normalizedValue === ">"
          ? blockLines
              .map((line) => line.trim())
              .join(" ")
              .trim()
          : blockLines.join("\n").trim()
      index = nextIndex - 1
      continue
    }

    metadata[key] = cleanSkillYamlScalar(value)
  }

  return metadata
}

export function parseSkillMarkdown(skillMd: string): ParsedSkillMarkdown {
  const normalized = skillMd.replace(/^\uFEFF/, "")
  const delimitedMatch = normalized.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
  )

  if (delimitedMatch) {
    return {
      body: normalized.slice(delimitedMatch[0].length).trimStart(),
      metadata: parseSkillMetadataLines(delimitedMatch[1].split(/\r?\n/)),
    }
  }

  const lines = normalized.split(/\r?\n/)
  const startsWithSkillMetadata = /^\s*name\s*:/i.test(lines[0] ?? "")

  if (!startsWithSkillMetadata) {
    return { body: normalized, metadata: {} }
  }

  const bodyStartIndex = lines.findIndex(
    (line, index) => index > 0 && /^#{1,6}\s+/.test(line)
  )

  if (bodyStartIndex <= 0) {
    return { body: normalized, metadata: {} }
  }

  const metadata = parseSkillMetadataLines(lines.slice(0, bodyStartIndex))

  if (!metadata.name && !metadata.description) {
    return { body: normalized, metadata: {} }
  }

  return {
    body: lines.slice(bodyStartIndex).join("\n").trimStart(),
    metadata,
  }
}

export function readRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

export function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function parseKeyValueLines(value: string): McpKeyValue[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const secretPrefix = "secret:"
      const isSecret = line.toLowerCase().startsWith(secretPrefix)
      const normalizedLine = isSecret ? line.slice(secretPrefix.length) : line
      const separatorIndex = normalizedLine.indexOf("=")
      const name =
        separatorIndex >= 0
          ? normalizedLine.slice(0, separatorIndex).trim()
          : normalizedLine.trim()
      const entryValue =
        separatorIndex >= 0 ? normalizedLine.slice(separatorIndex + 1) : ""

      return {
        name,
        value: entryValue,
        isSecret,
        hasValue: isSecret ? separatorIndex >= 0 : Boolean(entryValue),
      }
    })
    .filter((entry) => entry.name)
}

export function formatKeyValueLines(entries: McpKeyValue[] | undefined) {
  return (entries ?? [])
    .map((entry) => {
      const prefix = entry.isSecret ? "secret:" : ""

      return `${prefix}${entry.name}=${entry.value ?? ""}`
    })
    .join("\n")
}

export function normalizeKeyValueRows(entries: McpKeyValue[] | undefined) {
  return (entries ?? [])
    .map((entry) => {
      const value = entry.value ?? ""

      return {
        name: entry.name.trim(),
        value,
        isSecret: Boolean(entry.isSecret),
        hasValue: entry.isSecret
          ? Boolean(entry.hasValue || value)
          : Boolean(value),
      }
    })
    .filter((entry) => entry.name)
}

export function createEmptyKeyValueRow(): McpKeyValue {
  return {
    name: "",
    value: "",
    isSecret: false,
    hasValue: false,
  }
}

export function parseArgumentLine(value: string) {
  const matches = value.match(/"[^"]*"|'[^']*'|\S+/g) ?? []

  return matches.map((item) => item.replace(/^['"]|['"]$/g, ""))
}

export function formatArgumentLine(args: string[] | undefined) {
  return (args ?? [])
    .map((item) => (/[\"'\s]/.test(item) ? JSON.stringify(item) : item))
    .join(" ")
}

export function readRegistryArguments(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item
      }

      const record = readRecord(item)

      return (
        readString(record.value) ||
        readString(record.default) ||
        readString(record.name)
      )
    })
    .filter(Boolean)
}

export function getRegistryRemotes(server: McpRegistryServer) {
  return Array.isArray(server.serverJson.remotes)
    ? server.serverJson.remotes.map(readRecord)
    : []
}

export function getRegistryPackages(server: McpRegistryServer) {
  return Array.isArray(server.serverJson.packages)
    ? server.serverJson.packages.map(readRecord)
    : []
}

export function getRegistryPackageTransport(
  packageEntry: Record<string, unknown>
) {
  const rawTransport = packageEntry.transport

  if (typeof rawTransport === "string") {
    return rawTransport.trim()
  }

  return readString(readRecord(rawTransport).type)
}

export function createMcpEditDraft(
  server: InstalledMcpServer
): McpManualFormState {
  const base = {
    ...createEmptyMcpForm(),
    id: server.id,
    name: server.name,
    title: server.title,
    description: server.description,
    source: server.source,
    registryName: server.registryName ?? "",
    registryVersion: server.registryVersion ?? "",
    transport: server.config.type,
  }

  if (server.config.type === "stdio") {
    return {
      ...base,
      command: server.config.command,
      args: formatArgumentLine(server.config.args),
      cwd: server.config.cwd ?? "",
      env: formatKeyValueLines(server.config.env),
      localCommandConfirmed: false,
    }
  }

  return {
    ...base,
    url: server.config.url,
    headers: server.config.headers,
  }
}

export function createMcpRemoteInstallPayload(
  server: McpRegistryServer,
  transport: "streamable-http" | "sse"
): InstallMcpPayload | null {
  const remote = getRegistryRemotes(server).find(
    (item) => readString(item.type) === transport && readString(item.url)
  )

  if (!remote) {
    return null
  }

  return {
    id: normalizeMcpServerId(server.name),
    name: server.name,
    title: server.title,
    description: server.description,
    source: "registry",
    registryName: server.name,
    registryVersion: server.version,
    enabled: true,
    config: {
      type: transport,
      url: readString(remote.url),
      headers: [],
    },
  }
}

export function createMcpStdioDraft(
  server: McpRegistryServer
): McpManualFormState {
  const packageEntry =
    getRegistryPackages(server).find(
      (item) => getRegistryPackageTransport(item) === "stdio"
    ) ?? {}
  const runtimeHint = readString(packageEntry.runtimeHint)
  const identifier = readString(packageEntry.identifier)
  const version = readString(packageEntry.version) || server.version
  const args = [
    ...readRegistryArguments(packageEntry.runtimeArguments),
    identifier && version && version !== "latest"
      ? `${identifier}@${version}`
      : identifier,
    ...readRegistryArguments(packageEntry.packageArguments),
  ].filter(Boolean)

  return {
    ...createEmptyMcpForm(),
    id: normalizeMcpServerId(server.name),
    name: server.name,
    title: server.title,
    description: server.description,
    source: "registry",
    registryName: server.name,
    registryVersion: server.version,
    transport: "stdio",
    command: runtimeHint || "npx",
    args: args.join(" "),
  }
}

export function createMcpInstallDraft(server: McpRegistryServer) {
  return (
    createMcpRemoteInstallPayload(server, "streamable-http") ??
    createMcpRemoteInstallPayload(server, "sse")
  )
}

export async function fetchSkills({
  category,
  keyword,
  offset,
  orderBy,
  signal,
}: {
  category: string
  keyword: string
  offset: number
  orderBy: SkillOrderBy
  signal: AbortSignal
}): Promise<{
  data: SkillMeta[]
  totalCount: number
  allCategories: string[]
}> {
  const params = new URLSearchParams({
    offset: String(offset),
    limit: String(PAGE_SIZE),
    orderBy,
  })

  if (keyword) {
    params.set("keyword", keyword)
  }

  if (category !== allCategoriesValue) {
    params.set("category", category)
  }

  const response = await fetch(`/api/skills?${params}`, {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillMarketApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload as {
    data: SkillMeta[]
    totalCount: number
    allCategories: string[]
  }
}

export async function fetchSkillDetail(
  skill: SkillMeta,
  signal: AbortSignal
): Promise<{ skill: SkillMeta; skillMd: string }> {
  const slug = skill.Slug?.trim()

  if (!slug) {
    throw new Error("Skill slug is missing.")
  }

  const params = new URLSearchParams()

  if (skill.Version?.trim()) {
    params.set("version", skill.Version.trim())
  }

  const response = await fetch(
    `/api/skills/${encodeURIComponent(slug)}${
      params.size > 0 ? `?${params}` : ""
    }`,
    { signal, cache: "no-store" }
  )
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillDetailApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return (payload as { ok: true; data: { skill: SkillMeta; skillMd: string } })
    .data
}

export async function fetchInstalledSkills(
  signal: AbortSignal
): Promise<InstalledSkill[]> {
  const response = await fetch("/api/skills/installed", {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as InstalledSkillsApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

export async function installSkill(skill: SkillMeta): Promise<InstalledSkill> {
  const slug = skill.Slug?.trim()

  if (!slug) {
    throw new Error("Skill slug is missing.")
  }

  const response = await fetch("/api/skills/installed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug,
      ...(skill.Version?.trim() ? { version: skill.Version.trim() } : {}),
    }),
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as InstalledSkillApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

export async function fetchSkillImportCandidates(
  signal?: AbortSignal
): Promise<SkillImportScanData> {
  const response = await fetch("/api/skills/import-candidates", {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillImportCandidatesApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

export async function importSkillCandidatePaths(
  sourcePaths: string[]
): Promise<SkillImportResultData> {
  const response = await fetch("/api/skills/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourcePaths }),
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillImportApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return (payload as { ok: true; data: SkillImportResultData }).data
}

export async function parseSkillFolderFiles(
  fileList: FileList
): Promise<SkillImportScanData> {
  const formData = new FormData()

  formData.append("mode", "parse")

  for (const file of Array.from(fileList)) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name

    formData.append("files", file)
    formData.append("paths", relativePath)
  }

  const response = await fetch("/api/skills/import", {
    method: "POST",
    body: formData,
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillImportCandidatesApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return (
    payload as {
      ok: true
      data: SkillImportScanData
    }
  ).data
}

export async function importSkillFolderFiles(
  fileList: FileList,
  selectedPaths?: string[]
): Promise<SkillImportResultData> {
  const formData = new FormData()

  for (const file of Array.from(fileList)) {
    const relativePath =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
      file.name

    formData.append("files", file)
    formData.append("paths", relativePath)
  }

  for (const selectedPath of selectedPaths ?? []) {
    formData.append("selectedPaths", selectedPath)
  }

  const response = await fetch("/api/skills/import", {
    method: "POST",
    body: formData,
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as SkillImportApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return (payload as { ok: true; data: SkillImportResultData }).data
}

export async function updateInstalledSkill(
  slug: string,
  enabled: boolean
): Promise<InstalledSkill> {
  const response = await fetch(
    `/api/skills/installed/${encodeURIComponent(slug)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    }
  )
  throwIfUnauthorized(response)

  const payload = (await response.json()) as InstalledSkillApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

export async function removeInstalledSkill(slug: string): Promise<void> {
  const response = await fetch(
    `/api/skills/installed/${encodeURIComponent(slug)}`,
    { method: "DELETE" }
  )
  throwIfUnauthorized(response)

  const payload = (await response.json()) as
    { ok: true } | { ok: false; message: string }

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }
}

export async function fetchMcpMarket({
  cursor,
  keyword,
  signal,
}: {
  cursor: string
  keyword: string
  signal: AbortSignal
}): Promise<{
  data: McpRegistryServer[]
  totalCount: number
  nextCursor: string | null
}> {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    version: "latest",
  })

  if (cursor) {
    params.set("cursor", cursor)
  }

  if (keyword) {
    params.set("keyword", keyword)
  }

  const response = await fetch(`/api/mcp/market?${params}`, {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as McpRegistryServersApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload as {
    data: McpRegistryServer[]
    totalCount: number
    nextCursor: string | null
  }
}

export async function fetchMcpDetail(
  server: McpRegistryServer,
  signal?: AbortSignal
): Promise<McpRegistryServer> {
  const params = new URLSearchParams({ name: server.name })
  const response = await fetch(`/api/mcp/market/detail?${params}`, {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as McpRegistryServerDetailApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return {
    ...server,
    ...payload.data,
    id: payload.data.id || server.id,
    name: payload.data.name || server.name,
    title: payload.data.title || server.title,
    description: payload.data.description || server.description,
    version: payload.data.version || server.version,
    serverJsonUrl: payload.data.serverJsonUrl || server.serverJsonUrl,
    registryMeta: {
      ...server.registryMeta,
      ...payload.data.registryMeta,
    },
  }
}

export async function fetchInstalledMcp(
  signal: AbortSignal
): Promise<InstalledMcpServer[]> {
  const response = await fetch("/api/mcp/installed", {
    signal,
    cache: "no-store",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as InstalledMcpServersApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

export async function installMcpServer(
  payload: InstallMcpPayload
): Promise<InstalledMcpServer> {
  const response = await fetch("/api/mcp/installed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  throwIfUnauthorized(response)

  const responsePayload =
    (await response.json()) as InstalledMcpServerApiResponse

  if (!response.ok || !responsePayload.ok) {
    throw new Error(
      (!responsePayload.ok && responsePayload.message) || "Request failed"
    )
  }

  return responsePayload.data
}

export async function updateInstalledMcp(
  id: string,
  payload: Partial<InstallMcpPayload>
): Promise<InstalledMcpServer> {
  const response = await fetch(`/api/mcp/installed/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  throwIfUnauthorized(response)

  const responsePayload =
    (await response.json()) as InstalledMcpServerApiResponse

  if (!response.ok || !responsePayload.ok) {
    throw new Error(
      (!responsePayload.ok && responsePayload.message) || "Request failed"
    )
  }

  return responsePayload.data
}

export async function testInstalledMcp(
  id: string
): Promise<InstalledMcpServer> {
  const response = await fetch(
    `/api/mcp/installed/${encodeURIComponent(id)}/test`,
    { method: "POST" }
  )
  throwIfUnauthorized(response)

  const payload = (await response.json()) as
    | { ok: true; data: InstalledMcpServer }
    | { ok: false; message: string; data?: InstalledMcpServer }

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

export async function removeInstalledMcp(id: string): Promise<void> {
  const response = await fetch(`/api/mcp/installed/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })
  throwIfUnauthorized(response)

  const payload = (await response.json()) as
    { ok: true } | { ok: false; message: string }

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }
}

export { cn, normalizeMcpServerId, extractMcpRegistryTransports }
