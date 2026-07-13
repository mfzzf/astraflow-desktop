import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

import {
  applyMcpConfigSecrets,
  getMcpConfigSecretNames,
  maskMcpTransportConfig,
  normalizeMcpTransportConfig,
  type InstalledMcpServer,
  type McpKeyValue,
  type McpRegistryServer,
  type McpServerCapabilities,
  type McpServerPromptSummary,
  type McpServerResourceSummary,
  type McpServerToolSummary,
  type McpTransportConfig,
  type McpTransportType,
} from "@/lib/mcp"
import type { CodeBoxSandbox, CodeBoxVolume } from "@/lib/codebox-types"
import type {
  PromptMention,
  SlashCommandDescriptor,
} from "@/lib/agent/composer-types"
import type { InstalledSkill, SkillMeta } from "@/lib/skill-market"
import { studioPermissionModes } from "@/lib/studio-types"
import type {
  StudioAgentProviderEvent,
  StudioAttachment,
  StudioImageGeneration,
  StudioImageOutput,
  StudioImageStatus,
  StudioLocalProject,
  StudioMessage,
  StudioMessageActivity,
  StudioMessagePart,
  StudioPermissionMode,
  StudioSession,
  StudioSessionFile,
  StudioSessionSandbox,
  StudioWorkspace,
  StudioTokenUsage,
} from "@/lib/studio-types"

import { getStudioDatabase as getDb } from "./connection"
import type {
  DbAgentProviderEventRow,
  DbCodeBoxSandboxRow,
  DbCodeBoxVolumeRow,
  DbImageGenerationRow,
  DbImageOutputRow,
  DbInstalledMcpServerRow,
  DbInstalledSkillRow,
  DbLocalProjectRow,
  DbMcpRegistryServerRow,
  DbMcpServerSecretRow,
  DbMessageRow,
  DbSessionFileRow,
  DbSessionRow,
  DbSessionSandboxRow,
  DbSettingRow,
  DbWorkspaceRow,
} from "./types"

export const DEFAULT_SESSION_TITLE = "New chat"
export const STUDIO_MODELVERSE_API_KEY_SETTING = "modelverse_api_key"
export const STUDIO_ASTRAFLOW_API_KEY_SESSION_SETTING =
  "astraflow_api_key_session"
export const STUDIO_AGENT_MODEL_SETTINGS = "agent_model_settings"
export const SELECTED_UCLOUD_PROJECT_SETTING = "selected_ucloud_project"
export const STUDIO_EXA_API_KEY_SETTING = "exa_api_key"
export const STUDIO_OAUTH_SETTING = "ucloud_oauth_tokens"
export const CODEBOX_GITHUB_SETTING = "codebox_github_tokens"
export const STUDIO_SESSION_SANDBOX_VOLUME_SETTING =
  "studio_session_sandbox_volume"

export function nowIso() {
  return new Date().toISOString()
}

export function normalizeTitle(title: string | undefined) {
  const normalized = title?.trim()

  if (!normalized) {
    return DEFAULT_SESSION_TITLE
  }

  return normalized.length > 48 ? `${normalized.slice(0, 48)}...` : normalized
}

export function isTerminalImageStatus(status: StudioImageStatus) {
  return (
    status === "complete" ||
    status === "partial" ||
    status === "error" ||
    status === "cancelled"
  )
}

