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
