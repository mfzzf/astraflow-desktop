import "server-only"

import {
  listAgentModelsForRuntime,
  resolveAgentModelForRuntime,
} from "@/lib/agent-model-settings"
import { AGENT_RUNTIME_IDS } from "@/lib/agent-model-settings-shared"
import { listCompShareAgentModelDefinitions } from "@/lib/compshare/entitlements"
import {
  DEFAULT_CHAT_MODEL,
  type ChatReasoningEffort,
} from "@/lib/chat-models"
import {
  getStudioSession,
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
  const runtimeId = AGENT_RUNTIME_IDS.includes(
    requestedRuntimeId as (typeof AGENT_RUNTIME_IDS)[number]
  )
    ? (requestedRuntimeId as (typeof AGENT_RUNTIME_IDS)[number])
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
export async function resolveMobileChannelPreferencesForInvocation(
  connection: MobilePreferenceSource
) {
  const preferences = resolveMobileChannelPreferences(connection)
  const compShareModels = await listCompShareAgentModelDefinitions()
  if (!compShareModels) {
    return preferences
  }

  const availableModels = compShareModels.filter(
    (model) =>
      model.enabled &&
      model.supportedRuntimeIds.some(
        (runtimeId) => runtimeId === preferences.runtimeId
      )
  )
  const requestedModel = connection.chatModel?.trim().toLowerCase()
  const selectedModel =
    availableModels.find(
      (model) =>
        model.id.toLowerCase() === requestedModel ||
        model.providerModel.toLowerCase() === requestedModel
    ) ??
    availableModels[0] ??
    null
  const configuredEffort = connection.reasoningEffort
  const reasoningEffort =
    configuredEffort &&
    selectedModel?.reasoningEfforts.includes(configuredEffort)
      ? configuredEffort
      : selectedModel?.defaultReasoningEffort

  return {
    ...preferences,
    model: selectedModel?.id ?? "",
    modelLabel: selectedModel?.label ?? "",
    reasoningEffort,
    availableModels,
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

  if (session.permissionMode !== connection.permissionMode) {
    session =
      updateStudioSessionPermissionMode(sessionId, connection.permissionMode) ??
      session
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
