import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { filterAgentModelsByModelSquare } from "@/lib/agent-model-catalog"
import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"

function createModel(
  id: string,
  providerModel: string,
  builtin = true
): AgentModelDefinition {
  return {
    id,
    label: id,
    providerModel,
    protocol: "openai-chat",
    baseUrl: null,
    supportedRuntimeIds: ["astraflow"],
    reasoningEfforts: ["none"],
    defaultReasoningEffort: "none",
    builtin,
    enabled: true,
  }
}

describe("agent model catalog filtering", () => {
  test("keeps only built-in models present in Model Square", () => {
    const models = [
      createModel("gpt-5.6-sol", "gpt-5.6-sol"),
      createModel("gpt-5.6-terra", "gpt-5.6-terra"),
    ]

    assert.deepEqual(
      filterAgentModelsByModelSquare(models, ["GPT-5.6-SOL"]).map(
        (model) => model.id
      ),
      ["gpt-5.6-sol"]
    )
  })

  test("matches runtime aliases through the provider model name", () => {
    const model = createModel("anthropic/glm-5.2", "glm-5.2")

    assert.deepEqual(
      filterAgentModelsByModelSquare([model], ["glm-5.2"]),
      [model]
    )
  })

  test("preserves custom models outside Model Square", () => {
    const customModel = createModel(
      "internal-chat-model",
      "internal-chat-model",
      false
    )

    assert.deepEqual(
      filterAgentModelsByModelSquare([customModel], []),
      [customModel]
    )
  })
})
