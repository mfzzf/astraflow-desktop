import type {
  CodeBoxGithubStatus,
  CodeBoxSandboxStatus,
} from "@/lib/codebox-types"
import type { PromptMention } from "@/lib/agent/composer-types"
import type {
  McpServerCapabilities,
  McpServerPromptSummary,
  McpServerResourceSummary,
  McpServerSource,
  McpServerToolSummary,
  McpTransportConfig,
  McpTransportType,
} from "@/lib/mcp"
import type { SkillMeta } from "@/lib/skill-market"
import type {
  StudioAgentProviderEventDirection,
  StudioAttachment,
  StudioImageStatus,
  StudioMessageActivity,
  StudioMessagePart,
  StudioMessageRole,
  StudioMessageStatus,
  StudioMode,
  StudioPermissionMode,
  StudioSessionFileKind,
  StudioSessionSandbox,
} from "@/lib/studio-types"

export type DbSessionRow = {
  id: string
  mode: StudioMode
  title: string
  workspace_id: string | null
  project_id: string | null
  permission_mode: StudioPermissionMode
  chat_model: string | null
  chat_runtime_id: string | null
  chat_reasoning_effort: string | null
  latest_run_usage: string | null
  available_commands?: string | null
  pinned_at: string | null
  archived_at: string | null
  is_running?: number
  created_at: string
  updated_at: string
}

export type DbLocalProjectRow = {
  id: string
  name: string
  path: string
  created_at: string
  updated_at: string
  last_opened_at: string | null
}

export type DbWorkspaceRow = {
  id: string
  type: "local" | "sandbox"
  name: string
  root_path: string
  local_project_id: string | null
  sandbox_id: string | null
  created_at: string
  updated_at: string
  last_opened_at: string | null
}

export type DbMessageRow = {
  id: string
  session_id: string
  role: StudioMessageRole
  content: string
  mentions: string | null
  model: string | null
  environment: "local" | "remote" | null
  version_group_id: string | null
  version_index: number | null
  version_count: number | null
  active_version: number | null
  visible: number | null
  rewind_available?: number | null
  activities: string | null
  parts: string | null
  reasoning_content: string | null
  reasoning_duration_ms: number | null
  status: StudioMessageStatus
  attachments: string | null
  created_at: string
}

export type DbAgentProviderEventRow = {
  id: string
  session_id: string
  run_id: string | null
  assistant_message_id: string | null
  runtime_id: string
  provider: string
  direction: StudioAgentProviderEventDirection
  event_type: string
  provider_ref: string | null
  provider_session_id: string | null
  thread_id: string | null
  turn_id: string | null
  item_id: string | null
  parent_thread_id: string | null
  schema_version: string | null
  package_version: string | null
  payload: string
  created_at: string
}

export type DbSettingRow = {
  key: string
  value: string
  updated_at: string
}

export type DbPermissionRuleRow = {
  id: string
  project_id: string | null
  tool_name: string
  created_at: string
}

export type DbSessionSandboxRow = {
  session_id: string
  sandbox_id: string
  sandbox_domain: string | null
  template: string
  status: StudioSessionSandbox["status"]
  auto_pause_timeout_seconds: number
  volume_id: string | null
  volume_name: string | null
  volume_path: string | null
  created_at: string
  updated_at: string
  last_used_at: string
}

export type DbSessionFileRow = {
  id: string
  session_id: string
  message_id: string | null
  kind: StudioSessionFileKind
  original_name: string
  mime_type: string | null
  size: number | null
  storage_path: string
  sandbox_path: string | null
  source_tool_call_id: string | null
  saved_at: string | null
  created_at: string
  updated_at: string
}

export type DbInstalledSkillRow = {
  slug: string
  version: string
  skill_meta: string
  skill_md: string
  enabled: number
  bundled: number
  bundle_hash: string | null
  install_path: string
  installed_file_count: number
  installed_size_bytes: number
  installed_at: string
  updated_at: string
}

export type DbSessionSkillSyncRow = {
  session_id: string
  slug: string
  version: string
  sandbox_id: string
  sandbox_path: string
  synced_at: string
}

export type DbExpertCatalogCacheRow = {
  key: string
  catalog_hash: string
  catalog_version: string
  updated_at: string
  categories_json: string
  experts_json: string
  cached_at: string
}

export type DbExpertDetailCacheRow = {
  expert_id: string
  runtime_hash: string
  detail_json: string
  updated_at: string
  cached_at: string
}

