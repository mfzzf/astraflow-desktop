import type { SessionInfo } from "@agentclientprotocol/sdk"

import { compactAstraFlowPiMessages } from "@/lib/agent/adapters/astraflow-runtime"
import "@/lib/agent/adapters/acp-runtimes"
import "@/lib/agent/adapters/claude-native-runtime"
import "@/lib/agent/adapters/codex-direct-runtime"
import "@/lib/agent/adapters/opencode-native-runtime"
import {
  activatePreparedAcpSession,
  getAcpSessionControlSnapshot,
  resetAcpSessionsForStudioSession,
  runAcpSessionControlAction,
} from "@/lib/agent/acp/acp-runtime"
import { deletePersistedAcpSession } from "@/lib/agent/acp/session-deletion"
import { continueAcpSessionInStudio } from "@/lib/agent/acp/session-continuation"
import {
  cancelAgentRun,
  getAgentRun,
  getAgentRunLiveSnapshot,
  startAgentRun,
  subscribeAgentRun,
  type StudioChatRunListener,
} from "@/lib/agent/run-orchestrator"
import {
  DEFAULT_AGENT_RUNTIME_ID,
  getAgentRuntime,
  type AgentRunEnvironment,
} from "@/lib/agent/runtime"
import {
  getRuntimeModelSetting,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import { createExpertRuntimeSystemPrompt } from "@/lib/agent/expert-runtime"
import type { AgentMessage, AgentMessageContent } from "@/lib/agent/messages"
import type {
  AgentContentBlock,
  AgentToolCallContent,
} from "@/lib/agent/structured-content"
import {
  parseLeadingSkillCommandNames,
  resolveStudioSkillInvocation,
} from "@/lib/agent/studio-skill-invocation"
import {
  DEFAULT_CHAT_REASONING_EFFORT,
  SUPPORTED_CHAT_REASONING_EFFORTS,
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"
import { resolveCompShareEntitledModel } from "@/lib/compshare/entitlements"
import {
  describeAttachmentForPrompt,
  materializeStudioSessionAttachmentsInSandboxWorkspace,
} from "@/lib/astraflow-session-sandbox"
import {
  countOtherStudioSessionsForAgentProviderSession,
  createStudioSession,
  deleteStudioSession,
  findStudioSessionIdByAgentProviderSession,
  getStudioLocalProject,
  getStudioSession,
  getStudioSessionAvailableCommands,
  getStudioSessionCompaction,
  getStudioSessionExpert,
  getLatestStudioAcpSessionSelection,
  getLatestStudioAgentProviderSessionId,
  listStudioMessages,
  listStudioInstalledSkills,
  listStudioMcpServers,
  recordStudioAgentProviderEvent,
  resetStudioSessionProviderResume,
  STUDIO_ACP_SESSION_SELECTED_EVENT,
  upsertStudioSessionCompaction,
  updateStudioMessageMentions,
} from "@/lib/studio-db"
import { getAgentRuntimeProviderMetadata } from "@/lib/agent/provider-metadata"
import type { StudioSessionCompaction } from "@/lib/studio-db/compactions"
import type { PromptMention } from "@/lib/agent/composer-types"
import {
  getSessionPromptContext,
  hasUnsnapshottedSessionPromptMentions,
  snapshotSessionPromptMentions,
  studioMessageTextForPrompt,
} from "@/lib/studio-session-prompt-context"
import { resolveStudioSessionWorkspacePath } from "@/lib/studio-session-workspace"
import { ensureStudioManagedWorkspace } from "@/lib/studio-managed-workspace"
import {
  formatLoadedSkillForModel,
  formatSkillRuntimeGuidanceForModel,
  listInstalledSkillFileStats,
} from "@/lib/studio-skills"
import {
  formatExpertDeclaredSkillForModel,
  listExpertDeclaredSkillsFromSnapshot,
} from "@/lib/studio-session-skills"
import {
  getStudioSessionWorkspaceExecutionContext,
  getStudioSessionWorkspaceExecutionTarget,
} from "@/lib/studio-workspace-context"
import type { StudioMessage, StudioMessagePart } from "@/lib/studio-types"

const ASSISTANT_STRUCTURED_CONTEXT_LIMIT = 6_000
const ASSISTANT_STRUCTURED_TEXT_LIMIT = 1_000

type AdapterPromptMention = Extract<PromptMention, { kind: "file" | "folder" }>

function getAdapterPromptMentions(message: StudioMessage) {
  return (message.mentions ?? []).filter(
    (mention): mention is AdapterPromptMention =>
      mention.kind === "file" || mention.kind === "folder"
  )
}

function messageMentions(message: StudioMessage) {
  const mentions = getAdapterPromptMentions(message)

  return mentions.length ? { mentions } : {}
}

function prependContextToMessageContent(
  content: string,
  context: string
): string
function prependContextToMessageContent(
  content: AgentMessageContent,
  context: string
): AgentMessageContent
function prependContextToMessageContent(
  content: AgentMessageContent,
  context: string
) {
  if (!context) {
    return content
  }

  if (typeof content === "string") {
    return [context, content]
      .filter((part) => part.trim().length > 0)
      .join("\n\n")
  }

  return [
    { type: "text", text: context },
    ...content,
  ] satisfies AgentMessageContent
}

function truncateAssistantContext(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim()

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength - 3)}...`
}

function approximateBase64Bytes(value: string) {
  return Math.max(0, Math.floor((value.length * 3) / 4))
}

function formatContentBlockForPrompt(content: AgentContentBlock): unknown {
  const extensions = {
    ...(content.annotations ? { annotations: content.annotations } : {}),
    ...(content._meta ? { _meta: content._meta } : {}),
  }

  if (content.type === "text") {
    return {
      type: "text",
      text: truncateAssistantContext(
        content.text,
        ASSISTANT_STRUCTURED_TEXT_LIMIT
      ),
      ...extensions,
    }
  }

  if (content.type === "image" || content.type === "audio") {
    return {
      type: content.type,
      mimeType: content.mimeType,
      dataBytes: approximateBase64Bytes(content.data),
      ...(content.type === "image" && content.uri ? { uri: content.uri } : {}),
      ...extensions,
    }
  }

  if (content.type === "resource_link") {
    return content
  }

  return {
    type: "resource",
    ...extensions,
    resource:
      "text" in content.resource
        ? {
            uri: content.resource.uri,
            mimeType: content.resource.mimeType ?? null,
            text: truncateAssistantContext(
              content.resource.text,
              ASSISTANT_STRUCTURED_TEXT_LIMIT
            ),
            ...(content.resource._meta
              ? { _meta: content.resource._meta }
              : {}),
          }
        : {
            uri: content.resource.uri,
            mimeType: content.resource.mimeType ?? null,
            dataBytes: approximateBase64Bytes(content.resource.blob),
            ...(content.resource._meta
              ? { _meta: content.resource._meta }
              : {}),
          },
  }
}

function formatToolCallContentForPrompt(content: AgentToolCallContent) {
  if (content.type === "content") {
    return {
      type: "content",
      content: formatContentBlockForPrompt(content.content),
      ...(content._meta ? { _meta: content._meta } : {}),
    }
  }

  if (content.type === "terminal") {
    return content
  }

  return {
    type: "diff",
    path: content.path,
    ...(content.oldText != null
      ? {
          oldText: truncateAssistantContext(
            content.oldText,
            ASSISTANT_STRUCTURED_TEXT_LIMIT
          ),
        }
      : {}),
    newText: truncateAssistantContext(
      content.newText,
      ASSISTANT_STRUCTURED_TEXT_LIMIT
    ),
    ...(content._meta ? { _meta: content._meta } : {}),
  }
}

function formatRawToolValue(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  const serialized =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value)
          } catch {
            return String(value)
          }
        })()

  return truncateAssistantContext(serialized, ASSISTANT_STRUCTURED_TEXT_LIMIT)
}

function formatStructuredPartForPrompt(part: StudioMessagePart) {
  if (part.type === "plan") {
    return {
      type: "plan",
      planId: part.planId ?? null,
      variant: part.variant ?? "items",
      ...(part.content
        ? {
            content: truncateAssistantContext(
              part.content,
              ASSISTANT_STRUCTURED_TEXT_LIMIT
            ),
          }
        : {}),
      ...(part.uri ? { uri: part.uri } : {}),
      todos: part.todos.map((todo) => ({
        text: todo.text,
        status: todo.status,
        ...(todo.priority ? { priority: todo.priority } : {}),
      })),
    }
  }

  if (part.type === "content") {
    return {
      type: "content",
      messageId: part.messageId ?? null,
      channel: part.channel ?? "message",
      content: formatContentBlockForPrompt(part.content),
    }
  }

  if (part.type === "tool") {
    const { activity } = part
    const rawInput = formatRawToolValue(activity.rawInput)
    const rawOutput = formatRawToolValue(activity.rawOutput)

    return {
      type: "tool_call",
      id: activity.id,
      toolName: activity.toolName,
      status: activity.status,
      ...(activity.title ? { title: activity.title } : {}),
      ...(activity.kind ? { kind: activity.kind } : {}),
      ...(activity.acpStatus ? { acpStatus: activity.acpStatus } : {}),
      ...(activity.locations?.length ? { locations: activity.locations } : {}),
      ...(activity.content?.length
        ? {
            content: activity.content.map(formatToolCallContentForPrompt),
          }
        : {}),
      ...(rawInput !== undefined ? { rawInput } : {}),
      ...(rawOutput !== undefined ? { rawOutput } : {}),
      ...(activity.meta ? { meta: activity.meta } : {}),
    }
  }

  if (part.type === "subagent") {
    return {
      type: "subagent",
      taskId: part.taskId,
      name: part.name,
      status: part.status,
      ...(part.providerThreadId
        ? { providerThreadId: part.providerThreadId }
        : {}),
      ...(part.providerParentThreadId
        ? { providerParentThreadId: part.providerParentThreadId }
        : {}),
      ...(part.agentId ? { agentId: part.agentId } : {}),
      ...(part.nickname ? { nickname: part.nickname } : {}),
      ...(part.role ? { role: part.role } : {}),
      ...(part.model ? { model: part.model } : {}),
      ...(part.effort ? { effort: part.effort } : {}),
      ...(typeof part.background === "boolean"
        ? { background: part.background }
        : {}),
      taskInput: truncateAssistantContext(
        part.taskInput,
        ASSISTANT_STRUCTURED_TEXT_LIMIT
      ),
      ...(part.summary
        ? {
            summary: truncateAssistantContext(
              part.summary,
              ASSISTANT_STRUCTURED_TEXT_LIMIT
            ),
          }
        : {}),
      ...(part.error ? { error: part.error } : {}),
      ...(part.todos.length
        ? {
            todos: part.todos.map((todo) => ({
              text: todo.text,
              status: todo.status,
            })),
          }
        : {}),
    }
  }

  if (part.type === "file") {
    return {
      type: "file_change",
      path: part.path,
      kind: part.kind,
      status: part.status,
      ...(part.error ? { error: part.error } : {}),
    }
  }

  if (part.type === "media_generation") {
    return {
      type: "media_generation",
      kind: part.kind,
      generationId: part.generationId,
      status: part.status,
      modelName: part.modelName,
      prompt: truncateAssistantContext(
        part.prompt,
        ASSISTANT_STRUCTURED_TEXT_LIMIT
      ),
      ...(part.phase ? { phase: part.phase } : {}),
      ...(typeof part.progress === "number" ? { progress: part.progress } : {}),
      ...(part.errorMessage ? { errorMessage: part.errorMessage } : {}),
      outputs: part.outputs.map((output) => ({
        id: output.id,
        index: output.index,
        sessionFileId: output.sessionFileId ?? null,
        contentUrl: output.contentUrl,
        url: output.url,
        storagePath: output.storagePath,
        mimeType: output.mimeType,
        width: output.width,
        height: output.height,
        ...(output.durationSeconds !== undefined
          ? { durationSeconds: output.durationSeconds }
          : {}),
      })),
    }
  }

  return null
}

function formatAssistantStructuredContext(message: StudioMessage) {
  const structured = message.parts
    .map(formatStructuredPartForPrompt)
    .filter((part): part is NonNullable<typeof part> => Boolean(part))

  if (!structured.length) {
    return ""
  }

  const content = JSON.stringify(
    {
      note: "Structured assistant context from previous turn. Use ids/paths here when the user references prior outputs.",
      parts: structured,
    },
    null,
    2
  )

  return `<assistant_structured_context>\n${truncateAssistantContext(
    content,
    ASSISTANT_STRUCTURED_CONTEXT_LIMIT
  )}\n</assistant_structured_context>`
}

function assistantContentForPrompt(message: StudioMessage) {
  return [
    studioMessageTextForPrompt(message),
    formatAssistantStructuredContext(message),
  ]
    .filter((part) => part.trim().length > 0)
    .join("\n\n")
}

function resolveStudioSessionSkillInvocation({
  content,
  environment,
  sessionId,
}: {
  content: string
  environment: AgentRunEnvironment
  sessionId: string
}) {
  const commandNames = parseLeadingSkillCommandNames(content)

  if (commandNames.length === 0) {
    return null
  }

  const runtimeCommandNames = new Set(
    getStudioSessionAvailableCommands(sessionId).map((command) =>
      command.name.toLowerCase()
    )
  )

  if (runtimeCommandNames.has(commandNames[0].toLowerCase())) {
    return null
  }

  const installedSkills = listStudioInstalledSkills({
    enabledOnly: true,
  })
  const expertSkills = listExpertDeclaredSkillsFromSnapshot(
    getStudioSessionExpert(sessionId)?.snapshot ?? null
  )
  const candidates = []

  for (const commandName of commandNames) {
    const normalizedCommandName = commandName.toLowerCase()

    if (runtimeCommandNames.has(normalizedCommandName)) {
      break
    }

    const installedSkill = installedSkills.find(
      (skill) => skill.slug.toLowerCase() === normalizedCommandName
    )
    const expertSkill = expertSkills.find(
      (skill) => skill.slug.toLowerCase() === normalizedCommandName
    )

    if (!installedSkill && !expertSkill) {
      break
    }

    let loadedContent = ""

    if (expertSkill) {
      loadedContent = formatExpertDeclaredSkillForModel(expertSkill)
    } else if (installedSkill) {
      let files: ReturnType<typeof listInstalledSkillFileStats> = []

      try {
        files = listInstalledSkillFileStats(installedSkill.installPath)
      } catch {
        // Keep SKILL.md usable even when an optional bundled file is missing.
      }

      loadedContent = formatLoadedSkillForModel({
        capabilities: {
          fileAccess: "read_skill_file",
          sandbox: "unavailable",
        },
        files,
        runtimeGuidance: formatSkillRuntimeGuidanceForModel({
          environment,
          platform: process.platform,
          slug: installedSkill.slug,
        }),
        skill: installedSkill,
      })
    }

    candidates.push({ slug: commandName, loadedContent })
  }

  return resolveStudioSkillInvocation({
    candidates,
    content,
  })
}

export function applyStudioRuntimeContextToLatestUserMessage({
  environment,
  history,
  sessionId,
}: {
  environment: AgentRunEnvironment
  history: StudioMessage[]
  sessionId: string
}) {
  const latestUserIndex = history.findLastIndex(
    (message) => message.role === "user"
  )

  if (latestUserIndex < 0) {
    return history
  }

  const latestUserMessage = history[latestUserIndex]
  const skillInvocation = resolveStudioSessionSkillInvocation({
    content: latestUserMessage.content,
    environment,
    sessionId,
  })
  const expertPrompt = createExpertRuntimeSystemPrompt(
    getStudioSessionExpert(sessionId)?.snapshot ?? null,
    {
      availableMcpServers: listStudioMcpServers({ enabledOnly: true }).flatMap(
        (server) => [server.id, server.name, server.title]
      ),
    }
  )
  const runtimeOwnsExpertPrompt =
    (getStudioSession(sessionId)?.chatRuntimeId || DEFAULT_AGENT_RUNTIME_ID) ===
    "astraflow"
  const contextualExpertPrompt = runtimeOwnsExpertPrompt ? "" : expertPrompt

  if (!skillInvocation && !contextualExpertPrompt) {
    return history
  }

  // Unmatched slash commands belong to the selected runtime and must remain
  // the first prompt token so the runtime can dispatch them itself.
  if (
    !skillInvocation &&
    latestUserMessage.content.trimStart().startsWith("/")
  ) {
    return history
  }

  const content = [
    contextualExpertPrompt,
    skillInvocation?.prompt ?? latestUserMessage.content,
  ]
    .filter(Boolean)
    .join("\n\n")
  const nextHistory = [...history]

  nextHistory[latestUserIndex] = {
    ...latestUserMessage,
    content,
  }

  return nextHistory
}

export function applyStudioSessionCompaction(
  history: StudioMessage[],
  compaction: StudioSessionCompaction | null
) {
  if (!compaction || compaction.runtimeId !== "astraflow") {
    return { history, summary: null }
  }

  const firstKeptIndex = history.findIndex(
    (message) => message.id === compaction.firstKeptMessageId
  )
  const throughIndex = history.findIndex(
    (message) => message.id === compaction.throughMessageId
  )

  if (
    firstKeptIndex <= 0 ||
    throughIndex < firstKeptIndex ||
    !compaction.summary.trim()
  ) {
    return { history, summary: null }
  }

  return {
    history: history.slice(firstKeptIndex),
    summary: compaction.summary.trim(),
  }
}

export function convertStudioMessagesToAgentMessages(
  history: StudioMessage[]
): AgentMessage[] {
  return history.map((message) => {
    const referencedSessionContext =
      message.role === "user" ? getSessionPromptContext(message.mentions) : ""

    if (message.role === "user" && message.attachments.length > 0) {
      const parts: Exclude<AgentMessageContent, string> = []

      if (message.content) {
        parts.push({ type: "text", text: message.content })
      }

      for (const attachment of message.attachments) {
        if (attachment.type === "image" && attachment.dataUrl) {
          parts.push({
            type: "image_url",
            image_url: { url: attachment.dataUrl },
          })
        }

        parts.push({
          type: "text",
          text: describeAttachmentForPrompt(attachment),
        })
      }

      return {
        id: message.id,
        role: "user",
        content: referencedSessionContext
          ? prependContextToMessageContent(parts, referencedSessionContext)
          : parts,
        ...messageMentions(message),
      }
    }

    if (message.role === "user") {
      return {
        id: message.id,
        role: "user",
        content: referencedSessionContext
          ? prependContextToMessageContent(
              message.content,
              referencedSessionContext
            )
          : message.content,
        ...messageMentions(message),
      }
    }

    return {
      id: message.id,
      role: "assistant",
      content: assistantContentForPrompt(message),
    }
  })
}

function toAgentMessages(
  sessionId: string,
  retryMessageId: string | undefined,
  runtimeId: string,
  environment: AgentRunEnvironment
): AgentMessage[] {
  const history = listStudioMessages(sessionId)
  const retryMessageIndex = retryMessageId
    ? history.findIndex((message) => message.id === retryMessageId)
    : -1
  const effectiveHistory =
    retryMessageIndex >= 0 ? history.slice(0, retryMessageIndex) : history
  const compacted = applyStudioSessionCompaction(
    effectiveHistory,
    runtimeId === "astraflow" ? getStudioSessionCompaction(sessionId) : null
  )
  const snapshottedHistory = compacted.history.map((message) => {
    if (
      message.role !== "user" ||
      !hasUnsnapshottedSessionPromptMentions(message.mentions)
    ) {
      return message
    }

    const mentions = snapshotSessionPromptMentions({
      currentSessionId: sessionId,
      mentions: message.mentions ?? [],
    })

    updateStudioMessageMentions(message.id, mentions)

    return { ...message, mentions }
  })

  const converted = convertStudioMessagesToAgentMessages(
    applyStudioRuntimeContextToLatestUserMessage({
      environment,
      history: snapshottedHistory,
      sessionId,
    })
  )

  if (!compacted.summary) {
    return converted
  }

  return [
    {
      id: `compaction:${sessionId}`,
      role: "user",
      content: [
        "The following is a system-generated summary of earlier conversation context. Treat it as prior context, not as a new user request.",
        `<conversation_summary>\n${compacted.summary}\n</conversation_summary>`,
      ].join("\n\n"),
    },
    ...converted,
  ]
}

export function getStudioChatRun(sessionId: string) {
  return getAgentRun(sessionId)
}

export function cancelStudioChatRun(sessionId: string) {
  return cancelAgentRun(sessionId)
}

export function getStudioChatRunLiveSnapshot(sessionId: string) {
  return getAgentRunLiveSnapshot(sessionId)
}

export function subscribeStudioChatRun(
  sessionId: string,
  listener: StudioChatRunListener
) {
  return subscribeAgentRun(sessionId, listener)
}

export async function prepareStudioAcpRuntime(
  sessionId: string,
  runtimeId: string
) {
  let session = getStudioSession(sessionId)

  if (!session) {
    throw new Error("Session not found")
  }

  if (!session.workspaceId) {
    ensureStudioManagedWorkspace(sessionId)
    session = getStudioSession(sessionId)

    if (!session) {
      throw new Error("Session not found")
    }
  }

  const runtime = getAgentRuntime(runtimeId)

  if (!runtime?.prepareRun) {
    throw new Error(`Runtime ${runtimeId} does not support ACP preparation.`)
  }

  const runtimeSetting = getRuntimeModelSetting(runtime.info.id)
  const entitledModel = await resolveCompShareEntitledModel(
    session.chatModel ?? ""
  )
  const resolvedModel =
    runtimeSetting?.useLocalSettings === false
      ? resolveAgentModelForRuntime({
          modelId: entitledModel,
          runtimeId: runtime.info.id,
        })
      : null
  const effectiveModel = resolvedModel?.id ?? entitledModel

  if (runtimeSetting?.useLocalSettings === false && !resolvedModel) {
    throw new Error(
      `No Modelverse model is configured for ${runtime.info.label}.`
    )
  }

  const workspaceTarget = getStudioSessionWorkspaceExecutionTarget(sessionId)
  const reasoningEffort = SUPPORTED_CHAT_REASONING_EFFORTS.includes(
    session.chatReasoningEffort as ChatReasoningEffort
  )
    ? (session.chatReasoningEffort as ChatReasoningEffort)
    : DEFAULT_CHAT_REASONING_EFFORT
  const selectedAgentSession = getLatestStudioAcpSessionSelection(
    sessionId,
    runtime.info.id
  )

  if (
    workspaceTarget.environment === "remote" &&
    (!workspaceTarget.workspaceId || !workspaceTarget.workspaceRoot)
  ) {
    throw new Error("Remote Agent runs require an explicit Sandbox workspace.")
  }

  await runtime.prepareRun({
    sessionId,
    messages: [],
    model: effectiveModel,
    permissionMode: session.permissionMode,
    agentWorkspaceRoot:
      workspaceTarget.context === null ? selectedAgentSession?.cwd : null,
    projectPath: resolveSessionProjectPath(sessionId),
    workspaceId: workspaceTarget.workspaceId,
    workspaceRoot: workspaceTarget.workspaceRoot,
    environment: workspaceTarget.environment,
    reasoningEffort,
    runtimeSessionRef: getLatestStudioAgentProviderSessionId(
      sessionId,
      runtime.info.id
    ),
    strictRuntimeSessionRef: Boolean(selectedAgentSession),
    signal: new AbortController().signal,
  })
}

export async function deleteStudioAcpAgentSession(sessionId: string) {
  const session = getStudioSession(sessionId)

  if (!session) {
    throw new Error("Session not found")
  }

  const runtimeId = session.chatRuntimeId || DEFAULT_AGENT_RUNTIME_ID
  const runtime = getAgentRuntime(runtimeId)

  if (!runtime?.prepareRun) {
    return { deleted: false, reason: "not_acp" as const }
  }

  const storedAgentSessionId = getLatestStudioAgentProviderSessionId(
    sessionId,
    runtimeId
  )

  if (
    storedAgentSessionId &&
    countOtherStudioSessionsForAgentProviderSession(
      runtimeId,
      storedAgentSessionId,
      sessionId
    ) > 0
  ) {
    return { deleted: false, reason: "still_referenced" as const }
  }

  return deletePersistedAcpSession({
    storedAgentSessionId,
    getSnapshot: () => getAcpSessionControlSnapshot(sessionId, runtimeId),
    prepare: () => prepareStudioAcpRuntime(sessionId, runtimeId),
    deleteSession: async (agentSessionId) => {
      await runAcpSessionControlAction({
        action: { action: "delete_session", sessionId: agentSessionId },
        runtimeId,
        studioSessionId: sessionId,
      })
    },
  })
}

export async function continueStudioAcpAgentSession({
  agentSession,
  runtimeId,
  sourceStudioSessionId,
}: {
  agentSession: SessionInfo
  runtimeId: string
  sourceStudioSessionId: string
}) {
  const sourceSession = getStudioSession(sourceStudioSessionId)

  if (!sourceSession || sourceSession.mode !== "chat") {
    throw new Error("The source Studio chat was not found.")
  }

  const snapshot = getAcpSessionControlSnapshot(
    sourceStudioSessionId,
    runtimeId
  )

  if (!snapshot?.session.canResume) {
    throw new Error("The ACP agent does not advertise session continuation.")
  }

  const sourceSelection = getLatestStudioAcpSessionSelection(
    sourceStudioSessionId,
    runtimeId
  )
  const metadata = getAgentRuntimeProviderMetadata(runtimeId)

  const result = continueAcpSessionInStudio({
    activeWorkspace: snapshot.workspace,
    agentSession,
    runtimeId,
    sourceSession,
    findExistingSession: () => {
      const existingId = findStudioSessionIdByAgentProviderSession(
        runtimeId,
        agentSession.sessionId
      )

      return existingId ? getStudioSession(existingId) : null
    },
    createSession: createStudioSession,
    deleteCreatedSession: deleteStudioSession,
    recordSelection: (session) => {
      recordStudioAgentProviderEvent({
        sessionId: session.id,
        runtimeId,
        provider: metadata?.provider ?? runtimeId,
        direction: "internal",
        eventType: STUDIO_ACP_SESSION_SELECTED_EVENT,
        providerSessionId: agentSession.sessionId,
        schemaVersion: metadata?.schemaVersion ?? null,
        packageVersion: metadata?.packageVersion ?? null,
        payload: {
          cwd: agentSession.cwd,
          additionalDirectories: agentSession.additionalDirectories ?? [],
          sourceStudioSessionId,
          stateOwnerStudioSessionId:
            sourceSelection?.stateOwnerStudioSessionId ?? sourceStudioSessionId,
          title: agentSession.title ?? null,
          updatedAt: agentSession.updatedAt ?? null,
          transcriptImport: "state-only",
        },
      })
    },
  })

  try {
    await prepareStudioAcpRuntime(result.session.id, runtimeId)
    await activatePreparedAcpSession(result.session.id, runtimeId)
    return result
  } catch (error) {
    if (!result.reused) {
      resetAcpSessionsForStudioSession(result.session.id)
      deleteStudioSession(result.session.id)
    }

    throw error
  }
}

export async function compactStudioAstraFlowSession(
  sessionId: string,
  customInstructions?: string
) {
  const session = getStudioSession(sessionId)

  if (!session) {
    throw new Error("Session not found")
  }

  if (session.isRunning) {
    throw new Error("Wait for the active run to finish before compacting.")
  }

  const entitledModel = await resolveCompShareEntitledModel(
    session.chatModel ?? ""
  )
  const resolvedModel = resolveAgentModelForRuntime({
    modelId: entitledModel,
    runtimeId: "astraflow",
  })

  if (!resolvedModel) {
    throw new Error("No Modelverse model is configured for AstraFlow Agent.")
  }

  const reasoningEffort = SUPPORTED_CHAT_REASONING_EFFORTS.includes(
    session.chatReasoningEffort as ChatReasoningEffort
  )
    ? (session.chatReasoningEffort as ChatReasoningEffort)
    : DEFAULT_CHAT_REASONING_EFFORT
  const messages = convertStudioMessagesToAgentMessages(
    listStudioMessages(sessionId)
  )
  const result = await compactAstraFlowPiMessages({
    customInstructions,
    messages,
    model: resolvedModel.id,
    reasoningEffort,
    sessionId,
  })

  const compaction = upsertStudioSessionCompaction({
    sessionId,
    runtimeId: "astraflow",
    summary: result.summary,
    firstKeptMessageId: result.firstKeptMessageId,
    throughMessageId: result.throughMessageId,
    tokensBefore: result.tokensBefore,
    estimatedTokensAfter: result.estimatedTokensAfter,
  })

  resetStudioSessionProviderResume(sessionId)
  resetAcpSessionsForStudioSession(sessionId)

  return compaction
}

function resolveSessionProjectPath(sessionId: string) {
  const context = getStudioSessionWorkspaceExecutionContext(sessionId)

  if (!context || context.workspace.type !== "local") {
    return null
  }

  if (context.workspace.origin !== "selected_local") {
    return context.workspace.rootPath
  }

  const project = getStudioLocalProject(context.workspace.localProjectId)

  return resolveStudioSessionWorkspacePath({
    project,
    projectId: context.workspace.localProjectId,
    sessionId,
  })
}

export async function startStudioChatRun({
  environment,
  model,
  reasoningEffort,
  retryMessageId,
  runtimeId = DEFAULT_AGENT_RUNTIME_ID,
  sessionId,
}: {
  environment?: AgentRunEnvironment
  model: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
  retryMessageId?: string
  runtimeId?: string
  sessionId: string
}) {
  let session = getStudioSession(sessionId)

  if (!session) {
    throw new Error("Session not found")
  }

  if (!session.workspaceId) {
    ensureStudioManagedWorkspace(sessionId)
    session = getStudioSession(sessionId)

    if (!session) {
      throw new Error("Session not found")
    }
  }

  const workspaceTarget = getStudioSessionWorkspaceExecutionTarget(sessionId)
  const workspaceContext = workspaceTarget.context
  const workspaceEnvironment: AgentRunEnvironment = workspaceTarget.environment

  if (environment && environment !== workspaceEnvironment) {
    const executionScope = workspaceContext
      ? `Workspace type ${workspaceContext.type}`
      : "A session without a workspace"

    throw new Error(
      `${executionScope} requires ${workspaceEnvironment} execution.`
    )
  }

  const runtime = getAgentRuntime(runtimeId)

  if (!runtime) {
    throw new Error(`Agent runtime not found: ${runtimeId}`)
  }

  const runtimeSetting = getRuntimeModelSetting(runtime.info.id)
  const entitledModel = await resolveCompShareEntitledModel(model)
  const resolvedModel =
    runtimeSetting?.useLocalSettings === false
      ? resolveAgentModelForRuntime({
          modelId: entitledModel,
          runtimeId: runtime.info.id,
        })
      : null
  const effectiveModel = resolvedModel?.id ?? entitledModel
  const selectedAgentSession = getLatestStudioAcpSessionSelection(
    sessionId,
    runtime.info.id
  )

  if (runtimeSetting?.useLocalSettings === false && !resolvedModel) {
    throw new Error(
      `No Modelverse model is configured for ${runtime.info.label}.`
    )
  }

  if (workspaceEnvironment === "remote") {
    if (!workspaceTarget.workspaceId || !workspaceTarget.workspaceRoot) {
      throw new Error(
        "Remote Agent runs require an explicit Sandbox workspace."
      )
    }

    await materializeStudioSessionAttachmentsInSandboxWorkspace({
      sessionId,
      workspaceId: workspaceTarget.workspaceId,
      workspaceRoot: workspaceTarget.workspaceRoot,
    })
  }

  return startAgentRun({
    createMessages: () =>
      toAgentMessages(
        sessionId,
        retryMessageId,
        runtime.info.id,
        workspaceEnvironment
      ),
    environment: workspaceEnvironment,
    model: effectiveModel,
    permissionMode: session.permissionMode,
    agentWorkspaceRoot:
      workspaceContext === null ? selectedAgentSession?.cwd : null,
    projectPath: resolveSessionProjectPath(sessionId),
    workspaceId: workspaceTarget.workspaceId,
    workspaceRoot: workspaceTarget.workspaceRoot,
    reasoningEffort,
    retryMessageId,
    runtime,
    sessionId,
  })
}