export function mapSession(row: DbSessionRow): StudioSession {
  return {
    id: row.id,
    mode: row.mode,
    title: row.title,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    permissionMode: normalizePermissionMode(row.permission_mode),
    chatModel: row.chat_model ?? null,
    chatRuntimeId: row.chat_runtime_id ?? null,
    chatReasoningEffort: row.chat_reasoning_effort ?? null,
    latestRunUsage: parseJsonValue<StudioTokenUsage | null>(
      row.latest_run_usage,
      null
    ),
    pinnedAt: row.pinned_at ?? null,
    archivedAt: row.archived_at ?? null,
    isRunning: row.is_running === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapWorkspace(row: DbWorkspaceRow): StudioWorkspace {
  const common = {
    id: row.id,
    name: row.name,
    rootPath: row.root_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  }

  if (row.type === "local" && row.local_project_id && !row.sandbox_id) {
    return {
      ...common,
      type: "local",
      localProjectId: row.local_project_id,
    }
  }

  if (row.type === "sandbox" && row.sandbox_id && !row.local_project_id) {
    return {
      ...common,
      type: "sandbox",
      sandboxId: row.sandbox_id,
    }
  }

  throw new Error(`Invalid Studio workspace row: ${row.id}`)
}

export function normalizePermissionMode(value: unknown): StudioPermissionMode {
  return typeof value === "string" &&
    studioPermissionModes.includes(value as StudioPermissionMode)
    ? (value as StudioPermissionMode)
    : "ask"
}

export function mapLocalProject(row: DbLocalProjectRow): StudioLocalProject {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  }
}

export function parseAttachments(raw: string | null): StudioAttachment[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (item): item is StudioAttachment =>
        typeof item === "object" &&
        item !== null &&
        ((item as StudioAttachment).type === "image" ||
          (item as StudioAttachment).type === "file") &&
        typeof (item as StudioAttachment).name === "string" &&
        typeof (item as StudioAttachment).mimeType === "string"
    )
  } catch {
    return []
  }
}

export function mapSessionSandbox(
  row: DbSessionSandboxRow
): StudioSessionSandbox {
  return {
    sessionId: row.session_id,
    sandboxId: row.sandbox_id,
    sandboxDomain: row.sandbox_domain,
    template: row.template,
    status: row.status,
    autoPauseTimeoutSeconds: row.auto_pause_timeout_seconds,
    volumeId: row.volume_id,
    volumeName: row.volume_name,
    volumePath: row.volume_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  }
}

export function mapCodeBoxVolume(row: DbCodeBoxVolumeRow): CodeBoxVolume {
  return {
    volumeId: row.volume_id,
    name: row.name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  }
}

export function mapCodeBoxSandbox(row: DbCodeBoxSandboxRow): CodeBoxSandbox {
  return {
    sandboxId: row.sandbox_id,
    name: row.name,
    ownerKey: row.owner_key,
    companyId: row.company_id,
    projectId: row.project_id,
    sandboxDomain: row.sandbox_domain,
    template: row.template,
    status: row.status,
    volumeId: row.volume_id,
    volumeName: row.volume_name,
    codeServerUrl: row.code_server_url,
    codeServerHost: row.code_server_host,
    codeServerPort: row.code_server_port,
    password: row.password,
    workspacePath: row.workspace_path,
    repoUrl: row.repo_url,
    startedAt: row.started_at,
    endAt: row.end_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
  }
}

export function mapSessionFile(row: DbSessionFileRow): StudioSessionFile {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    kind: row.kind,
    originalName: row.original_name,
    mimeType: row.mime_type,
    size: row.size,
    storagePath: row.storage_path,
    sandboxPath: row.sandbox_path,
    sourceToolCallId: row.source_tool_call_id,
    savedAt: row.saved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function parseSkillMeta(
  raw: string,
  fallbackSlug: string,
  fallbackVersion: string
) {
  try {
    const parsed = JSON.parse(raw) as SkillMeta

    return {
      ...parsed,
      Slug: parsed.Slug?.trim() || fallbackSlug,
      Version: parsed.Version?.trim() || fallbackVersion,
    }
  } catch {
    return {
      Slug: fallbackSlug,
      Version: fallbackVersion,
    }
  }
}

export function mapInstalledSkill(row: DbInstalledSkillRow): InstalledSkill {
  return {
    slug: row.slug,
    version: row.version,
    skill: parseSkillMeta(row.skill_meta, row.slug, row.version),
    skillMd: row.skill_md,
    enabled: row.enabled !== 0,
    bundled: row.bundled !== 0,
    bundleHash: row.bundle_hash,
    installPath: row.install_path,
    installedFileCount: row.installed_file_count,
    installedSizeBytes: row.installed_size_bytes,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
  }
}

export function parseJsonValue<T>(
  raw: string | null | undefined,
  fallback: T
): T {
  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function normalizeSlashCommandDescriptors(
  value: unknown
): SlashCommandDescriptor[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return []
    }

    const record = item as Record<string, unknown>
    const name = typeof record.name === "string" ? record.name.trim() : ""

    if (!name) {
      return []
    }

    const description =
      typeof record.description === "string" ? record.description : ""
    const source = record.source === "builtin" ? "builtin" : "runtime"
    const descriptor: SlashCommandDescriptor = {
      name,
      description,
      source,
    }

    if (typeof record.inputHint === "string" && record.inputHint.trim()) {
      descriptor.inputHint = record.inputHint.trim()
    }

    if (typeof record.runtimeId === "string" && record.runtimeId.trim()) {
      descriptor.runtimeId = record.runtimeId.trim()
    }

    return [descriptor]
  })
}

