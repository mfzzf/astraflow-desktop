import type { McpKeyValue, McpTransportConfig, McpTransportType, InstalledMcpServer } from "@/lib/mcp"
import type {
  InstalledSkill,
  InstalledSkillsApiResponse,
  SkillImportCandidate,
  SkillImportScanData,
  SkillMeta,
  SkillOrderBy,
} from "@/lib/skill-market"

export const PAGE_SIZE = 24
export const allCategoriesValue = "__all__"
export const defaultMcpTransport: McpTransportType = "streamable-http"

export type SkillDetailState = {
  skill: SkillMeta
  skillMd: string
}

export type ParsedSkillMarkdown = {
  body: string
  metadata: Record<string, string>
}

export type SkillsView = "market" | "mine"
export type PluginType = "experts" | "skills" | "mcp"
export type SkillCardSize = "default" | "large"

export type SkillsMarketPageProps = {
  embedded?: boolean
  initialView?: SkillsView
}

export type McpManualFormState = {
  id: string
  name: string
  title: string
  description: string
  source: "manual" | "registry"
  registryName: string
  registryVersion: string
  transport: McpTransportType
  url: string
  command: string
  args: string
  cwd: string
  headers: McpKeyValue[]
  env: string
  localCommandConfirmed: boolean
}

export type InstallMcpPayload = {
  id?: string
  name: string
  title?: string
  description?: string
  source?: "manual" | "registry"
  registryName?: string | null
  registryVersion?: string | null
  enabled?: boolean
  config: McpTransportConfig
  localCommandConfirmed?: boolean
}

export type SkillImportState = {
  open: boolean
  scanning: boolean
  importing: boolean
  source: "local" | "upload"
  files: FileList | null
  selected: Set<string>
  data: SkillImportScanData | null
}

export type UseSkillsMarketDialogState = {
  error: string
  mcpBusyId: string
  pluginType: PluginType
  view: SkillsView
  viewCounts: {
    enabledPluginCount: number
    totalPluginCount: number
  }
}

export type UseSkillsMarketListState = {
  skills: SkillMeta[]
  installedSkills: InstalledSkill[]
  mcpServers: import("@/lib/mcp").McpRegistryServer[]
  installedMcpServers: InstalledMcpServer[]
  categories: string[]
}

export type { InstalledSkillsApiResponse, SkillImportCandidate, SkillMeta, SkillOrderBy }
