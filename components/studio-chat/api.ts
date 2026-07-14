import type {
  PromptMention,
  SlashCommandDescriptor,
} from "@/lib/agent/composer-types"
import type { AgentModelSettingsPayload } from "@/lib/agent-model-settings-shared"
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"
import type { ChatReasoningEffort, SupportedChatModel } from "@/lib/chat-models"
import type { ExpertSummonData } from "@/components/experts-market/types"
import type { InstalledMcpServersApiResponse } from "@/lib/mcp"
import type { InstalledSkillsApiResponse } from "@/lib/skill-market"
import type {
  StudioAttachment,
  StudioChatRunSnapshot,
  StudioLocalProjectWithGitInfo,
  StudioMessage,
  StudioMessageActivity,
  StudioMessagePart,
  StudioPermissionMode,
  StudioSession,
  StudioTokenUsage,
  StudioUserInputAnswer,
  StudioWorkspace,
} from "@/lib/studio-types"

import { STUDIO_SESSION_TITLE_MAX_LENGTH } from "./constants"
import { normalizeChatRuntimeInfos } from "./chat-preferences"
import type {
  ApiResponse,
  ChatRunEnvironment,
  ComposerSelectedExpert,
  WorkspaceFileCandidate,
} from "./types"

export function stringifyApiError(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export async function readJson<T>(response: Response) {
  const data = (await response.json()) as ApiResponse<T>

  if (!response.ok || !data.ok) {
    const detail = data.ok ? "" : data.message || stringifyApiError(data.error)

    throw new Error(detail || `Request failed (${response.status})`)
  }

  return data.data
}

export async function listAgentRuntimes() {
  const response = await fetch("/api/studio/agent-runtimes", {
    cache: "no-store",
  })

  return normalizeChatRuntimeInfos(await readJson<AgentRuntimeInfo[]>(response))
}

export async function getAgentModelSettingsForComposer() {
  const response = await fetch("/api/studio/agent-model-settings", {
    cache: "no-store",
  })

  return readJson<AgentModelSettingsPayload>(response)
}

export async function listLocalProjectsForComposer() {
  const response = await fetch("/api/studio/local-projects", {
    cache: "no-store",
  })

  return readJson<StudioLocalProjectWithGitInfo[]>(response)
}

export async function createLocalProjectForComposer(path: string) {
  const response = await fetch("/api/studio/local-projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  })

  return readJson<StudioLocalProjectWithGitInfo>(response)
}

export async function listStudioSessionsForComposer() {
  const response = await fetch("/api/studio/sessions", { cache: "no-store" })

  return readJson<StudioSession[]>(response)
}

export async function getStudioSessionForComposer(sessionId: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    cache: "no-store",
  })

  return readJson<StudioSession>(response)
}

export async function getStudioWorkspaceForComposer(workspaceId: string) {
  const response = await fetch(
    `/api/studio/workspaces/${encodeURIComponent(workspaceId)}`,
    { cache: "no-store" }
  )

  return readJson<StudioWorkspace>(response)
}

export async function listStudioWorkspacesForComposer() {
  const response = await fetch("/api/studio/workspaces", {
    cache: "no-store",
  })

  return readJson<StudioWorkspace[]>(response)
}

export function isObjectRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function normalizeRuntimeSlashCommand(
  value: unknown
): SlashCommandDescriptor | null {
  if (!isObjectRecord(value) || typeof value.name !== "string") {
    return null
  }

  const name = value.name.trim().replace(/^\/+/, "")

  if (!name) {
    return null
  }

  return {
    name,
    description: typeof value.description === "string" ? value.description : "",
    inputHint:
      typeof value.inputHint === "string" ? value.inputHint : undefined,
    source: "runtime",
    runtimeId:
      typeof value.runtimeId === "string" ? value.runtimeId : undefined,
  }
}

export function getCommandsFromResponsePayload(payload: unknown): unknown[] {
  if (!isObjectRecord(payload)) {
    return []
  }

  if (Array.isArray(payload.commands)) {
    return payload.commands
  }

  if (isObjectRecord(payload.data) && Array.isArray(payload.data.commands)) {
    return payload.data.commands
  }

  if (Array.isArray(payload.data)) {
    return payload.data
  }

  return []
}

