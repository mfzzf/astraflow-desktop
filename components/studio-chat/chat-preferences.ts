"use client"

import * as React from "react"

import {
  isSelectableAgentRuntimeId,
  type AgentModelDefinition,
  type AgentModelSettingsPayload,
} from "@/lib/agent-model-settings-shared"
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"
import {
  CHAT_MODEL_OPTIONS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_REASONING_EFFORT,
  getChatReasoningEfforts,
  getDefaultChatReasoningEffort,
  isChatReasoningEffort,
  isChatReasoningEffortSupported,
  resolveChatReasoningEffort,
  type ChatReasoningEffort,
  type SupportedChatModel,
} from "@/lib/chat-models"

import {
  CHAT_DEFAULTS_STORAGE_KEY,
  CHAT_ENVIRONMENT_STORAGE_KEY,
  CHAT_MODEL_STORAGE_KEY,
  CHAT_REASONING_EFFORT_STORAGE_KEY,
  CHAT_RUNTIME_STORAGE_KEY,
  DEFAULT_CHAT_ENVIRONMENT,
  DEFAULT_CHAT_RUNTIME_ID,
  FALLBACK_CHAT_RUNTIME_INFO,
} from "./constants"
import type {
  ChatPreferenceRecord,
  ChatRunEnvironment,
  ChatRuntimeOption,
  ResolvedChatPreferences,
  StoredChatDefaults,
} from "./types"

export type SessionChatPreferencesSnapshot = {
  sessionId: string
  preferences: ChatPreferenceRecord | null
}

export type ChatRuntimeCatalogStatus = "loading" | "ready" | "error"

export function canSynchronizeChatPreferences({
  chatDefaultsHydrated,
  runtimeCatalogStatus,
  sessionId,
  sessionPreferences,
}: {
  chatDefaultsHydrated: boolean
  runtimeCatalogStatus: ChatRuntimeCatalogStatus
  sessionId: string
  sessionPreferences: ChatPreferenceRecord | null | undefined
}) {
  return (
    chatDefaultsHydrated &&
    runtimeCatalogStatus === "ready" &&
    (!sessionId || sessionPreferences !== undefined)
  )
}

const chatModelListeners = new Set<() => void>()
const chatRuntimeListeners = new Set<() => void>()
const chatEnvironmentListeners = new Set<() => void>()
const chatReasoningEffortListeners = new Set<() => void>()
const chatDefaultsListeners = new Set<() => void>()

export function getStoredChatModel(): SupportedChatModel {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_MODEL
  }

  const stored = window.localStorage.getItem(CHAT_MODEL_STORAGE_KEY)

  if (stored?.trim()) {
    return stored.trim()
  }

  return DEFAULT_CHAT_MODEL
}

export function setStoredChatModel(model: SupportedChatModel) {
  window.localStorage.setItem(CHAT_MODEL_STORAGE_KEY, model)
  chatModelListeners.forEach((listener) => listener())
}

export function subscribeChatModel(listener: () => void) {
  chatModelListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatModelListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

// Read the persisted model through an external store so SSR and the first
// client render agree (DEFAULT), then sync to localStorage after hydration
// without a mismatch warning.
export function useChatModel() {
  const model = React.useSyncExternalStore(
    subscribeChatModel,
    getStoredChatModel,
    () => DEFAULT_CHAT_MODEL
  )

  return [model, setStoredChatModel] as const
}

export function getStoredChatRuntime() {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_RUNTIME_ID
  }

  const stored = window.localStorage.getItem(CHAT_RUNTIME_STORAGE_KEY)?.trim()

  return stored || DEFAULT_CHAT_RUNTIME_ID
}

export function setStoredChatRuntime(runtimeId: string) {
  window.localStorage.setItem(CHAT_RUNTIME_STORAGE_KEY, runtimeId)
  chatRuntimeListeners.forEach((listener) => listener())
}