export function parseSlashCommandDescriptors(
  raw: string | null | undefined
): SlashCommandDescriptor[] {
  return normalizeSlashCommandDescriptors(parseJsonValue(raw, [] as unknown[]))
}

export function normalizePromptMentions(value: unknown): PromptMention[] {
  if (!Array.isArray(value)) {
    return []
  }

  const mentions: PromptMention[] = []

  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      continue
    }

    const record = item as Record<string, unknown>
    const kind = record.kind

    if (kind === "file" || kind === "folder") {
      const path = typeof record.path === "string" ? record.path.trim() : ""
      const name = typeof record.name === "string" ? record.name.trim() : ""

      if (!path || !name) {
        continue
      }

      if (kind === "file") {
        const mention: PromptMention = { kind, path, name }

        if (
          typeof record.mimeType === "string" &&
          record.mimeType.trim().length > 0
        ) {
          mention.mimeType = record.mimeType.trim()
        }

        mentions.push(mention)
        continue
      }

      mentions.push({ kind, path, name })
      continue
    }

    if (kind === "session") {
      const sessionId =
        typeof record.sessionId === "string" ? record.sessionId.trim() : ""
      const title = typeof record.title === "string" ? record.title.trim() : ""

      if (sessionId && title) {
        const promptContext =
          typeof record.promptContext === "string"
            ? record.promptContext.slice(0, 8_000)
            : undefined

        mentions.push({
          kind,
          sessionId,
          title,
          ...(promptContext !== undefined ? { promptContext } : {}),
        })
      }
    }
  }

  return mentions
}

export function parsePromptMentions(
  raw: string | null | undefined
): PromptMention[] {
  return normalizePromptMentions(parseJsonValue(raw, [] as unknown[]))
}

export function readMcpServerSecretMap(serverId: string) {
  const rows = getDb()
    .prepare(
      `
        SELECT server_id, name, value, updated_at
        FROM studio_mcp_server_secrets
        WHERE server_id = ?
      `
    )
    .all(serverId) as DbMcpServerSecretRow[]

  return Object.fromEntries(rows.map((row) => [row.name, row.value]))
}

export function mapInstalledMcpServer(
  row: DbInstalledMcpServerRow,
  {
    includeSecrets = false,
  }: {
    includeSecrets?: boolean
  } = {}
): InstalledMcpServer {
  const parsedConfig = parseJsonValue<McpTransportConfig>(row.config, {
    type: row.transport,
    ...(row.transport === "stdio"
      ? { command: "", args: [], env: [] }
      : { url: "", headers: [] }),
  } as McpTransportConfig)
  const normalizedConfig = normalizeMcpTransportConfig(parsedConfig)
  const config = includeSecrets
    ? applyMcpConfigSecrets(normalizedConfig, readMcpServerSecretMap(row.id))
    : maskMcpTransportConfig(normalizedConfig)

  return {
    id: row.id,
    name: row.name,
    title: row.title,
    description: row.description,
    source: row.source,
    registryName: row.registry_name,
    registryVersion: row.registry_version,
    transport: row.transport,
    config,
    capabilities: parseJsonValue<McpServerCapabilities>(row.capabilities, {}),
    tools: parseJsonValue<McpServerToolSummary[]>(row.tools, []),
    resources: parseJsonValue<McpServerResourceSummary[]>(row.resources, []),
    prompts: parseJsonValue<McpServerPromptSummary[]>(row.prompts, []),
    enabled: row.enabled !== 0,
    lastConnectedAt: row.last_connected_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function mapMcpRegistryServer(
  row: DbMcpRegistryServerRow
): McpRegistryServer {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    title: row.title,
    description: row.description,
    status: row.status,
    latest: row.latest !== 0,
    source: row.source,
    transports: parseJsonValue<McpTransportType[]>(row.transports, []),
    serverJson: parseJsonValue<Record<string, unknown>>(row.server_json, {}),
    registryMeta: parseJsonValue<Record<string, unknown>>(
      row.registry_meta,
      {}
    ),
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
  }
}

export function parseActivities(raw: string | null): StudioMessageActivity[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter(
      (item): item is StudioMessageActivity =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as StudioMessageActivity).id === "string" &&
        typeof (item as StudioMessageActivity).toolName === "string" &&
        ((item as StudioMessageActivity).status === "running" ||
          (item as StudioMessageActivity).status === "complete" ||
          (item as StudioMessageActivity).status === "error")
    )
  } catch {
    return []
  }
}

