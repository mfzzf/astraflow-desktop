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
  getSessionChatPreferences,
  getFallbackAgentModelOptions,
  resolveChatPreferences,
} from "@/components/studio-chat/chat-preferences"
import { FALLBACK_CHAT_RUNTIME_INFO } from "@/components/studio-chat/constants"

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

  test("uses GPT 5.6 Sol with medium reasoning before the user chooses", () => {
    const models = getFallbackAgentModelOptions()
    const settings = createSettings(models, "gpt-5.5")

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
        chatModel: "gpt-5.5",
        chatReasoningEffort: "high",
      },
      [FALLBACK_CHAT_RUNTIME_INFO],
      createSettings(models, DEFAULT_CHAT_MODEL)
    )

    assert.equal(preferences.model, "gpt-5.5")
    assert.equal(preferences.reasoningEffort, "high")
  })

  test("falls back to the runtime default when GPT 5.6 Sol is unavailable", () => {
    const models = getFallbackAgentModelOptions().filter(
      (model) => model.id !== DEFAULT_CHAT_MODEL
    )

    const preferences = resolveChatPreferences(
      {},
      [FALLBACK_CHAT_RUNTIME_INFO],
      createSettings(models, "gpt-5.5")
    )

    assert.equal(preferences.model, "gpt-5.5")
    assert.equal(preferences.reasoningEffort, "medium")
  })
})
