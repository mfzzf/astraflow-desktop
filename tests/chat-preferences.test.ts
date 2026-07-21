import assert from "node:assert/strict"
import { describe, test } from "node:test"

import type {
  AgentModelDefinition,
  AgentModelSettingsPayload,
} from "@/lib/agent-model-settings-shared"
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_CHAT_REASONING_EFFORT,
} from "@/lib/chat-models"
import {
  canSynchronizeChatPreferences,
  getSessionChatPreferences,
  getFallbackAgentModelOptions,
  resolveChatPreferences,
} from "@/components/studio-chat/chat-preferences"
import { FALLBACK_CHAT_RUNTIME_INFO } from "@/components/studio-chat/constants"
import { PreferenceSaveCoordinator } from "@/components/studio-chat/preference-save-coordinator"

function createSettings(
  models: AgentModelDefinition[],
  defaultModel: string
): AgentModelSettingsPayload {
  return {
    models,
    runtimes: {
      astraflow: { useLocalSettings: false, defaultModel },
      codex: { useLocalSettings: false, defaultModel },
      "codex-direct": { useLocalSettings: false, defaultModel },
      "claude-code": { useLocalSettings: false, defaultModel },
      "claude-native": { useLocalSettings: false, defaultModel },
      opencode: { useLocalSettings: false, defaultModel },
      "opencode-native": { useLocalSettings: false, defaultModel },
    },
    customModels: [],
    updatedAt: null,
    hasModelverseApiKey: true,
  }
}

describe("chat preference resolution", () => {
  test("waits for the runtime catalog before synchronizing session preferences", () => {
    const sessionPreferences = {
      chatRuntimeId: "claude-code",
      chatModel: "claude-sonnet-4-6",
      chatReasoningEffort: "medium" as const,
    }

    assert.equal(
      canSynchronizeChatPreferences({
        chatDefaultsHydrated: true,
        runtimeCatalogStatus: "loading",
        sessionId: "session-1",
        sessionPreferences,
      }),
      false
    )
    assert.equal(
      canSynchronizeChatPreferences({
        chatDefaultsHydrated: true,
        runtimeCatalogStatus: "error",
        sessionId: "session-1",
        sessionPreferences,
      }),
      false
    )
    assert.equal(
      canSynchronizeChatPreferences({
        chatDefaultsHydrated: true,
        runtimeCatalogStatus: "ready",
        sessionId: "session-1",
        sessionPreferences,
      }),
      true
    )
  })

  test("serializes preference saves and invalidates an overlapping refresh", async () => {
    const coordinator = new PreferenceSaveCoordinator()
    const events: string[] = []
    let releaseFirstSave!: () => void
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve
    })

    const firstSave = coordinator.enqueue(async () => {
      events.push("first:start")
      await firstSaveGate
      events.push("first:end")
    })
    const idleVersion = coordinator.captureIdleVersion()
    const secondSave = coordinator.enqueue(async () => {
      events.push("second")
    })

    await Promise.resolve()
    assert.deepEqual(events, ["first:start"])

    releaseFirstSave()
    await Promise.all([firstSave, secondSave])

    const capturedVersion = await idleVersion
    assert.deepEqual(events, ["first:start", "first:end", "second"])
    assert.equal(coordinator.isCurrent(capturedVersion), true)

    void coordinator.enqueue(async () => undefined)
    assert.equal(coordinator.isCurrent(capturedVersion), false)
  })

  test("does not expose preferences loaded for a different session", () => {
    const snapshot = {
      sessionId: "old-session",
      preferences: {
        chatRuntimeId: "astraflow",
      },
    }

    assert.equal(getSessionChatPreferences("new-session", snapshot), undefined)
    assert.deepEqual(getSessionChatPreferences("old-session", snapshot), {
      chatRuntimeId: "astraflow",
    })
  })

  test("uses the domestic default model before the user chooses", () => {
    const models = getFallbackAgentModelOptions()
    const settings = createSettings(models, "deepseek-v4-pro")

    const preferences = resolveChatPreferences(
      {},
      [FALLBACK_CHAT_RUNTIME_INFO],
      settings
    )

    assert.equal(preferences.runtimeId, "astraflow")
    assert.equal(preferences.model, DEFAULT_CHAT_MODEL)
    assert.equal(preferences.reasoningEffort, DEFAULT_CHAT_REASONING_EFFORT)
  })

  test("keeps an explicit model and reasoning choice", () => {
    const models = getFallbackAgentModelOptions()

    const preferences = resolveChatPreferences(
      {
        chatRuntimeId: "astraflow",
        chatModel: "deepseek-v4-pro",
        chatReasoningEffort: "high",
      },
      [FALLBACK_CHAT_RUNTIME_INFO],
      createSettings(models, DEFAULT_CHAT_MODEL)
    )

    assert.equal(preferences.model, "deepseek-v4-pro")
    assert.equal(preferences.reasoningEffort, "high")
  })

  test("falls back to the runtime default when the default model is unavailable", () => {
    const models = getFallbackAgentModelOptions().filter(
      (model) => model.id !== DEFAULT_CHAT_MODEL
    )

    const preferences = resolveChatPreferences(
      {},
      [FALLBACK_CHAT_RUNTIME_INFO],
      createSettings(models, "deepseek-v4-pro")
    )

    assert.equal(preferences.model, "deepseek-v4-pro")
    assert.equal(preferences.reasoningEffort, "high")
  })
})