export function isStudioMessageActivity(
  value: unknown
): value is StudioMessageActivity {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StudioMessageActivity).id === "string" &&
    typeof (value as StudioMessageActivity).toolName === "string" &&
    ((value as StudioMessageActivity).status === "running" ||
      (value as StudioMessageActivity).status === "complete" ||
      (value as StudioMessageActivity).status === "error")
  )
}

export function isStudioPermissionOption(value: unknown) {
  const option = value as {
    _meta?: unknown
    kind?: unknown
    name?: unknown
    optionId?: unknown
  }

  return (
    typeof value === "object" &&
    value !== null &&
    typeof option.optionId === "string" &&
    typeof option.name === "string" &&
    typeof option.kind === "string" &&
    (typeof option._meta === "undefined" ||
      option._meta === null ||
      (typeof option._meta === "object" && !Array.isArray(option._meta)))
  )
}

export function isStudioUserInputOption(value: unknown) {
  const option = value as {
    description?: unknown
    label?: unknown
    optionId?: unknown
  }

  return (
    typeof value === "object" &&
    value !== null &&
    typeof option.optionId === "string" &&
    typeof option.label === "string" &&
    typeof option.description === "string"
  )
}

export function isStudioUserInputQuestion(value: unknown) {
  const question = value as {
    allowOther?: unknown
    header?: unknown
    id?: unknown
    isSecret?: unknown
    options?: unknown
    question?: unknown
  }

  return (
    typeof value === "object" &&
    value !== null &&
    typeof question.id === "string" &&
    typeof question.header === "string" &&
    typeof question.question === "string" &&
    Array.isArray(question.options) &&
    question.options.every(isStudioUserInputOption) &&
    typeof question.allowOther === "boolean" &&
    typeof question.isSecret === "boolean"
  )
}

export function isStudioUserInputAnswer(value: unknown) {
  const answer = value as {
    label?: unknown
    optionId?: unknown
    questionId?: unknown
    text?: unknown
  }

  return (
    typeof value === "object" &&
    value !== null &&
    typeof answer.questionId === "string" &&
    (typeof answer.optionId === "string" || answer.optionId === null) &&
    (typeof answer.label === "string" || answer.label === null) &&
    typeof answer.text === "string"
  )
}

export function isStudioMessageTodo(value: unknown) {
  const todo = value as {
    priority?: unknown
    status?: unknown
    text?: unknown
  }

  return (
    typeof value === "object" &&
    value !== null &&
    typeof todo.text === "string" &&
    (todo.status === "pending" ||
      todo.status === "in_progress" ||
      todo.status === "completed") &&
    (typeof todo.priority === "string" ||
      todo.priority === null ||
      typeof todo.priority === "undefined")
  )
}

export function isStudioMediaGenerationOutput(value: unknown) {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { index?: unknown }).index === "number" &&
    typeof (value as { contentUrl?: unknown }).contentUrl === "string" &&
    (typeof (value as { url?: unknown }).url === "string" ||
      (value as { url?: unknown }).url === null) &&
    (typeof (value as { storagePath?: unknown }).storagePath === "string" ||
      (value as { storagePath?: unknown }).storagePath === null) &&
    (typeof (value as { mimeType?: unknown }).mimeType === "string" ||
      (value as { mimeType?: unknown }).mimeType === null) &&
    (typeof (value as { width?: unknown }).width === "number" ||
      (value as { width?: unknown }).width === null) &&
    (typeof (value as { height?: unknown }).height === "number" ||
      (value as { height?: unknown }).height === null) &&
    (typeof (value as { durationSeconds?: unknown }).durationSeconds ===
      "number" ||
      (value as { durationSeconds?: unknown }).durationSeconds === null ||
      typeof (value as { durationSeconds?: unknown }).durationSeconds ===
        "undefined")
  )
}