export async function listSessionSlashCommands(sessionId: string) {
  if (!sessionId) {
    return []
  }

  try {
    const response = await fetch(
      `/api/studio/sessions/${encodeURIComponent(sessionId)}/commands`,
      { cache: "no-store" }
    )

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as unknown

    return getCommandsFromResponsePayload(payload)
      .map(normalizeRuntimeSlashCommand)
      .filter((command): command is SlashCommandDescriptor => Boolean(command))
  } catch {
    return []
  }
}

export function normalizeWorkspaceFileCandidate(
  value: unknown
): WorkspaceFileCandidate | null {
  if (
    !isObjectRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.relativePath !== "string" ||
    typeof value.name !== "string" ||
    (value.kind !== "file" && value.kind !== "folder")
  ) {
    return null
  }

  return {
    path: value.path,
    relativePath: value.relativePath,
    name: value.name,
    kind: value.kind,
  }
}

export function getWorkspaceFilesFromResponsePayload(
  payload: unknown
): unknown[] {
  if (!isObjectRecord(payload)) {
    return []
  }

  if (Array.isArray(payload.files)) {
    return payload.files
  }

  if (isObjectRecord(payload.data) && Array.isArray(payload.data.files)) {
    return payload.data.files
  }

  return []
}

export async function listWorkspaceFilesForComposer({
  projectId,
  query,
  limit = 30,
}: {
  projectId: string
  query: string
  limit?: number
}) {
  if (!projectId) {
    return []
  }

  const searchParams = new URLSearchParams({
    projectId,
    q: query,
    limit: String(limit),
  })

  try {
    const response = await fetch(
      `/api/studio/workspace/files?${searchParams.toString()}`,
      { cache: "no-store" }
    )

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as unknown

    return getWorkspaceFilesFromResponsePayload(payload)
      .map(normalizeWorkspaceFileCandidate)
      .filter((file): file is WorkspaceFileCandidate => Boolean(file))
  } catch {
    return []
  }
}

export async function createSession(
  title: string,
  options?: {
    chatModel: SupportedChatModel
    chatRuntimeId: string
    chatReasoningEffort: ChatReasoningEffort
    workspaceId?: string | null
    projectId?: string | null
    permissionMode?: StudioPermissionMode
  }
) {
  const response = await fetch("/api/studio/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "chat",
      title,
      workspaceId: options?.workspaceId,
      projectId: options?.projectId,
      permissionMode: options?.permissionMode,
      chatModel: options?.chatModel,
      chatRuntimeId: options?.chatRuntimeId,
      chatReasoningEffort: options?.chatReasoningEffort,
    }),
  })

  return readJson<StudioSession>(response)
}

export function getFallbackSessionTitle(value: string) {
  const normalized = value.trim()

  return normalized.length > STUDIO_SESSION_TITLE_MAX_LENGTH
    ? normalized.slice(0, STUDIO_SESSION_TITLE_MAX_LENGTH)
    : normalized
}

export async function updateSessionChatPreferences(
  sessionId: string,
  preferences: {
    chatModel?: SupportedChatModel | null
    chatRuntimeId?: string | null
    chatReasoningEffort?: ChatReasoningEffort | null
  }
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  })

  return readJson<StudioSession>(response)
}

export async function updateSessionProject(
  sessionId: string,
  projectId: string | null
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  })

  return readJson<StudioSession>(response)
}

export async function updateSessionPermissionMode(
  sessionId: string,
  permissionMode: StudioPermissionMode
) {
  const response = await fetch(`/api/studio/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permissionMode }),
  })

  return readJson<StudioSession>(response)
}

export async function sendPermissionDecision(input: {
  sessionId: string
  requestId: string
  optionId: string
  feedback?: string
}) {
  const response = await fetch("/api/studio/chat/permission", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return readJson<{ resolved: boolean }>(response)
}

export async function sendUserInputDecision(input: {
  sessionId: string
  requestId: string
  answers: StudioUserInputAnswer[]
  cancelled?: boolean
}) {
  const response = await fetch("/api/studio/chat/user-input", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return readJson<{ resolved: boolean }>(response)
}

export async function listMessages(sessionId: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}/messages`)

  return readJson<StudioMessage[]>(response)
}