export type DbSessionExpertRow = {
  session_id: string
  expert_id: string
  expert_type: string
  runtime_hash: string
  snapshot_json: string
  selected_at: string
}

export type DbInstalledMcpServerRow = {
  id: string
  name: string
  title: string
  description: string
  source: McpServerSource
  registry_name: string | null
  registry_version: string | null
  transport: McpTransportType
  config: string
  capabilities: string
  tools: string
  resources: string
  prompts: string
  enabled: number
  last_connected_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export type DbMcpServerSecretRow = {
  server_id: string
  name: string
  value: string
  updated_at: string
}

export type DbMcpRegistryServerRow = {
  id: string
  name: string
  version: string
  title: string
  description: string
  status: string
  latest: number
  source: "official"
  transports: string
  server_json: string
  registry_meta: string
  updated_at: string
  synced_at: string
}

export type DbCodeBoxVolumeRow = {
  volume_id: string
  name: string
  created_at: string
  last_seen_at: string
}

export type DbCodeBoxSandboxRow = {
  sandbox_id: string
  name: string | null
  owner_key: string | null
  owner_email: string | null
  company_id: string | null
  project_id: string | null
  volume_id: string | null
  volume_name: string | null
  sandbox_domain: string | null
  template: string
  status: CodeBoxSandboxStatus
  code_server_url: string | null
  code_server_host: string | null
  code_server_port: number
  password: string | null
  workspace_path: string
  repo_url: string | null
  started_at: string | null
  end_at: string | null
  created_at: string
  updated_at: string
  last_used_at: string
}

export type CodeBoxGithubTokens = CodeBoxGithubStatus & {
  accessToken: string
}

export type StudioAstraFlowApiKeyStatus = {
  configured: boolean
  keyPreview: string | null
  updatedAt: string | null
  fullKey?: string
}

export type StudioAstraFlowApiKeySessionStatus = {
  authenticated: boolean
  updatedAt: string | null
}

export type CreateSessionInput = {
  mode: StudioMode
  title?: string
  workspaceId?: string | null
  projectId?: string | null
  permissionMode?: StudioPermissionMode
  chatModel?: string | null
  chatRuntimeId?: string | null
  chatReasoningEffort?: string | null
}

export type CreateLocalProjectInput = {
  name: string
  path: string
}

export type CreateLocalWorkspaceInput = {
  name: string
  rootPath: string
  localProjectId: string
}

export type CreateSandboxWorkspaceInput = {
  name: string
  rootPath: string
  sandboxId: string
}

export type CreateMessageInput = {
  id?: string
  sessionId: string
  role: StudioMessageRole
  content: string
  mentions?: PromptMention[]
  model?: string | null
  environment?: "local" | "remote" | null
  versionGroupId?: string | null
  replacesMessageId?: string | null
  activities?: StudioMessageActivity[]
  parts?: StudioMessagePart[]
  reasoningContent?: string
  reasoningDurationMs?: number | null
  status?: StudioMessageStatus
  attachments?: StudioAttachment[]
}

export type UpdateMessageSnapshotInput = {
  messageId: string
  sessionId?: string
  content?: string
  activities?: StudioMessageActivity[]
  parts?: StudioMessagePart[]
  reasoningContent?: string
  reasoningDurationMs?: number | null
  status?: StudioMessageStatus
}

export type RecordAgentProviderEventInput = {
  id?: string
  sessionId: string
  runId?: string | null
  assistantMessageId?: string | null
  runtimeId: string
  provider: string
  direction: StudioAgentProviderEventDirection
  eventType: string
  providerRef?: string | null
  providerSessionId?: string | null
  threadId?: string | null
  turnId?: string | null
  itemId?: string | null
  parentThreadId?: string | null
  schemaVersion?: string | null
  packageVersion?: string | null
  payload: unknown
}

export type ListAgentProviderEventsInput = {
  sessionId: string
  runId?: string | null
  runtimeId?: string | null
  limit?: number
}

export type UpsertSessionSandboxInput = {
  sessionId: string
  sandboxId: string
  sandboxDomain?: string | null
  template: string
  status?: StudioSessionSandbox["status"]
  autoPauseTimeoutSeconds: number
  volumeId?: string | null
  volumeName?: string | null
  volumePath?: string | null
}

export type CreateSessionFileInput = {
  id?: string
  sessionId: string
  messageId?: string | null
  kind: StudioSessionFileKind
  originalName: string
  mimeType?: string | null
  size?: number | null
  storagePath: string
  sandboxPath?: string | null
  sourceToolCallId?: string | null
  savedAt?: string | null
}

export type UpsertInstalledSkillInput = {
  slug: string
  version: string
  skill: SkillMeta
  skillMd: string
  enabled?: boolean
  bundled?: boolean
  bundleHash?: string | null
  installPath: string
  installedFileCount: number
  installedSizeBytes: number
}

export type UpsertSessionSkillSyncInput = {
  sessionId: string
  slug: string
  version: string
  sandboxId: string
  sandboxPath: string
}

export type UpsertStudioMcpServerInput = {
  id?: string
  name: string
  title?: string
  description?: string
  source?: McpServerSource
  registryName?: string | null
  registryVersion?: string | null
  enabled?: boolean
  config: McpTransportConfig
  capabilities?: McpServerCapabilities
  tools?: McpServerToolSummary[]
  resources?: McpServerResourceSummary[]
  prompts?: McpServerPromptSummary[]
  lastConnectedAt?: string | null
  lastError?: string | null
}

export type UpdateStudioMcpServerInput = Partial<
  Omit<UpsertStudioMcpServerInput, "id">
>

export type UpdateStudioMcpServerDiscoveryInput = {
  id: string
  capabilities: McpServerCapabilities
  tools: McpServerToolSummary[]
  resources: McpServerResourceSummary[]
  prompts: McpServerPromptSummary[]
  lastConnectedAt?: string | null
  lastError?: string | null
}

export type ListStudioMcpRegistryServersInput = {
  keyword?: string
  transport?: McpTransportType | "all" | ""
  status?: string
  source?: string
  offset?: number
  limit?: number
}

export type UpsertCodeBoxVolumeInput = {
  volumeId: string
  name: string
  createdAt?: string
  lastSeenAt?: string
}

export type UpsertCodeBoxSandboxInput = {
  sandboxId: string
  name?: string | null
  ownerKey?: string | null
  ownerEmail?: string | null
  companyId?: string | null
  projectId?: string | null
  volumeId?: string | null
  volumeName?: string | null
  sandboxDomain?: string | null
  template: string
  status?: CodeBoxSandboxStatus
  codeServerUrl?: string | null
  codeServerHost?: string | null
  codeServerPort: number
  password?: string | null
  workspacePath: string
  repoUrl?: string | null
  startedAt?: string | null
  endAt?: string | null
}

export type DbImageGenerationRow = {
  id: string
  session_id: string
  model_square_id: string
  model_name: string
  manufacturer: string | null
  openapi_file: string | null
  operation_id: string | null
  prompt: string
  params: string
  status: StudioImageStatus
  phase: string | null
  progress: number | null
  raw_status: string | null
  attempt: number
  last_polled_at: string | null
  next_poll_at: string | null
  lease_owner: string | null
  lease_expires_at: string | null
  error_message: string | null
  raw_response: string | null
  created_at: string
  completed_at: string | null
}

export type DbImageOutputRow = {
  id: string
  generation_id: string
  output_index: number
  url: string | null
  data_url: string | null
  storage_path: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  metadata: string | null
  saved_at: string | null
  created_at: string
}

export type DbSavedImageOutputRow = {
  id: string
  generation_id: string
  session_id: string
  output_index: number
  prompt: string
  model_name: string
  manufacturer: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  storage_path: string | null
  saved_at: string
  created_at: string
}

export type CreateImageGenerationInput = {
  sessionId: string
  modelSquareId: string
  modelName: string
  manufacturer?: string | null
  openapiFile?: string | null
  operationId?: string | null
  prompt: string
  params: Record<string, unknown>
  status?: StudioImageStatus
  phase?: string | null
  progress?: number | null
  rawStatus?: string | null
  attempt?: number
  lastPolledAt?: string | null
  nextPollAt?: string | null
  leaseOwner?: string | null
  leaseExpiresAt?: string | null
}

export type CreateImageOutputInput = {
  id?: string
  generationId: string
  index: number
  url?: string | null
  dataUrl?: string | null
  storagePath?: string | null
  mimeType?: string | null
  width?: number | null
  height?: number | null
  metadata?: unknown
  autoSave?: boolean
}

export type UpdateImageGenerationInput = {
  status: StudioImageStatus
  errorMessage?: string | null
  rawResponse?: unknown
  completedAt?: string | null
  phase?: string | null
  progress?: number | null
  rawStatus?: string | null
  attempt?: number
  lastPolledAt?: string | null
  nextPollAt?: string | null
  leaseOwner?: string | null
  leaseExpiresAt?: string | null
}