export function parseParts(raw: string | null): StudioMessagePart[] {
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((item): item is StudioMessagePart => {
        if (typeof item !== "object" || item === null) {
          return false
        }

        const part = item as StudioMessagePart

        if (part.type === "text") {
          return typeof part.id === "string" && typeof part.content === "string"
        }

        if (part.type === "reasoning") {
          return typeof part.id === "string" && typeof part.content === "string"
        }

        if (part.type === "plan") {
          return (
            typeof part.id === "string" &&
            typeof part.content === "string" &&
            Array.isArray(part.todos) &&
            part.todos.every(isStudioMessageTodo)
          )
        }

        if (part.type === "subagent") {
          return (
            typeof part.id === "string" &&
            typeof part.taskId === "string" &&
            typeof part.name === "string" &&
            (part.status === "running" ||
              part.status === "complete" ||
              part.status === "error" ||
              part.status === "cancelled") &&
            typeof part.taskInput === "string" &&
            typeof part.content === "string" &&
            (typeof part.summary === "string" || part.summary === null) &&
            (typeof part.error === "string" || part.error === null) &&
            Array.isArray(part.todos) &&
            part.todos.every(isStudioMessageTodo) &&
            Array.isArray(part.activities) &&
            part.activities.every(isStudioMessageActivity) &&
            (typeof part.parentTaskId === "string" ||
              part.parentTaskId === null ||
              typeof part.parentTaskId === "undefined")
          )
        }

        if (part.type === "file") {
          return (
            typeof part.id === "string" &&
            typeof part.path === "string" &&
            (part.kind === "create" ||
              part.kind === "edit" ||
              part.kind === "delete") &&
            (part.status === "complete" || part.status === "error") &&
            (typeof part.error === "string" || part.error === null) &&
            typeof part.content === "string" &&
            (typeof part.diff === "string" ||
              part.diff === null ||
              typeof part.diff === "undefined") &&
            (part.stats === null ||
              typeof part.stats === "undefined" ||
              (typeof part.stats === "object" &&
                typeof part.stats.additions === "number" &&
                typeof part.stats.deletions === "number")) &&
            (typeof part.parentTaskId === "string" ||
              part.parentTaskId === null ||
              typeof part.parentTaskId === "undefined")
          )
        }

        if (part.type === "media_generation") {
          return (
            typeof part.id === "string" &&
            (part.kind === "image" || part.kind === "video") &&
            typeof part.generationId === "string" &&
            (part.status === "queued" ||
              part.status === "running" ||
              part.status === "polling" ||
              part.status === "complete" ||
              part.status === "partial" ||
              part.status === "error" ||
              part.status === "cancelled") &&
            typeof part.modelName === "string" &&
            typeof part.prompt === "string" &&
            (typeof part.phase === "string" ||
              part.phase === null ||
              typeof part.phase === "undefined") &&
            (typeof part.progress === "number" ||
              part.progress === null ||
              typeof part.progress === "undefined") &&
            (typeof part.rawStatus === "string" ||
              part.rawStatus === null ||
              typeof part.rawStatus === "undefined") &&
            Array.isArray(part.outputs) &&
            part.outputs.every(isStudioMediaGenerationOutput) &&
            (typeof part.errorMessage === "string" ||
              part.errorMessage === null) &&
            (typeof part.providerTaskId === "string" ||
              part.providerTaskId === null ||
              typeof part.providerTaskId === "undefined") &&
            (typeof part.providerRequestId === "string" ||
              part.providerRequestId === null ||
              typeof part.providerRequestId === "undefined") &&
            (typeof part.parentTaskId === "string" ||
              part.parentTaskId === null ||
              typeof part.parentTaskId === "undefined")
          )
        }

        if (part.type === "permission") {
          return (
            typeof part.id === "string" &&
            typeof part.toolName === "string" &&
            typeof part.input === "string" &&
            (part.status === "pending" ||
              part.status === "approved" ||
              part.status === "denied" ||
              part.status === "cancelled") &&
            Array.isArray(part.options) &&
            part.options.every(isStudioPermissionOption) &&
            (typeof part.selectedOptionId === "string" ||
              part.selectedOptionId === null)
          )
        }

        if (part.type === "user_input") {
          return (
            typeof part.id === "string" &&
            (part.status === "pending" ||
              part.status === "answered" ||
              part.status === "cancelled") &&
            Array.isArray(part.questions) &&
            part.questions.every(isStudioUserInputQuestion) &&
            Array.isArray(part.answers) &&
            part.answers.every(isStudioUserInputAnswer) &&
            (typeof part.autoResolutionMs === "number" ||
              part.autoResolutionMs === null)
          )
        }

        return (
          part.type === "tool" &&
          typeof part.id === "string" &&
          isStudioMessageActivity(part.activity)
        )
      })
      .map((part) =>
        part.type === "reasoning"
          ? {
              ...part,
              durationMs:
                typeof part.durationMs === "number" &&
                Number.isFinite(part.durationMs)
                  ? part.durationMs
                  : null,
            }
          : part.type === "file"
            ? {
                ...part,
                diff: typeof part.diff === "string" ? part.diff : null,
                stats:
                  part.stats &&
                  typeof part.stats.additions === "number" &&
                  typeof part.stats.deletions === "number"
                    ? part.stats
                    : null,
              }
            : part
      )
  } catch {
    return []
  }
}

