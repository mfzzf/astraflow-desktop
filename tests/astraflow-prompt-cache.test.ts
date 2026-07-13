import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { AIMessage, HumanMessage } from "@langchain/core/messages"

import {
  appendAstraFlowMentionPaths,
  findLangChainUsage,
  sortAstraFlowToolsForPromptCache,
} from "@/lib/agent/adapters/astraflow-runtime"
import type { PromptMention } from "@/lib/agent/composer-types"
import { convertStudioMessagesToLangChainMessages } from "@/lib/studio-chat-runner"
import {
  getSessionPromptContext,
  snapshotSessionPromptMentions,
} from "@/lib/studio-session-prompt-context"
import type { StudioMessage } from "@/lib/studio-types"

function studioMessage({
  content,
  id,
  mentions = [],
  role,
}: {
  content: string
  id: string
  mentions?: PromptMention[]
  role: "user" | "assistant"
}): StudioMessage {
  return {
    id,
    sessionId: "current-session",
    role,
    content,
    mentions,
    model: null,
    environment: "local",
    versionGroupId: null,
    versionIndex: 1,
    versionCount: 1,
    isActiveVersion: true,
    activities: [],
    parts: [],
    reasoningContent: "",
    reasoningDurationMs: null,
    status: "complete",
    attachments: [],
    createdAt: "2026-07-13T00:00:00.000Z",
  }
}

describe("AstraFlow prompt prefix stability", () => {
  test("keeps tool definitions in a deterministic order", () => {
    const sorted = sortAstraFlowToolsForPromptCache([
      { name: "z_tool" },
      { name: "a_tool" },
      { name: "m_tool" },
    ])

    assert.deepEqual(
      sorted.map((tool) => tool.name),
      ["a_tool", "m_tool", "z_tool"]
    )
  })

  test("extracts usage events emitted by the LangChain message stream", () => {
    const usage = {
      input_tokens: 2_000,
      output_tokens: 100,
      total_tokens: 2_100,
      input_token_details: { cache_read: 1_536 },
    }

    assert.equal(findLangChainUsage({ event: "usage", usage }), usage)
  })

  test("keeps file mention expansion on older user messages", () => {
    const firstUser = new HumanMessage({
      content: "Inspect this file",
      additional_kwargs: {
        mentions: [{ kind: "file", name: "app.ts", path: "/workspace/app.ts" }],
      },
    })
    const firstRequest = appendAstraFlowMentionPaths([firstUser])
    const secondRequest = appendAstraFlowMentionPaths([
      firstUser,
      new AIMessage("Done"),
      new HumanMessage("Check it again"),
    ])

    assert.equal(firstRequest[0].content, secondRequest[0].content)
    assert.match(String(secondRequest[0].content), /\/workspace\/app\.ts/)
    assert.equal(secondRequest[1].content, "Done")
    assert.equal(secondRequest[2].content, "Check it again")
  })

  test("snapshots referenced sessions instead of rebuilding old prefixes", () => {
    const originalSource = [
      studioMessage({ id: "source-user", role: "user", content: "Original" }),
    ]
    const mentions = snapshotSessionPromptMentions({
      currentSessionId: "current-session",
      mentions: [
        { kind: "session", sessionId: "source-session", title: "Source" },
      ],
      resolveReferencedSession: () => ({
        messages: originalSource,
        title: "Source",
      }),
    })
    const originalContext = getSessionPromptContext(mentions)
    const repeated = snapshotSessionPromptMentions({
      currentSessionId: "current-session",
      mentions,
      resolveReferencedSession: () => ({
        messages: [
          ...originalSource,
          studioMessage({
            id: "source-new",
            role: "assistant",
            content: "Later update",
          }),
        ],
        title: "Source",
      }),
    })

    assert.equal(getSessionPromptContext(repeated), originalContext)
    assert.doesNotMatch(getSessionPromptContext(repeated), /Later update/)
  })

  test("preserves every earlier expanded user message when a turn is appended", () => {
    const promptContext =
      "--- Referenced conversation: Source ---\nUser: Original"
    const firstUser = studioMessage({
      id: "user-1",
      role: "user",
      content: "Use that conversation",
      mentions: [
        {
          kind: "session",
          sessionId: "source-session",
          title: "Source",
          promptContext,
        },
      ],
    })
    const firstRequest = convertStudioMessagesToLangChainMessages([firstUser])
    const secondRequest = convertStudioMessagesToLangChainMessages([
      firstUser,
      studioMessage({ id: "assistant-1", role: "assistant", content: "Done" }),
      studioMessage({ id: "user-2", role: "user", content: "Continue" }),
    ])

    assert.equal(firstRequest[0].content, secondRequest[0].content)
    assert.match(String(secondRequest[0].content), /User: Original/)
    assert.equal(secondRequest[2].content, "Continue")
  })
})
