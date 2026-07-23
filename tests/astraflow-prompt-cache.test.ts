import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { appendAstraFlowMentionPaths } from "@/lib/agent/adapters/astraflow-runtime"
import type { PromptMention } from "@/lib/agent/composer-types"
import type { AgentMessage } from "@/lib/agent/messages"
import {
  applyStudioSessionCompaction,
  convertStudioMessagesToAgentMessages,
} from "@/lib/studio-chat-runner"
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
  test("keeps file mention expansion on older user messages", () => {
    const firstUser: AgentMessage = {
      role: "user",
      content: "Inspect this file",
      mentions: [{ kind: "file", name: "app.ts", path: "/workspace/app.ts" }],
    }
    const firstRequest = appendAstraFlowMentionPaths([firstUser])
    const secondRequest = appendAstraFlowMentionPaths([
      firstUser,
      { role: "assistant", content: "Done" },
      { role: "user", content: "Check it again" },
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
    const firstRequest = convertStudioMessagesToAgentMessages([firstUser])
    const secondRequest = convertStudioMessagesToAgentMessages([
      firstUser,
      studioMessage({ id: "assistant-1", role: "assistant", content: "Done" }),
      studioMessage({ id: "user-2", role: "user", content: "Continue" }),
    ])

    assert.equal(firstRequest[0].content, secondRequest[0].content)
    assert.match(String(secondRequest[0].content), /User: Original/)
    assert.equal(secondRequest[2].content, "Continue")
  })

  test("keeps stable Studio message ids for Pi compaction boundaries", () => {
    const messages = [
      studioMessage({ id: "user-1", role: "user", content: "Start" }),
      studioMessage({
        id: "assistant-1",
        role: "assistant",
        content: "Done",
      }),
    ]

    assert.deepEqual(
      convertStudioMessagesToAgentMessages(messages).map(
        (message) => message.id
      ),
      ["user-1", "assistant-1"]
    )
  })

  test("applies a persisted Pi summary only when both boundaries are visible", () => {
    const history = [
      studioMessage({ id: "user-1", role: "user", content: "Old request" }),
      studioMessage({
        id: "assistant-1",
        role: "assistant",
        content: "Old answer",
      }),
      studioMessage({ id: "user-2", role: "user", content: "Recent request" }),
      studioMessage({
        id: "assistant-2",
        role: "assistant",
        content: "Recent answer",
      }),
    ]
    const compaction = {
      sessionId: "current-session",
      runtimeId: "astraflow",
      summary: "Earlier work was completed.",
      firstKeptMessageId: "user-2",
      throughMessageId: "assistant-2",
      tokensBefore: 12_000,
      estimatedTokensAfter: 2_000,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    }

    const applied = applyStudioSessionCompaction(history, compaction)

    assert.equal(applied.summary, "Earlier work was completed.")
    assert.deepEqual(
      applied.history.map((message) => message.id),
      ["user-2", "assistant-2"]
    )

    const retryHistory = history.slice(0, 2)
    const retryBeforeBoundary = applyStudioSessionCompaction(
      retryHistory,
      compaction
    )

    assert.equal(retryBeforeBoundary.summary, null)
    assert.equal(retryBeforeBoundary.history, retryHistory)
    assert.deepEqual(
      retryBeforeBoundary.history.map((message) => message.id),
      ["user-1", "assistant-1"]
    )
  })
})