export function mapMessage(row: DbMessageRow): StudioMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    mentions: parsePromptMentions(row.mentions),
    model: row.model,
    environment:
      row.environment === "local" || row.environment === "remote"
        ? row.environment
        : null,
    versionGroupId: row.version_group_id,
    versionIndex: row.version_index ?? 1,
    versionCount: row.version_count ?? 1,
    isActiveVersion: row.active_version !== 0,
    activities: parseActivities(row.activities),
    parts: parseParts(row.parts),
    reasoningContent: row.reasoning_content ?? "",
    reasoningDurationMs: row.reasoning_duration_ms,
    status: row.status,
    attachments: parseAttachments(row.attachments),
    createdAt: row.created_at,
  }
}

export function mapAgentProviderEvent(
  row: DbAgentProviderEventRow
): StudioAgentProviderEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    assistantMessageId: row.assistant_message_id,
    runtimeId: row.runtime_id,
    provider: row.provider,
    direction: row.direction,
    eventType: row.event_type,
    providerRef: row.provider_ref,
    providerSessionId: row.provider_session_id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    parentThreadId: row.parent_thread_id,
    schemaVersion: row.schema_version,
    packageVersion: row.package_version,
    payload: parseJsonValue(row.payload, null as unknown),
    createdAt: row.created_at,
  }
}

export function stringifyProviderEventPayload(payload: unknown) {
  try {
    return JSON.stringify(payload)
  } catch {
    return JSON.stringify({
      unsupportedPayload: String(payload),
    })
  }
}

export function readStudioSetting(key: string) {
  return getDb()
    .prepare(
      `
        SELECT key, value, updated_at
        FROM studio_settings
        WHERE key = ?
      `
    )
    .get(key) as DbSettingRow | undefined
}