export function subscribeChatRuntime(listener: () => void) {
  chatRuntimeListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatRuntimeListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function useChatRuntime() {
  const runtimeId = React.useSyncExternalStore(
    subscribeChatRuntime,
    getStoredChatRuntime,
    () => DEFAULT_CHAT_RUNTIME_ID
  )

  return [runtimeId, setStoredChatRuntime] as const
}

export function getStoredChatEnvironment(): ChatRunEnvironment {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_ENVIRONMENT
  }

  const stored = window.localStorage.getItem(CHAT_ENVIRONMENT_STORAGE_KEY)

  return stored === "remote" || stored === "local"
    ? stored
    : DEFAULT_CHAT_ENVIRONMENT
}

export function setStoredChatEnvironment(environment: ChatRunEnvironment) {
  window.localStorage.setItem(CHAT_ENVIRONMENT_STORAGE_KEY, environment)
  chatEnvironmentListeners.forEach((listener) => listener())
}

export function subscribeChatEnvironment(listener: () => void) {
  chatEnvironmentListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatEnvironmentListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function useChatEnvironment() {
  const environment = React.useSyncExternalStore(
    subscribeChatEnvironment,
    getStoredChatEnvironment,
    () => DEFAULT_CHAT_ENVIRONMENT
  )

  return [environment, setStoredChatEnvironment] as const
}

export function getStoredChatReasoningEffort(
  model: SupportedChatModel
): ChatReasoningEffort {
  if (typeof window === "undefined") {
    return getDefaultChatReasoningEffort(model)
  }

  const stored = window.localStorage.getItem(CHAT_REASONING_EFFORT_STORAGE_KEY)

  if (
    stored &&
    isChatReasoningEffort(stored) &&
    isChatReasoningEffortSupported(model, stored)
  ) {
    return stored
  }

  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<
        Record<SupportedChatModel, string>
      >
      const effort = parsed[model]

      if (
        effort &&
        isChatReasoningEffort(effort) &&
        isChatReasoningEffortSupported(model, effort)
      ) {
        return effort
      }
    } catch {
      // Ignore legacy or malformed storage and fall back to model defaults.
    }
  }

  return getDefaultChatReasoningEffort(model)
}

export function getStoredChatReasoningEffortMap() {
  const stored = window.localStorage.getItem(CHAT_REASONING_EFFORT_STORAGE_KEY)

  if (!stored || isChatReasoningEffort(stored)) {
    return {}
  }

  try {
    return JSON.parse(stored) as Partial<
      Record<SupportedChatModel, ChatReasoningEffort>
    >
  } catch {
    return {}
  }
}

export function setStoredChatReasoningEffort(
  model: SupportedChatModel,
  effort: ChatReasoningEffort
) {
  const nextEffort = resolveChatReasoningEffort(model, effort)
  const nextEfforts = {
    ...getStoredChatReasoningEffortMap(),
    [model]: nextEffort,
  }

  window.localStorage.setItem(
    CHAT_REASONING_EFFORT_STORAGE_KEY,
    JSON.stringify(nextEfforts)
  )
  chatReasoningEffortListeners.forEach((listener) => listener())
}