export async function submitStudioFeedback(input: {
  sessionId?: string
  targetMessageId: string | null
  entryPoint: "message_action" | "titlebar"
  description: string
  messages?: StudioMessage[]
  images: Array<{ name: string; mimeType: string; dataUrl: string }>
  locale: "en" | "zh"
}) {
  const response = await fetch("/api/studio/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return readJson<{ feedbackId: string; createdAt: string }>(response)
}

export async function createMessage(input: {
  sessionId: string
  role: StudioMessage["role"]
  content: string
  attachments?: StudioAttachment[]
  activities?: StudioMessageActivity[]
  parts?: StudioMessagePart[]
  reasoningContent?: string
  reasoningDurationMs?: number | null
  model?: string | null
  environment?: "local" | "remote" | null
  mentions?: PromptMention[]
  versionGroupId?: string | null
  replacesMessageId?: string | null
}) {
  const response = await fetch(
    `/api/studio/sessions/${input.sessionId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role: input.role,
        content: input.content,
        model: input.model ?? null,
        environment: input.environment ?? null,
        versionGroupId: input.versionGroupId ?? null,
        replacesMessageId: input.replacesMessageId ?? null,
        activities: input.activities ?? [],
        parts: input.parts ?? [],
        reasoningContent: input.reasoningContent ?? "",
        reasoningDurationMs: input.reasoningDurationMs ?? null,
        status: "complete",
        attachments: input.attachments ?? [],
        ...(input.mentions && input.mentions.length > 0
          ? { mentions: input.mentions }
          : {}),
      }),
    }
  )

  return readJson<StudioMessage>(response)
}

export async function listMessageVersions(
  sessionId: string,
  versionGroupId: string
) {
  const response = await fetch(
    `/api/studio/sessions/${sessionId}/messages?versionGroupId=${encodeURIComponent(
      versionGroupId
    )}`
  )

  return readJson<StudioMessage[]>(response)
}

export async function generateSessionTitle(sessionId: string, prompt: string) {
  const response = await fetch(`/api/studio/sessions/${sessionId}/title`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })

  return readJson<StudioSession>(response)
}

export async function startAssistantRunRequest({
  sessionId,
  model,
  reasoningEffort,
  runtimeId,
  environment,
  retryMessageId,
}: {
  sessionId: string
  model: SupportedChatModel
  reasoningEffort: ChatReasoningEffort
  runtimeId: string
  environment?: ChatRunEnvironment
  retryMessageId?: string
}) {
  const response = await fetch("/api/studio/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      model,
      reasoningEffort,
      runtimeId,
      environment,
      retryMessageId,
    }),
  })

  return readJson<StudioChatRunSnapshot>(response)
}

export async function stopAssistantRunRequest(sessionId: string) {
  const response = await fetch("/api/studio/chat", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  })

  return readJson<StudioChatRunSnapshot | null>(response)
}

export async function compactCodexDirectSessionRequest(sessionId: string) {
  const response = await fetch(
    `/api/studio/sessions/${encodeURIComponent(sessionId)}/compact`,
    {
      method: "POST",
    }
  )

  return readJson<{ usage: StudioTokenUsage | null }>(response)
}

export async function listInstalledSkillsForComposer() {
  const response = await fetch("/api/skills/installed", {
    cache: "no-store",
  })
  const payload = (await response.json()) as InstalledSkillsApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

export async function listInstalledMcpForComposer() {
  const response = await fetch("/api/mcp/installed", {
    cache: "no-store",
  })
  const payload = (await response.json()) as InstalledMcpServersApiResponse

  if (!response.ok || !payload.ok) {
    throw new Error((!payload.ok && payload.message) || "Request failed")
  }

  return payload.data
}

export async function listLocalExpertsForComposer() {
  const response = await fetch("/api/studio/experts/recent?limit=8", {
    cache: "no-store",
  })

  return readJson<ComposerSelectedExpert[]>(response)
}

export async function summonLocalExpertForComposer(
  expertId: string,
  prompt?: string
) {
  const response = await fetch(
    `/api/studio/experts/recent/${encodeURIComponent(expertId)}/summon`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: prompt?.trim() || "" }),
    }
  )

  return readJson<ExpertSummonData>(response)
}

export async function getSessionExpertForComposer(sessionId: string) {
  const response = await fetch(
    `/api/studio/sessions/${encodeURIComponent(sessionId)}/expert`,
    { cache: "no-store" }
  )

  return readJson<ComposerSelectedExpert | null>(response)
}

export async function clearSessionExpertForComposer(sessionId: string) {
  const response = await fetch(
    `/api/studio/sessions/${encodeURIComponent(sessionId)}/expert`,
    { method: "DELETE" }
  )

  return readJson<{ removed: boolean }>(response)
}
