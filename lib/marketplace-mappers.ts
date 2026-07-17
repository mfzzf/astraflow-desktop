import type {
  AstraflowV1McpMarketItem,
  AstraflowV1SkillMarketItem,
} from "@/lib/generated/astraflow-api"
import {
  MCP_REGISTRY_PROVIDER,
  mcpTransportTypes,
  type McpRegistryServer,
  type McpTransportType,
} from "@/lib/mcp"
import type { SkillMeta } from "@/lib/skill-market"

function toSafeNumber(value: string | number | undefined) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function toMcpTransports(values: string[] | undefined) {
  return (values ?? []).filter((value): value is McpTransportType =>
    (mcpTransportTypes as readonly string[]).includes(value)
  )
}

export function toMcpRegistryServer(
  item: AstraflowV1McpMarketItem,
  serverJson: Record<string, unknown> = {}
): McpRegistryServer | null {
  const name = item.name?.trim() ?? ""
  if (!name) {
    return null
  }

  const version = item.version?.trim() || "latest"
  const updatedAt =
    item.updatedAt?.trim() ||
    item.publishedAt?.trim() ||
    new Date().toISOString()

  return {
    id: `${name}@${version}`,
    name,
    title: item.title?.trim() || name,
    description: item.description?.trim() || "",
    version,
    status: item.status?.trim() || "",
    latest: Boolean(item.isLatest),
    source: MCP_REGISTRY_PROVIDER,
    transports: toMcpTransports(item.transports),
    serverJson,
    serverJsonUrl: item.serverJsonUrl?.trim() || "",
    registryMeta: {
      serverJsonUrl: item.serverJsonUrl?.trim() || "",
      websiteUrl: item.websiteUrl ?? "",
      repository: item.repository ?? {},
      iconUrl: item.iconUrl ?? "",
      registryTypes: item.registryTypes ?? [],
      publishedAt: item.publishedAt ?? "",
    },
    updatedAt,
    syncedAt: new Date().toISOString(),
  }
}

export function toSkillMeta(item: AstraflowV1SkillMarketItem): SkillMeta {
  return {
    Slug: item.slug,
    Version: item.version,
    Name: item.name,
    Author: item.author,
    Desc: item.description,
    DescZh: item.descriptionZh,
    Category: item.category,
    License: item.license,
    Downloads: toSafeNumber(item.downloads),
    FileCount: item.fileCount ?? 0,
    SizeBytes: toSafeNumber(item.sizeBytes),
    ArchiveUrl: item.archiveUrl,
    UpStreamUrl: item.upstreamUrl,
    UpStreamUpdatedAt: toSafeNumber(item.upstreamUpdatedAt),
    FilesJson: item.filesJson,
    SkillMdUrl: item.skillMdUrl,
    UpStream: item.upstream,
    Latest: item.latest,
    IconUrl: item.iconUrl,
  }
}
