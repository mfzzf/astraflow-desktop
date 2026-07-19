import type { SessionUpdate } from "@agentclientprotocol/sdk"

import type { AgentEvent } from "@/lib/agent/events"
import {
  createAcpMapperReplayState,
  deriveAcpRuntimeInfoFromInitialize,
  mapAcpSessionUpdatesForReplay,
} from "@/lib/agent/acp/acp-runtime"
import type { AgentRuntimeInfo } from "@/lib/agent/runtime"
import { createUnifiedFileDiff } from "@/lib/agent/unified-diff"

function payload(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function expectedFileChange({
  kind,
  nextContent,
  path,
  previousContent,
}: {
  kind: "create" | "delete" | "edit"
  nextContent: string | null
  path: string
  previousContent: string | null
}): AgentEvent {
  return {
    type: "file_change",
    path,
    kind,
    status: "complete",
    diff: createUnifiedFileDiff({ path, previousContent, nextContent }),
  }
}

export const codexAcpUpdates = [
  {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: "Launching Codex subagent.",
    },
  },
  {
    sessionUpdate: "agent_thought_chunk",
    content: {
      type: "text",
      text: "Need Codex ACP coverage.",
    },
  },
  {
    sessionUpdate: "tool_call",
    toolCallId: "tool_codex_spawn",
    title: "spawnAgent",
    kind: "other",
    status: "pending",
    locations: [{ path: "README.md", line: 1 }],
    rawInput: {
      prompt: "Reply exactly: subagent-ok: 2+2=4",
      senderThreadId: "thread_parent",
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_codex_spawn",
    status: "completed",
    rawOutput: {
      threadId: "thread_child",
      output: "subagent-ok: 2+2=4",
    },
  },
  {
    sessionUpdate: "plan",
    entries: [
      {
        content: "Dispatch Codex subagent",
        priority: "high",
        status: "completed",
      },
      {
        content: "Verify returned summary",
        priority: "medium",
        status: "in_progress",
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_diff_new",
    title: "create",
    kind: "edit",
    status: "completed",
    content: [
      {
        type: "diff",
        path: "/workspace/src/new.ts",
        oldText: null,
        newText: "created\n",
        _meta: { kind: "create" },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_diff_empty_edit",
    title: "edit",
    kind: "edit",
    status: "completed",
    content: [
      {
        type: "diff",
        path: "/workspace/src/empty.ts",
        oldText: "",
        newText: "filled\n",
        _meta: { kind: "edit" },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_diff_delete",
    title: "delete",
    kind: "delete",
    status: "completed",
    content: [
      {
        type: "diff",
        path: "/workspace/src/delete.ts",
        oldText: "gone\n",
        newText: "",
        _meta: { kind: "delete" },
      },
    ],
  },
] satisfies SessionUpdate[]

export const claudeAcpUpdates = [
  {
    sessionUpdate: "tool_call",
    toolCallId: "tool_claude_agent",
    title: "Agent",
    kind: "think",
    status: "in_progress",
    rawInput: {
      description: "Minimal smoke subagent",
      prompt: "Reply exactly: subagent-ok: 2+2=4",
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_claude_agent",
    status: "completed",
    rawOutput: {
      result: "subagent-ok: 2+2=4",
    },
  },
  {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: "Claude subagent finished.",
    },
  },
  {
    sessionUpdate: "plan_update",
    plan: {
      type: "items",
      planId: "claude-plan",
      entries: [
        {
          content: "Run Claude Agent tool",
          priority: "high",
          status: "completed",
        },
      ],
    },
  },
] satisfies SessionUpdate[]

export const openCodeAcpUpdates = [
  {
    sessionUpdate: "agent_thought_chunk",
    content: {
      type: "text",
      text: "OpenCode task can arrive as an update.",
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_opencode_task",
    title: "task",
    kind: "think",
    status: "completed",
    locations: [{ path: "package.json" }],
    rawInput: {
      description: "Minimal smoke subagent",
      prompt: "Reply exactly: subagent-ok: 2+2=4",
    },
    rawOutput: {
      task_result: "subagent-ok: 2+2=4",
    },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Task completed.",
        },
      },
    ],
  },
  {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "text",
      text: "OpenCode task completed.",
    },
  },
] satisfies SessionUpdate[]

export const advancedAcpUpdates = [
  {
    sessionUpdate: "user_message_chunk",
    content: {
      type: "text",
      text: "replayed user message",
    },
  },
  {
    sessionUpdate: "agent_message_chunk",
    content: {
      type: "resource_link",
      name: "design.md",
      uri: "file:///workspace/design.md",
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_diff_only",
    title: "edit",
    kind: "edit",
    status: "completed",
    content: [
      {
        type: "diff",
        path: "src/app.ts",
        oldText: "old",
        newText: "new",
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_terminal",
    title: "shell",
    kind: "execute",
    status: "completed",
    content: [
      {
        type: "terminal",
        terminalId: "term_1",
      },
    ],
  },
  {
    sessionUpdate: "tool_call",
    toolCallId: "tool_command",
    title: "-lic 'bun run typecheck'",
    kind: "execute",
    status: "in_progress",
    rawInput: {
      command: "zsh -lic 'bun run typecheck'",
      cwd: "/workspace",
    },
    content: [
      {
        type: "terminal",
        terminalId: "tool_command",
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_command",
    _meta: {
      terminal_output_delta: {
        data: "TypeScript ",
        terminal_id: "tool_command",
      },
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_command",
    _meta: {
      terminal_output_delta: {
        data: "failed.\n",
        terminal_id: "tool_command",
      },
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_command",
    status: "failed",
    rawOutput: {
      formatted_output: "TypeScript failed.\n",
      exit_code: 1,
    },
  },
  {
    sessionUpdate: "tool_call",
    toolCallId: "tool_pi_bash",
    title: "bash",
    kind: "execute",
    status: "in_progress",
    rawInput: {
      command: "bun run build",
      cwd: "/workspace",
    },
  },
  {
    // Pi forwards an empty first partial; the server stringifies it into
    // content. Neither form may become visible streaming output.
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_pi_bash",
    status: "in_progress",
    rawOutput: { content: [] },
    content: [
      {
        type: "content",
        content: { type: "text", text: '{"content":[]}' },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_pi_bash",
    status: "in_progress",
    rawOutput: {
      content: [{ type: "text", text: "Compiling…" }],
    },
    content: [
      {
        type: "content",
        content: { type: "text", text: "Compiling…" },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_pi_bash",
    status: "in_progress",
    rawOutput: {
      content: [{ type: "text", text: "Compiling…\nDone." }],
    },
    content: [
      {
        type: "content",
        content: { type: "text", text: "Compiling…\nDone." },
      },
    ],
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_pi_bash",
    status: "completed",
    rawOutput: {
      content: [{ type: "text", text: "Compiling…\nDone." }],
    },
    content: [
      {
        type: "content",
        content: { type: "text", text: "Compiling…\nDone." },
      },
    ],
  },
  {
    // Pi toolcall_start: the model begins a tool call before any canonical
    // input exists, then streams raw argument JSON via _meta toolInput.
    sessionUpdate: "tool_call",
    toolCallId: "tool_pi_write",
    title: "write",
    kind: "edit",
    status: "in_progress",
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_pi_write",
    status: "in_progress",
    _meta: {
      astraflow: {
        toolInput: '{"path":"notes.md"',
      },
    },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_pi_write",
    status: "in_progress",
    _meta: {
      astraflow: {
        toolInput: '{"path":"notes.md","content":"# Notes"',
      },
    },
  },
  {
    sessionUpdate: "tool_call",
    toolCallId: "tool_pi_write",
    title: "write",
    kind: "edit",
    status: "in_progress",
    rawInput: { path: "notes.md", content: "# Notes" },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tool_pi_write",
    status: "completed",
    rawOutput: {
      content: [{ type: "text", text: "Wrote notes.md" }],
    },
  },
  {
    sessionUpdate: "tool_call",
    toolCallId: "tool_mcp",
    title: "mcp.github.search",
    kind: "execute",
    status: "completed",
    rawInput: {
      server: "github",
      tool: "search",
      arguments: { query: "AstraFlow" },
    },
    rawOutput: {
      result: "ok",
      error: null,
    },
  },
  {
    sessionUpdate: "plan_update",
    plan: {
      type: "markdown",
      planId: "markdown-plan",
      content: "- [x] Map markdown plans\n- [ ] Verify mapper",
    },
  },
  {
    sessionUpdate: "plan_update",
    plan: {
      type: "file",
      planId: "file-plan",
      uri: "file:///workspace/PLAN.md",
    },
  },
  {
    sessionUpdate: "plan_removed",
    planId: "file-plan",
  },
  {
    sessionUpdate: "available_commands_update",
    availableCommands: [
      {
        name: "/review",
        description: "Review the current changes",
        input: {
          hint: "optional scope",
        },
      },
    ],
  },
  {
    sessionUpdate: "current_mode_update",
    currentModeId: "agent",
  },
  {
    sessionUpdate: "config_option_update",
    configOptions: [
      {
        id: "fast",
        name: "Fast mode",
        type: "boolean",
        currentValue: true,
      },
    ],
  },
  {
    sessionUpdate: "agent_message_chunk",
    messageId: "astraflow-attempt-1",
    content: { type: "text", text: "partial answer" },
    _meta: { astraflow: { engine: "pi-agent" } },
  },
  {
    sessionUpdate: "agent_message_chunk",
    messageId: "astraflow-attempt-1",
    content: { type: "text", text: "" },
    _meta: {
      astraflow: {
        engine: "pi-agent",
        retry: {
          phase: "start",
          attempt: 1,
          maxAttempts: 3,
          delayMs: 2000,
          errorMessage: "Stream ended without finish_reason",
        },
      },
    },
  },
  {
    sessionUpdate: "agent_message_chunk",
    messageId: "astraflow-attempt-2",
    content: { type: "text", text: "recovered answer" },
    _meta: { astraflow: { engine: "pi-agent" } },
  },
  {
    sessionUpdate: "session_info_update",
    title: "ACP resumed session",
    updatedAt: "2026-07-07T00:00:00.000Z",
  },
] satisfies SessionUpdate[]

export const expectedAcpAgentEvents = [
  { type: "text_delta", delta: "Launching Codex subagent." },
  { type: "reasoning_delta", delta: "Need Codex ACP coverage." },
  {
    type: "tool_call",
    id: "tool_codex_spawn",
    name: "spawn_agent",
    input: payload({
      prompt: "Reply exactly: subagent-ok: 2+2=4",
      senderThreadId: "thread_parent",
    }),
  },
  {
    type: "subagent_start",
    taskId: "tool_codex_spawn",
    name: "Subagent",
    taskInput: "Reply exactly: subagent-ok: 2+2=4",
    providerParentThreadId: "thread_parent",
  },
  {
    type: "subagent_end",
    taskId: "tool_codex_spawn",
    name: "Subagent",
    taskInput: "Reply exactly: subagent-ok: 2+2=4",
    providerThreadId: "thread_child",
    providerParentThreadId: "thread_parent",
    status: "complete",
    summary: "subagent-ok: 2+2=4",
  },
  {
    type: "tool_result",
    id: "tool_codex_spawn",
    name: "spawn_agent",
    status: "complete",
    output: payload({
      threadId: "thread_child",
      output: "subagent-ok: 2+2=4",
    }),
  },
  {
    type: "plan_update",
    todos: [
      {
        text: "Dispatch Codex subagent",
        status: "completed",
        priority: "high",
      },
      {
        text: "Verify returned summary",
        status: "in_progress",
        priority: "medium",
      },
    ],
  },
  {
    type: "tool_call",
    id: "tool_diff_new",
    name: "edit",
    input: payload({
      type: "diff",
      path: "/workspace/src/new.ts",
      oldText: null,
      newText: "created\n",
    }),
  },
  expectedFileChange({
    path: "src/new.ts",
    kind: "create",
    previousContent: null,
    nextContent: "created\n",
  }),
  {
    type: "tool_result",
    id: "tool_diff_new",
    name: "edit",
    status: "complete",
    output: payload({
      type: "diff",
      path: "/workspace/src/new.ts",
      oldText: null,
      newText: "created\n",
    }),
  },
  {
    type: "tool_call",
    id: "tool_diff_empty_edit",
    name: "edit",
    input: payload({
      type: "diff",
      path: "/workspace/src/empty.ts",
      oldText: "",
      newText: "filled\n",
    }),
  },
  expectedFileChange({
    path: "src/empty.ts",
    kind: "edit",
    previousContent: "",
    nextContent: "filled\n",
  }),
  {
    type: "tool_result",
    id: "tool_diff_empty_edit",
    name: "edit",
    status: "complete",
    output: payload({
      type: "diff",
      path: "/workspace/src/empty.ts",
      oldText: "",
      newText: "filled\n",
    }),
  },
  {
    type: "tool_call",
    id: "tool_diff_delete",
    name: "delete",
    input: payload({
      type: "diff",
      path: "/workspace/src/delete.ts",
      oldText: "gone\n",
      newText: "",
    }),
  },
  expectedFileChange({
    path: "src/delete.ts",
    kind: "delete",
    previousContent: "gone\n",
    nextContent: null,
  }),
  {
    type: "tool_result",
    id: "tool_diff_delete",
    name: "delete",
    status: "complete",
    output: payload({
      type: "diff",
      path: "/workspace/src/delete.ts",
      oldText: "gone\n",
      newText: "",
    }),
  },
  {
    type: "tool_call",
    id: "tool_claude_agent",
    name: "spawn_agent",
    input: payload({
      description: "Minimal smoke subagent",
      prompt: "Reply exactly: subagent-ok: 2+2=4",
    }),
  },
  {
    type: "subagent_start",
    taskId: "tool_claude_agent",
    name: "Minimal smoke subagent",
    taskInput: "Reply exactly: subagent-ok: 2+2=4",
  },
  {
    type: "subagent_end",
    taskId: "tool_claude_agent",
    name: "Minimal smoke subagent",
    taskInput: "Reply exactly: subagent-ok: 2+2=4",
    status: "complete",
    summary: "subagent-ok: 2+2=4",
  },
  {
    type: "tool_result",
    id: "tool_claude_agent",
    name: "spawn_agent",
    status: "complete",
    output: payload({
      result: "subagent-ok: 2+2=4",
    }),
  },
  { type: "text_delta", delta: "Claude subagent finished." },
  {
    type: "plan_update",
    todos: [
      {
        text: "Run Claude Agent tool",
        status: "completed",
        priority: "high",
      },
    ],
  },
  {
    type: "reasoning_delta",
    delta: "OpenCode task can arrive as an update.",
  },
  {
    type: "tool_call",
    id: "tool_opencode_task",
    name: "spawn_agent",
    input: payload({
      description: "Minimal smoke subagent",
      prompt: "Reply exactly: subagent-ok: 2+2=4",
    }),
  },
  {
    type: "subagent_start",
    taskId: "tool_opencode_task",
    name: "Minimal smoke subagent",
    taskInput: "Reply exactly: subagent-ok: 2+2=4",
  },
  {
    type: "subagent_end",
    taskId: "tool_opencode_task",
    name: "Minimal smoke subagent",
    taskInput: "Reply exactly: subagent-ok: 2+2=4",
    status: "complete",
    summary: "subagent-ok: 2+2=4",
  },
  {
    type: "tool_result",
    id: "tool_opencode_task",
    name: "spawn_agent",
    status: "complete",
    output: payload({
      task_result: "subagent-ok: 2+2=4",
    }),
  },
  { type: "text_delta", delta: "OpenCode task completed." },
  {
    type: "run_meta",
    metadata: {
      acp: {
        userMessageChunk: {
          type: "text",
          text: "replayed user message",
        },
      },
    },
  },
  {
    type: "text_delta",
    delta: "\n[resource: design.md file:///workspace/design.md]\n",
  },
  {
    type: "tool_call",
    id: "tool_diff_only",
    name: "edit",
    input: payload({
      type: "diff",
      path: "src/app.ts",
      oldText: "old",
      newText: "new",
    }),
  },
  expectedFileChange({
    path: "src/app.ts",
    kind: "edit",
    previousContent: "old",
    nextContent: "new",
  }),
  {
    type: "tool_result",
    id: "tool_diff_only",
    name: "edit",
    status: "complete",
    output: payload({
      type: "diff",
      path: "src/app.ts",
      oldText: "old",
      newText: "new",
    }),
  },
  {
    type: "tool_call",
    id: "tool_terminal",
    name: "execute",
    input: payload({
      type: "terminal",
      terminalId: "term_1",
    }),
  },
  {
    type: "tool_result",
    id: "tool_terminal",
    name: "execute",
    status: "complete",
    output: payload({
      type: "terminal",
      terminalId: "term_1",
    }),
  },
  {
    type: "tool_call",
    id: "tool_command",
    name: "execute",
    input: payload({
      command: "zsh -lic 'bun run typecheck'",
      cwd: "/workspace",
    }),
  },
  {
    type: "tool_output",
    id: "tool_command",
    name: "execute",
    output: "TypeScript ",
  },
  {
    type: "tool_output",
    id: "tool_command",
    name: "execute",
    output: "TypeScript failed.\n",
  },
  {
    type: "tool_result",
    id: "tool_command",
    name: "execute",
    status: "complete",
    output: payload({
      formatted_output: "TypeScript failed.\n",
      exit_code: 1,
    }),
  },
  {
    type: "tool_call",
    id: "tool_pi_bash",
    name: "execute",
    input: payload({
      command: "bun run build",
      cwd: "/workspace",
    }),
  },
  {
    type: "tool_output",
    id: "tool_pi_bash",
    name: "execute",
    output: "Compiling…",
  },
  {
    type: "tool_output",
    id: "tool_pi_bash",
    name: "execute",
    output: "Compiling…\nDone.",
  },
  {
    type: "tool_result",
    id: "tool_pi_bash",
    name: "execute",
    status: "complete",
    output: payload({
      content: [{ type: "text", text: "Compiling…\nDone." }],
    }),
  },
  {
    type: "tool_call",
    id: "tool_pi_write",
    name: "edit",
    input: payload({ title: "write" }),
  },
  {
    type: "tool_input",
    id: "tool_pi_write",
    name: "edit",
    input: '{"path":"notes.md"',
  },
  {
    type: "tool_input",
    id: "tool_pi_write",
    name: "edit",
    input: '{"path":"notes.md","content":"# Notes"',
  },
  {
    type: "tool_call",
    id: "tool_pi_write",
    name: "edit",
    input: payload({ path: "notes.md", content: "# Notes" }),
  },
  {
    type: "tool_result",
    id: "tool_pi_write",
    name: "edit",
    status: "complete",
    output: payload({
      content: [{ type: "text", text: "Wrote notes.md" }],
    }),
  },
  {
    type: "tool_call",
    id: "tool_mcp",
    name: "mcp_github__search",
    input: payload({
      server: "github",
      tool: "search",
      arguments: { query: "AstraFlow" },
    }),
  },
  {
    type: "tool_result",
    id: "tool_mcp",
    name: "mcp_github__search",
    status: "complete",
    output: payload({
      result: "ok",
      error: null,
    }),
  },
  {
    type: "plan_update",
    todos: [
      {
        text: "Map markdown plans",
        status: "completed",
      },
      {
        text: "Verify mapper",
        status: "pending",
      },
    ],
  },
  {
    type: "plan_update",
    todos: [
      {
        text: "Plan file: file:///workspace/PLAN.md",
        status: "in_progress",
      },
    ],
  },
  {
    type: "plan_update",
    todos: [],
  },
  {
    type: "available-commands",
    commands: [
      {
        name: "review",
        description: "Review the current changes",
        source: "runtime",
        inputHint: "optional scope",
      },
    ],
  },
  {
    type: "run_meta",
    metadata: {
      acp: {
        currentModeId: "agent",
      },
    },
  },
  {
    type: "run_meta",
    metadata: {
      acp: {
        configOptions: [
          {
            id: "fast",
            name: "Fast mode",
            type: "boolean",
            currentValue: true,
          },
        ],
      },
    },
  },
  {
    type: "text_delta",
    delta: "partial answer",
    messageId: "astraflow-attempt-1",
  },
  {
    type: "assistant_retry",
    phase: "start",
    messageId: "astraflow-attempt-1",
    channel: "text",
    attempt: 1,
    maxAttempts: 3,
    delayMs: 2000,
    errorMessage: "Stream ended without finish_reason",
  },
  {
    type: "text_delta",
    delta: "recovered answer",
    messageId: "astraflow-attempt-2",
  },
  {
    type: "run_meta",
    metadata: {
      acp: {
        sessionInfo: {
          sessionUpdate: "session_info_update",
          title: "ACP resumed session",
          updatedAt: "2026-07-07T00:00:00.000Z",
        },
      },
    },
    sessionTitle: "ACP resumed session",
  },
] satisfies AgentEvent[]

// Keep the long-lived replay fixture focused on the legacy event projection;
// structured ACP fields have dedicated accumulator/renderer assertions. This
// also makes additions to the lossless event model explicit without replacing
// the historical compatibility baseline wholesale.
function legacyAcpEventProjection(events: AgentEvent[]): AgentEvent[] {
  return events.flatMap((event): AgentEvent[] => {
    const metadata =
      event.type === "run_meta" && isRecord(event.metadata)
        ? event.metadata
        : null
    const acp = metadata && isRecord(metadata.acp) ? metadata.acp : null

    if (event.type === "run_meta" && acp && "sessionUpdateExtension" in acp) {
      return []
    }

    if (event.type === "tool_update") {
      return []
    }

    if (event.type === "content_block") {
      if (event.content.type !== "resource_link") {
        return []
      }

      return [
        {
          type: event.channel === "thought" ? "reasoning_delta" : "text_delta",
          delta: `\n[resource: ${event.content.name} ${event.content.uri}]\n`,
        } satisfies AgentEvent,
      ]
    }

    if (event.type === "plan_remove") {
      return [{ type: "plan_update", todos: [] } satisfies AgentEvent]
    }

    if (event.type === "plan_update") {
      if (event.variant === "file") {
        return [
          {
            type: "plan_update",
            todos: [
              {
                text: `Plan file: ${event.uri}`,
                status: "in_progress",
              },
            ],
          } satisfies AgentEvent,
        ]
      }

      return [{ type: "plan_update", todos: event.todos } satisfies AgentEvent]
    }

    if (
      event.type === "tool_call" ||
      event.type === "tool_result" ||
      event.type === "tool_input" ||
      event.type === "tool_output"
    ) {
      const legacy = { ...event } as AgentEvent & Record<string, unknown>

      for (const key of [
        "acpStatus",
        "content",
        "kind",
        "locations",
        "meta",
        "rawInput",
        "rawOutput",
        "title",
      ]) {
        delete legacy[key]
      }

      return [legacy]
    }

    return [event]
  })
}

export function evaluateAcpMapperFixture() {
  const updates = [
    ...codexAcpUpdates,
    ...claudeAcpUpdates,
    ...openCodeAcpUpdates,
    ...advancedAcpUpdates,
  ]

  const state = createAcpMapperReplayState()

  state.workspace = "/workspace"

  return {
    actual: legacyAcpEventProjection(
      mapAcpSessionUpdatesForReplay(updates, state)
    ),
    expected: expectedAcpAgentEvents,
  }
}

export function evaluateAcpRuntimeInfoFixture() {
  const baseInfo = {
    id: "codex",
    label: "Codex",
    description: "Codex ACP",
    capabilities: {
      hitl: true,
      resume: true,
      subagents: false,
      plan: true,
      sandbox: false,
      mcp: true,
      skills: true,
      compact: true,
    },
  } satisfies AgentRuntimeInfo

  return {
    actual: deriveAcpRuntimeInfoFromInitialize(baseInfo, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        sessionCapabilities: {
          resume: null,
        },
        _meta: {
          subagents: true,
          skills: false,
        },
      },
    }),
    expected: {
      ...baseInfo,
      capabilities: {
        ...baseInfo.capabilities,
        resume: false,
        subagents: true,
        skills: false,
      },
    },
  }
}