export function subscribeChatReasoningEffort(listener: () => void) {
  chatReasoningEffortListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatReasoningEffortListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function useChatReasoningEffort(model: SupportedChatModel) {
  const getSnapshot = React.useCallback(
    () => getStoredChatReasoningEffort(model),
    [model]
  )
  const getServerSnapshot = React.useCallback(
    () => getDefaultChatReasoningEffort(model),
    [model]
  )
  const reasoningEffort = React.useSyncExternalStore(
    subscribeChatReasoningEffort,
    getSnapshot,
    getServerSnapshot
  )
  const setReasoningEffort = React.useCallback(
    (effort: ChatReasoningEffort) =>
      setStoredChatReasoningEffort(model, effort),
    [model]
  )

  return [reasoningEffort, setReasoningEffort] as const
}

export function getChatModelLabel(model: SupportedChatModel) {
  return (
    CHAT_MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model
  )
}

export function getAgentChatModelLabel(
  model: SupportedChatModel,
  modelOptions: AgentModelDefinition[]
) {
  return (
    modelOptions.find((option) => option.id === model)?.label ??
    getChatModelLabel(model)
  )
}

export function getFallbackAgentModelOptions(): AgentModelDefinition[] {
  return CHAT_MODEL_OPTIONS.map((option) => ({
    id: option.value,
    label: option.label,
    providerModel: option.providerModel,
    protocol: option.protocol,
    baseUrl: null,
    supportedRuntimeIds: [...option.supportedRuntimeIds],
    reasoningEfforts: [...option.reasoningEfforts],
    defaultReasoningEffort: option.defaultReasoningEffort,
    builtin: true,
    enabled: true,
  }))
}

export function normalizeChatRuntimeInfos(runtimes: AgentRuntimeInfo[]) {
  const seenRuntimeIds = new Set<string>()
  const normalized = runtimes.reduce<ChatRuntimeOption[]>(
    (options, runtime) => {
      if (!isSelectableAgentRuntimeId(runtime.id)) {
        return options
      }
      if (seenRuntimeIds.has(runtime.id)) {
        return options
      }

      seenRuntimeIds.add(runtime.id)
      options.push({
        id: runtime.id,
        label: runtime.label,
        description: runtime.description,
        capabilities: runtime.capabilities,
      })
      return options
    },
    []
  )

  if (!seenRuntimeIds.has(DEFAULT_CHAT_RUNTIME_ID)) {
    return [FALLBACK_CHAT_RUNTIME_INFO, ...normalized]
  }

  return normalized.length > 0 ? normalized : [FALLBACK_CHAT_RUNTIME_INFO]
}

export function resolveChatRuntimeId(
  runtimeId: string,
  runtimeInfos: ChatRuntimeOption[]
) {
  return runtimeInfos.some((runtime) => runtime.id === runtimeId)
    ? runtimeId
    : DEFAULT_CHAT_RUNTIME_ID
}

export function getChatModelOptionsForRuntime(
  runtimeId: string,
  agentModelSettings: AgentModelSettingsPayload | null
) {
  const models = agentModelSettings?.models ?? getFallbackAgentModelOptions()
  const compatibleModels = models.filter(
    (model) =>
      model.enabled &&
      model.supportedRuntimeIds.some((supportedRuntimeId) => {
        return supportedRuntimeId === runtimeId
      })
  )

  return compatibleModels.length > 0 ? compatibleModels : models
}

export function getChatModelReasoningEffort(
  model: SupportedChatModel,
  reasoningEffort: ChatReasoningEffort | null | undefined,
  modelOptions: AgentModelDefinition[]
) {
  const modelOption = modelOptions.find((option) => option.id === model)
  const supportedEfforts =
    modelOption?.reasoningEfforts ?? getChatReasoningEfforts(model)

  if (reasoningEffort && supportedEfforts.includes(reasoningEffort)) {
    return reasoningEffort
  }

  return (
    modelOption?.defaultReasoningEffort ??
    resolveChatReasoningEffort(
      model,
      reasoningEffort ?? getDefaultChatReasoningEffort(model)
    )
  )
}

export function resolveChatPreferences(
  preferences: ChatPreferenceRecord,
  runtimeInfos: ChatRuntimeOption[],
  agentModelSettings: AgentModelSettingsPayload | null
): ResolvedChatPreferences {
  const runtimeId = resolveChatRuntimeId(
    preferences.chatRuntimeId?.trim() || DEFAULT_CHAT_RUNTIME_ID,
    runtimeInfos
  )
  const modelOptions = getChatModelOptionsForRuntime(
    runtimeId,
    agentModelSettings
  )
  const runtimeDefault =
    agentModelSettings?.runtimes[
      runtimeId as keyof AgentModelSettingsPayload["runtimes"]
    ]?.defaultModel
  const model =
    modelOptions.find((option) => option.id === preferences.chatModel)?.id ??
    modelOptions.find((option) => option.id === runtimeDefault)?.id ??
    modelOptions.find((option) => option.id === DEFAULT_CHAT_MODEL)?.id ??
    modelOptions[0]?.id ??
    DEFAULT_CHAT_MODEL
  const requestedReasoningEffort =
    preferences.chatReasoningEffort ??
    (model === DEFAULT_CHAT_MODEL ? DEFAULT_CHAT_REASONING_EFFORT : undefined)
  const reasoningEffort = getChatModelReasoningEffort(
    model,
    requestedReasoningEffort,
    modelOptions
  )

  return {
    runtimeId,
    model,
    reasoningEffort,
  }
}

export function mergeChatPreferences(
  sessionPreferences: ChatPreferenceRecord | null | undefined,
  chatDefaults: StoredChatDefaults | null
): ChatPreferenceRecord {
  return {
    chatRuntimeId:
      sessionPreferences?.chatRuntimeId ?? chatDefaults?.runtimeId ?? null,
    chatModel: sessionPreferences?.chatModel ?? chatDefaults?.model ?? null,
    chatReasoningEffort:
      sessionPreferences?.chatReasoningEffort ??
      chatDefaults?.reasoningEffort ??
      null,
  }
}

export function getSessionChatPreferences(
  sessionId: string,
  snapshot: SessionChatPreferencesSnapshot | null
) {
  return snapshot?.sessionId === sessionId ? snapshot.preferences : undefined
}

export function hasExplicitChatPreferences(
  preferences: ChatPreferenceRecord | null | undefined
) {
  return Boolean(
    preferences?.chatRuntimeId ||
    preferences?.chatModel ||
    preferences?.chatReasoningEffort
  )
}

export function readStoredChatDefaults(): StoredChatDefaults | null {
  if (typeof window === "undefined") {
    return null
  }

  const stored = window.localStorage.getItem(CHAT_DEFAULTS_STORAGE_KEY)

  if (!stored) {
    return null
  }

  try {
    const parsed = JSON.parse(stored) as {
      runtimeId?: unknown
      model?: unknown
      reasoningEffort?: unknown
    }
    const defaults: StoredChatDefaults = {}

    if (typeof parsed.runtimeId === "string" && parsed.runtimeId.trim()) {
      defaults.runtimeId = parsed.runtimeId.trim()
    }

    if (typeof parsed.model === "string" && parsed.model.trim()) {
      defaults.model = parsed.model.trim()
    }

    if (
      typeof parsed.reasoningEffort === "string" &&
      isChatReasoningEffort(parsed.reasoningEffort)
    ) {
      defaults.reasoningEffort = parsed.reasoningEffort
    }

    return Object.keys(defaults).length > 0 ? defaults : null
  } catch {
    return null
  }
}

export function writeStoredChatDefaults(defaults: ResolvedChatPreferences) {
  window.localStorage.setItem(
    CHAT_DEFAULTS_STORAGE_KEY,
    JSON.stringify({
      runtimeId: defaults.runtimeId,
      model: defaults.model,
      reasoningEffort: defaults.reasoningEffort,
    })
  )
  chatDefaultsListeners.forEach((listener) => listener())
}

export function subscribeChatDefaults(listener: () => void) {
  chatDefaultsListeners.add(listener)
  window.addEventListener("storage", listener)

  return () => {
    chatDefaultsListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

export function getChatRuntimeLabel(
  runtimeId: string,
  runtimeInfos: ChatRuntimeOption[]
) {
  return (
    runtimeInfos.find((runtime) => runtime.id === runtimeId)?.label ??
    FALLBACK_CHAT_RUNTIME_INFO.label
  )
}

export function supportsPermissionMode(
  runtimeId: string,
  runtimeInfos: ChatRuntimeOption[]
) {
  return (
    runtimeInfos.find((runtime) => runtime.id === runtimeId)?.capabilities
      .hitl ?? false
  )
}
