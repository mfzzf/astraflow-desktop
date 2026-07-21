// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  CLAUDE_AGENT_CONFIG_ID,
  CLAUDE_FAST_MODE_CONFIG_ID,
  CLAUDE_MODE_CONFIG_ID,
  findClaudeConfigOption,
  getClaudeFastMode,
  getClaudeModeCycle,
  getNextClaudeMode,
  getClaudePlanMode,
  getClaudeSelectOptions,
} from "@/lib/agent/acp/claude-features"
import {
  createAcpMapperReplayState,
  mapClaudeAcpSdkMessage,
} from "@/lib/agent/acp/acp-runtime"
import { resolveClaudeCodeAcpSessionMeta } from "@/lib/agent/adapters/acp-runtimes"
import {
  createClaudeSdkMapperState,
  mapClaudeSdkMessageToAgentEvents,
  type ClaudeSdkMappableMessage,
} from "@/lib/agent/adapters/claude-native-runtime"
import {
  formatClaudeHookTitle,
  getClaudeHookTarget,
} from "@/lib/agent/claude-hook"

const options = [
  {
    id: CLAUDE_MODE_CONFIG_ID,
    name: "Mode",
    type: "select" as const,
    currentValue: "plan",
    options: [
      { value: "default", name: "Default" },
      { value: "plan", name: "Plan" },
    ],
  },
  {
    id: CLAUDE_FAST_MODE_CONFIG_ID,
    name: "Fast mode",
    type: "boolean" as const,
    currentValue: true,
  },
  {
    id: CLAUDE_AGENT_CONFIG_ID,
    name: "Agent",
    type: "select" as const,
    currentValue: "default",
    options: [
      {
        group: "project",
        name: "Project agents",
        options: [{ value: "reviewer", name: "Reviewer" }],
      },
    ],
  },
]

