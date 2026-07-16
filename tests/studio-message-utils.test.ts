// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  getSessionFileChanges,
  getSessionOutputFiles,
  mergeReloadedMessages,
} from "@/components/studio-chat/message-utils"
import { aggregateTurnFileChanges } from "@/components/studio-message-parts/file-change"
import type {
  StudioMessage,
  StudioMessageActivity,
  StudioMessagePart,
} from "@/lib/studio-types"

function assistantMessage(activities: StudioMessageActivity[]): StudioMessage {
  return {
    id: "message-1",
    sessionId: "session-1",
    role: "assistant",
    content: "",
    model: null,
    versionGroupId: null,
    versionIndex: 0,
    versionCount: 1,
    isActiveVersion: true,
    activities,
    parts: activities.map((activity) => ({
      id: `part-${activity.id}`,
      type: "tool" as const,
      activity,
    })),
    reasoningContent: "",
    reasoningDurationMs: null,
    status: "complete",
    attachments: [],
    createdAt: "2026-07-11T00:00:00.000Z",
  }
}

function fileActivity(
  id: string,
  toolName: string,
  path: string
): StudioMessageActivity {
  return {
    id,
    toolName,
    status: "complete",
    input: JSON.stringify({ path }),
    output: "",
    error: null,
  }
}

function assistantFileMessage(parts: StudioMessagePart[]): StudioMessage {
  return {
    ...assistantMessage([]),
    parts,
  }
}