export function writeStudioSetting(
  key: string,
  value: string,
  updatedAt = nowIso()
) {
  getDb()
    .prepare(
      `
        INSERT INTO studio_settings (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    )
    .run(key, value, updatedAt)

  return updatedAt
}

export function deleteStudioSetting(key: string) {
  getDb()
    .prepare(
      `
        DELETE FROM studio_settings
        WHERE key = ?
      `
    )
    .run(key)
}

const ENCRYPTED_SETTING_PREFIX = "enc:v1:"

let cachedSecretKey: Buffer | null | undefined

export function getSecretKey(): Buffer | null {
  if (cachedSecretKey !== undefined) {
    return cachedSecretKey
  }

  const raw = process.env.ASTRAFLOW_SECRET_KEY?.trim()

  if (raw && /^[0-9a-f]{64}$/i.test(raw)) {
    cachedSecretKey = Buffer.from(raw, "hex")
  } else {
    cachedSecretKey = null
  }

  return cachedSecretKey
}

// Encrypts a settings value with AES-256-GCM when a secret key is available.
// Without a key (e.g. plain `next dev`) the value is stored as-is, preserving
// the previous plaintext behavior.
export function encryptSettingValue(value: string): string {
  const key = getSecretKey()

  if (!key) {
    return value
  }

  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return `${ENCRYPTED_SETTING_PREFIX}${Buffer.concat([iv, authTag, encrypted]).toString("base64")}`
}

// Decrypts a value produced by encryptSettingValue. Legacy plaintext values
// (no prefix) are returned unchanged, and undecryptable values fall back to
// the raw stored string so reads never throw.
export function decryptSettingValue(value: string): string {
  if (!value.startsWith(ENCRYPTED_SETTING_PREFIX)) {
    return value
  }

  const key = getSecretKey()

  if (!key) {
    return value
  }

  try {
    const payload = Buffer.from(
      value.slice(ENCRYPTED_SETTING_PREFIX.length),
      "base64"
    )
    const iv = payload.subarray(0, 12)
    const authTag = payload.subarray(12, 28)
    const encrypted = payload.subarray(28)
    const decipher = createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(authTag)

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    return value
  }
}

export function readSecretSetting(key: string) {
  const row = readStudioSetting(key)

  if (!row?.value) {
    return row
  }

  return { ...row, value: decryptSettingValue(row.value) }
}

export function writeSecretSetting(
  key: string,
  value: string,
  updatedAt = nowIso()
) {
  return writeStudioSetting(key, encryptSettingValue(value), updatedAt)
}

export function prepareMcpConfigForStorage({
  config,
  serverId,
}: {
  config: McpTransportConfig
  serverId: string
}) {
  const normalizedConfig = normalizeMcpTransportConfig(config)
  const existingSecrets = readMcpServerSecretMap(serverId)
  const secretsToSave: Record<string, string> = {}
  const secretsToDelete = new Set<string>()
  const secretNames = new Set(getMcpConfigSecretNames(normalizedConfig))

  const prepareEntries = (entries: McpKeyValue[] | undefined) =>
    (entries ?? []).map((entry) => {
      if (!entry.isSecret) {
        return entry
      }

      const value = entry.value ?? ""

      if (value) {
        secretsToSave[entry.name] = value

        return {
          ...entry,
          value: "",
          hasValue: true,
        }
      }

      const hasExistingValue =
        Boolean(entry.hasValue) && existingSecrets[entry.name] !== undefined

      if (!hasExistingValue) {
        secretsToDelete.add(entry.name)
      }

      return {
        ...entry,
        value: "",
        hasValue: hasExistingValue,
      }
    })

  const storedConfig =
    normalizedConfig.type === "stdio"
      ? {
          ...normalizedConfig,
          env: prepareEntries(normalizedConfig.env),
        }
      : {
          ...normalizedConfig,
          headers: prepareEntries(normalizedConfig.headers),
        }

  return {
    storedConfig: maskMcpTransportConfig(storedConfig),
    secretNames,
    secretsToSave,
    secretsToDelete,
  }
}

export function maskStudioApiKey(apiKey: string) {
  if (apiKey.length <= 12) {
    return apiKey
  }

  return `${apiKey.slice(0, 10)}...${apiKey.slice(-4)}`
}

export function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed JSON; treat as empty record.
  }

  return {}
}

export function mapImageOutput(row: DbImageOutputRow): StudioImageOutput {
  const src = row.data_url ?? row.url ?? ""

  return {
    id: row.id,
    generationId: row.generation_id,
    index: row.output_index,
    src,
    url: row.url,
    dataUrl: row.data_url,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    savedAt: row.saved_at,
    createdAt: row.created_at,
  }
}

export function mapImageGeneration(
  row: DbImageGenerationRow,
  outputs: StudioImageOutput[]
): StudioImageGeneration {
  return {
    id: row.id,
    sessionId: row.session_id,
    modelSquareId: row.model_square_id,
    modelName: row.model_name,
    manufacturer: row.manufacturer,
    openapiFile: row.openapi_file,
    operationId: row.operation_id,
    prompt: row.prompt,
    params: parseJsonRecord(row.params),
    status: row.status,
    phase: row.phase,
    progress: row.progress,
    rawStatus: row.raw_status,
    attempt: row.attempt,
    lastPolledAt: row.last_polled_at,
    nextPollAt: row.next_poll_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    outputs,
  }
}
