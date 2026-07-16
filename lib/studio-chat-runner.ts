import { compactAstraFlowPiMessages } from "@/lib/agent/adapters/astraflow-runtime"
import "@/lib/agent/adapters/acp-runtimes"
import "@/lib/agent/adapters/claude-native-runtime"
import "@/lib/agent/adapters/codex-direct-runtime"
import "@/lib/agent/adapters/opencode-native-runtime"
import { resetAcpSessionsForStudioSession } from "@/lib/agent/acp/acp-runtime"
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
import {
  DEFAULT_CHAT_REASONING_EFFORT,
  SUPPORTED_CHAT_REASONING_EFFORTS,
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"
import {
  describeAttachmentForPrompt,
  materializeStudioSessionAttachmentsInSandboxWorkspace,
} from "@/lib/astraflow-session-sandbox"
import {
  getStudioLocalProject,
  getStudioSession,
  getStudioSessionCompaction,
  listStudioMessages,
  resetStudioSessionProviderResume,
  upsertStudioSessionCompaction,
  updateStudioMessageMentions,
} from "@/lib/studio-db"
import type { StudioSessionCompaction } from "@/lib/studio-db/compactions"
import type { PromptMention } from "@/lib/agent/composer-types"
import type {
  AgentMessage,
  AgentMessageContent,
} from "@/lib/agent/messages"
import {
  getSessionPromptContext,
  hasUnsnapshottedSessionPromptMentions,
  snapshotSessionPromptMentions,
  studioMessageTextForPrompt,
} from "@/lib/studio-session-prompt-context"
import { resolveStudioSessionWorkspacePath } from "@/lib/studio-session-workspace"
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

function formatStructuredPartForPrompt(part: StudioMessagePart) {
  if (part.type === "plan") {
    return {
      type: "plan",
      todos: part.todos.map((todo) => ({
        text: todo.text,
        status: todo.status,
        ...(todo.priority ? { priority: todo.priority } : {}),
      })),
    }
  }

  if (part.type === "subagent") {
    return {
      type: "subagent",
      taskId: part.taskId,
      name: part.name,
      status: part.status,
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
  runtimeId: string
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

  const converted = convertStudioMessagesToAgentMessages(snapshottedHistory)

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

  const resolvedModel = resolveAgentModelForRuntime({
    modelId: session.chatModel,
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
  const session = getStudioSession(sessionId)

  if (!session) {
    throw new Error("Session not found")
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
  const resolvedModel =
    runtimeSetting?.useLocalSettings === false
      ? resolveAgentModelForRuntime({
          modelId: model,
          runtimeId: runtime.info.id,
        })
      : null
  const effectiveModel = resolvedModel?.id ?? model

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
      toAgentMessages(sessionId, retryMessageId, runtime.info.id),
    environment: workspaceEnvironment,
    model: effectiveModel,
    permissionMode: session.permissionMode,
    projectPath: resolveSessionProjectPath(sessionId),
    workspaceId: workspaceTarget.workspaceId,
    workspaceRoot: workspaceTarget.workspaceRoot,
    reasoningEffort,
    retryMessageId,
    runtime,
    sessionId,
  })
}