describe("studio environment sources", () => {
  test("recognizes MCP filesystem reads", () => {
    expect(
      getSessionOutputFiles([
        assistantMessage([
          fileActivity("read-1", "mcp__filesystem__read_file", "src/config.ts"),
        ]),
      ])
    ).toEqual([
      {
        path: "src/config.ts",
        name: "config.ts",
        environment: "local",
        sourceKind: "read",
      },
    ])
  })

  test("keeps an updated source updated after a later read", () => {
    expect(
      getSessionOutputFiles([
        assistantMessage([
          fileActivity("write-1", "mcp__filesystem__write_file", "README.md"),
          fileActivity("read-1", "mcp__filesystem__read_file", "README.md"),
        ]),
      ])
    ).toEqual([
      {
        path: "README.md",
        name: "README.md",
        environment: "local",
        sourceKind: "updated",
      },
    ])
  })

  test("does not open remote MCP repository paths as local files", () => {
    expect(
      getSessionOutputFiles([
        assistantMessage([
          fileActivity(
            "read-remote",
            "mcp__github__get_file_contents",
            "src/config.ts"
          ),
        ]),
      ])
    ).toEqual([])
  })

  test("removes a previously written source after a completed delete", () => {
    expect(
      getSessionOutputFiles([
        assistantFileMessage([
          {
            id: "create-1",
            type: "file",
            path: "tmp/result.txt",
            kind: "create",
            status: "complete",
            error: null,
            content: "created",
          },
          {
            id: "delete-1",
            type: "file",
            path: "tmp/result.txt",
            kind: "delete",
            status: "complete",
            error: null,
            content: "",
          },
        ]),
      ])
    ).toEqual([])
  })

  test("removes files deleted through a local filesystem tool", () => {
    expect(
      getSessionOutputFiles([
        assistantMessage([
          fileActivity("write-1", "mcp__filesystem__write_file", "tmp/a.txt"),
          fileActivity(
            "delete-1",
            "mcp__filesystem__delete_file",
            "tmp/a.txt"
          ),
        ]),
      ])
    ).toEqual([])
  })

  test("keeps identical local and remote paths provenance-separated", () => {
    expect(
      getSessionOutputFiles([
        {
          ...assistantMessage([
            fileActivity("remote", "mcp__filesystem__read_file", "result.md"),
          ]),
          environment: "remote",
        },
        {
          ...assistantMessage([
            fileActivity("local", "mcp__filesystem__read_file", "result.md"),
          ]),
          id: "message-2",
          environment: "local",
        },
      ])
    ).toEqual([
      {
        path: "result.md",
        name: "result.md",
        environment: "remote",
        sourceKind: "read",
      },
      {
        path: "result.md",
        name: "result.md",
        environment: "local",
        sourceKind: "read",
      },
    ])
  })

  test("ignores failed changes and aggregates repeated real diffs", () => {
    expect(
      getSessionFileChanges([
        assistantFileMessage([
          {
            id: "edit-1",
            type: "file",
            path: "src/app.ts",
            kind: "edit",
            status: "complete",
            error: null,
            content: "",
            diff: "@@ -1 +1 @@\n-old\n+new",
          },
          {
            id: "edit-2",
            type: "file",
            path: "src/app.ts",
            kind: "edit",
            status: "complete",
            error: null,
            content: "",
            diff: "@@ -2 +2 @@\n-before\n+after",
          },
          {
            id: "failed",
            type: "file",
            path: "src/failed.ts",
            kind: "create",
            status: "error",
            error: "nope",
            content: "ignored",
          },
        ]),
      ])
    ).toEqual([
      {
        path: "src/app.ts",
        name: "app.ts",
        kind: "edit",
        additions: 2,
        deletions: 2,
        environment: "local",
      },
    ])
  })

  test("does not treat a file action summary as the file diff", () => {
    const part = {
      id: "create-no-diff",
      type: "file" as const,
      path: "/tmp/create_ai_deck.js",
      kind: "create" as const,
      status: "complete" as const,
      error: null,
      content: "Created /tmp/create_ai_deck.js",
      diff: null,
    }

    expect(getSessionFileChanges([assistantFileMessage([part])])).toEqual([
      {
        path: "/tmp/create_ai_deck.js",
        name: "create_ai_deck.js",
        kind: "create",
        additions: 0,
        deletions: 0,
        environment: "local",
      },
    ])
    expect(aggregateTurnFileChanges([part])).toEqual([
      {
        path: "/tmp/create_ai_deck.js",
        kind: "create",
        additions: 0,
        deletions: 0,
        diff: null,
        environment: "local",
      },
    ])
  })

  test("restores a legacy Pi create diff from its successful write input", () => {
    const content = [
      "const pptxgen = require('pptxgenjs');",
      "const deck = new pptxgen();",
      "module.exports = deck;",
    ].join("\n")
    const writeActivity: StudioMessageActivity = {
      id: "write-create-deck",
      toolName: "write",
      status: "complete",
      input: JSON.stringify({ path: "create_ai_deck.js", content }),
      output: "Successfully wrote the file.",
      error: null,
    }
    const legacyMessage: StudioMessage = {
      ...assistantMessage([writeActivity]),
      parts: [
        {
          id: writeActivity.id,
          type: "tool",
          activity: writeActivity,
        },
        {
          id: "create-deck",
          type: "file",
          path: `/tmp/sandbox-workspaces/session-1/create_ai_deck.js`,
          kind: "create",
          status: "complete",
          error: null,
          content:
            "Created /tmp/sandbox-workspaces/session-1/create_ai_deck.js",
          diff: null,
        },
      ],
    }

    const [restoredMessage] = mergeReloadedMessages([], [legacyMessage])
    const restoredPart = restoredMessage.parts.find(
      (part) => part.type === "file"
    )

    expect(restoredPart?.type).toBe("file")
    if (restoredPart?.type !== "file") {
      throw new Error("Expected the restored file part.")
    }

    expect(restoredPart.diff).toContain(
      "+const pptxgen = require('pptxgenjs');"
    )
    expect(restoredPart.diff).not.toContain(
      "+Created /tmp/sandbox-workspaces/session-1/create_ai_deck.js"
    )
    expect(getSessionFileChanges([restoredMessage])).toEqual([
      {
        path: "/tmp/sandbox-workspaces/session-1/create_ai_deck.js",
        name: "create_ai_deck.js",
        kind: "create",
        additions: 3,
        deletions: 0,
        environment: "local",
      },
    ])
    expect(aggregateTurnFileChanges([restoredPart])).toEqual([
      {
        path: "/tmp/sandbox-workspaces/session-1/create_ai_deck.js",
        kind: "create",
        additions: 3,
        deletions: 0,
        diff: restoredPart.diff,
        environment: "local",
      },
    ])
  })
})
