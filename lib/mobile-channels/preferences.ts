import "server-only"

import {
  listAgentModelsForRuntime,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import { isPublicAgentRuntimeId } from "@/lib/agent-model-settings-shared"
import { DEFAULT_CHAT_MODEL, type ChatReasoningEffort } from "@/lib/chat-models"
import {
  getStudioSession,
  getStudioSessionWorkspace,
  updateStudioSessionChatPreferences,
  updateStudioSessionPermissionMode,
  updateStudioSessionProject,
} from "@/lib/studio-db"

import { listMobileChannelBindingsForConnection } from "./store"
import type {
  MobileChannelConnection,
  MobileChannelConnectionRecord,
} from "./types"

export const DEFAULT_MOBILE_AGENT_RUNTIME_ID = "astraflow"

export class MobileChannelRemoteFullAccessConflictError extends Error {
  constructor() {
    super(
      "Mobile channels cannot take over a remote Sandbox task while it is in Full Access. Switch the task to Default in AstraFlow Desktop first."
    )
    this.name = "MobileChannelRemoteFullAccessConflictError"
  }
}

type MobilePreferenceSource = Pick<
  MobileChannelConnection | MobileChannelConnectionRecord,
  | "agentRuntimeId"
  | "chatModel"
  | "reasoningEffort"
  | "permissionMode"
  | "defaultProjectId"
>

export function resolveMobileChannelPreferences(
  connection: MobilePreferenceSource
) {
  const requestedRuntimeId = connection.agentRuntimeId?.trim()
  const runtimeId =
    requestedRuntimeId && isPublicAgentRuntimeId(requestedRuntimeId)
      ? requestedRuntimeId
      : DEFAULT_MOBILE_AGENT_RUNTIME_ID
  const resolvedModel = resolveAgentModelForRuntime({
    modelId: connection.chatModel,
    runtimeId,
  })
  const model =
    resolvedModel?.id || connection.chatModel?.trim() || DEFAULT_CHAT_MODEL
  const configuredEffort = connection.reasoningEffort
  const reasoningEffort: ChatReasoningEffort | undefined =
    configuredEffort &&
    resolvedModel?.reasoningEfforts.includes(configuredEffort)
      ? configuredEffort
      : resolvedModel?.defaultReasoningEffort

  return {
    runtimeId,
    model,
    modelLabel: resolvedModel?.label || model,
    reasoningEffort,
    availableModels: listAgentModelsForRuntime(runtimeId),
  }
}

export function syncMobileChannelConnectionToSession(
  connection: MobilePreferenceSource,
  sessionId: string
) {
  let session = getStudioSession(sessionId)
  if (!session) {
    return null
  }

  const currentWorkspace = getStudioSessionWorkspace(sessionId)

  if (
    session.permissionMode === "full_access" &&
    currentWorkspace?.type === "sandbox"
  ) {
    throw new MobileChannelRemoteFullAccessConflictError()
  }

  const preferences = resolveMobileChannelPreferences(connection)
  if (
    session.chatRuntimeId !== preferences.runtimeId ||
    session.chatModel !== preferences.model ||
    session.chatReasoningEffort !== (preferences.reasoningEffort ?? null)
  ) {
    session =
      updateStudioSessionChatPreferences(sessionId, {
        chatRuntimeId: preferences.runtimeId,
        chatModel: preferences.model,
        chatReasoningEffort: preferences.reasoningEffort ?? null,
      }) ?? session
  }

  // A background/mobile channel cannot provide the trusted desktop gesture
  // required to change a task's execution authority.
  const permissionMode = "default"

  if (session.permissionMode !== permissionMode) {
    session =
      updateStudioSessionPermissionMode(sessionId, permissionMode) ?? session
  }

  if (session.projectId !== connection.defaultProjectId) {
    session =
      updateStudioSessionProject(sessionId, connection.defaultProjectId) ??
      session
  }

  return session
}

export function syncMobileChannelConnectionToBoundSessions(
  connectionId: string,
  connection: MobilePreferenceSource
) {
  const sessionIds = new Set(
    listMobileChannelBindingsForConnection(connectionId)
      .map((binding) => binding.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId))
  )

  return Array.from(sessionIds, (sessionId) =>
    syncMobileChannelConnectionToSession(connection, sessionId)
  ).filter(Boolean)
}