describe("Claude ACP feature controls", () => {
  test("keeps hook titles and matchers readable without duplicated events", () => {
    expect(formatClaudeHookTitle("PreToolUse", "PreToolUse:Bash")).toBe(
      "PreToolUse: Bash"
    )
    expect(formatClaudeHookTitle("PostToolUse", "lint")).toBe(
      "PostToolUse: lint"
    )
    expect(getClaudeHookTarget("PreToolUse", "PreToolUse:Bash")).toBe("Bash")
  })

  test("reads live Plan and Fast mode values", () => {
    expect(getClaudePlanMode(options)).toEqual({
      active: true,
      available: true,
      currentMode: "plan",
    })
    expect(getClaudeFastMode(options)).toEqual({
      active: true,
      available: true,
    })
    expect(
      getClaudeModeCycle(options, {
        currentModeId: "plan",
        availableModes: [
          { id: "default", name: "Manual" },
          { id: "acceptEdits", name: "Accept Edits" },
          { id: "plan", name: "Plan" },
          { id: "dontAsk", name: "Don't Ask" },
          { id: "auto", name: "Auto" },
        ],
      })
    ).toEqual(["default", "acceptEdits", "plan", "auto"])
    expect(
      getNextClaudeMode(options, {
        currentModeId: "plan",
        availableModes: [
          { id: "default", name: "Manual" },
          { id: "acceptEdits", name: "Accept Edits" },
          { id: "plan", name: "Plan" },
          { id: "bypassPermissions", name: "Bypass" },
          { id: "auto", name: "Auto" },
        ],
      })
    ).toBe("bypassPermissions")
  })

  test("flattens grouped custom agents without losing group metadata", () => {
    const agent = findClaudeConfigOption(options, CLAUDE_AGENT_CONFIG_ID)

    expect(getClaudeSelectOptions(agent)).toEqual([
      {
        value: "reviewer",
        name: "Reviewer",
        groupId: "project",
        groupName: "Project agents",
      },
    ])
  })

  test("enables the Claude SDK features that ACP does not render natively", () => {
    const meta = resolveClaudeCodeAcpSessionMeta()

    expect(meta.claudeCode.options).toEqual({
      agentProgressSummaries: true,
      enableFileCheckpointing: true,
      forwardSubagentText: true,
      includeHookEvents: true,
      promptSuggestions: true,
    })
    expect(meta.claudeCode.emitRawSDKMessages).toContainEqual({
      type: "active_goal",
    })
    expect(meta.claudeCode.emitRawSDKMessages).toContainEqual({
      type: "prompt_suggestion",
    })
    expect(meta.claudeCode.emitRawSDKMessages).toContainEqual({
      type: "tool_use_summary",
    })
    expect(meta.claudeCode.emitRawSDKMessages).toContainEqual({
      type: "system",
      subtype: "hook_started",
    })
  })

  test("maps raw Claude hooks, summaries, goals, and prompt suggestions", () => {
    const state = createAcpMapperReplayState()

    expect(
      mapClaudeAcpSdkMessage(
        {
          type: "system",
          subtype: "hook_started",
          hook_id: "hook-1",
          hook_name: "lint",
          hook_event: "PostToolUse",
        },
        state
      )
    ).toEqual([
      {
        type: "tool_call",
        id: "hook-1",
        name: "hook",
        title: "PostToolUse: lint",
        kind: "think",
        input: '{\n  "event": "PostToolUse",\n  "name": "lint"\n}',
      },
    ])
    expect(
      mapClaudeAcpSdkMessage(
        {
          type: "system",
          subtype: "hook_progress",
          hook_id: "hook-1",
          output: "Checking…",
        },
        state
      )
    ).toEqual([
      {
        type: "tool_output",
        id: "hook-1",
        name: "hook",
        output: "Checking…",
      },
    ])
    expect(
      mapClaudeAcpSdkMessage(
        {
          type: "system",
          subtype: "hook_response",
          hook_id: "hook-1",
          hook_name: "lint",
          outcome: "success",
          output: "Passed",
        },
        state
      )
    ).toEqual([
      {
        type: "tool_result",
        id: "hook-1",
        name: "hook",
        status: "complete",
        output: "Passed",
      },
    ])

    expect(
      mapClaudeAcpSdkMessage(
        {
          type: "tool_use_summary",
          summary: "Checked the repository",
          preceding_tool_use_ids: ["tool-1", "tool-2"],
        },
        state
      )
    ).toEqual([
      {
        type: "tool_update",
        id: "tool-2",
        title: "Checked the repository",
        meta: {
          claudeCode: {
            generatedSummary: true,
            precedingToolUseIds: ["tool-1", "tool-2"],
          },
        },
      },
    ])

    mapClaudeAcpSdkMessage(
      {
        type: "active_goal",
        value: { condition: "Finish the migration", iterations: 2 },
      },
      state
    )
    mapClaudeAcpSdkMessage(
      { type: "prompt_suggestion", suggestion: "Run the focused tests" },
      state
    )

    expect(state.claudeActiveGoal).toEqual({
      condition: "Finish the migration",
      iterations: 2,
    })
    expect(state.claudePromptSuggestion).toBe("Run the focused tests")
  })

  test("tracks background work and surfaces Claude persistence failures", () => {
    const state = createAcpMapperReplayState()

    expect(
      mapClaudeAcpSdkMessage(
        {
          type: "system",
          subtype: "background_tasks_changed",
          tasks: [
            {
              task_id: "task-1",
              task_type: "agent",
              description: "Review the implementation",
            },
          ],
        },
        state
      )
    ).toEqual([
      {
        type: "run_meta",
        metadata: {
          claudeCode: {
            backgroundTasks: [
              {
                task_id: "task-1",
                task_type: "agent",
                description: "Review the implementation",
              },
            ],
          },
        },
      },
    ])
    expect(state.claudeBackgroundTasks).toHaveLength(1)

    expect(
      mapClaudeAcpSdkMessage(
        {
          type: "system",
          subtype: "files_persisted",
          files: [],
          failed: [{ filename: "report.md", error: "upload failed" }],
        },
        state
      )
    ).toEqual([
      {
        type: "run_meta",
        metadata: {
          claudeCode: {
            filesPersisted: {
              type: "system",
              subtype: "files_persisted",
              files: [],
              failed: [{ filename: "report.md", error: "upload failed" }],
            },
          },
        },
      },
      {
        type: "error",
        message: "Claude could not persist files:\nreport.md: upload failed",
      },
    ])

    mapClaudeAcpSdkMessage(
      { type: "conversation_reset", new_conversation_id: "next" },
      state
    )
    expect(state.claudeBackgroundTasks).toEqual([])
  })

  test("keeps Claude notifications out of assistant transcript text", () => {
    const acpState = createAcpMapperReplayState()
    const notification = {
      type: "system",
      subtype: "notification",
      message: "Approval needed",
      priority: "high",
      key: "permission",
    }

    expect(mapClaudeAcpSdkMessage(notification, acpState)).toEqual([
      {
        type: "run_meta",
        metadata: {
          claudeCode: { notification },
        },
      },
    ])
    expect(
      mapClaudeSdkMessageToAgentEvents(
        notification,
        createClaudeSdkMapperState("/workspace")
      )
    ).toEqual([
      {
        type: "run_meta",
        metadata: {
          claudeCode: { notification },
        },
      },
    ])
  })

  test("keeps the direct SDK hook and compaction lifecycle structured", () => {
    const state = createClaudeSdkMapperState("/workspace")
    const map = (message: ClaudeSdkMappableMessage) =>
      mapClaudeSdkMessageToAgentEvents(message, state)

    expect(
      map({
        type: "system",
        subtype: "hook_started",
        hook_id: "hook-native",
        hook_name: "verify",
        hook_event: "Stop",
        uuid: "hook-start",
        session_id: "claude-session",
      })
    ).toEqual([
      {
        type: "tool_call",
        id: "hook-native",
        name: "hook",
        title: "Stop: verify",
        kind: "think",
        input: '{\n  "event": "Stop",\n  "name": "verify"\n}',
      },
    ])
    expect(
      map({
        type: "system",
        subtype: "hook_response",
        hook_id: "hook-native",
        hook_name: "verify",
        hook_event: "Stop",
        output: "Verified",
        stdout: "Verified",
        stderr: "",
        outcome: "success",
        uuid: "hook-end",
        session_id: "claude-session",
      })
    ).toEqual([
      {
        type: "tool_result",
        id: "hook-native",
        name: "hook",
        status: "complete",
        output: "Verified",
      },
    ])

    expect(
      map({
        type: "system",
        subtype: "status",
        status: "compacting",
        uuid: "compact-start",
        session_id: "claude-session",
      })
    ).toEqual([
      {
        type: "tool_call",
        id: "claude-compaction:compact-start",
        name: "context_compaction",
        title: "Context compaction",
        kind: "think",
        input: "",
      },
    ])
    expect(
      map({
        type: "system",
        subtype: "status",
        status: null,
        compact_result: "success",
        uuid: "compact-end",
        session_id: "claude-session",
      })
    ).toEqual([
      {
        type: "tool_result",
        id: "claude-compaction:compact-start",
        name: "context_compaction",
        status: "complete",
        output: "",
      },
    ])
  })
})
