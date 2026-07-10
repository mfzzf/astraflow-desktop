import type { AgentEvent } from "@/lib/agent/events"
import { mapOpenCodeNativeEvents } from "@/lib/agent/adapters/opencode-native-runtime"

const toolPartEvents = [
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_shell",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_shell",
        tool: "shell",
        state: { status: "pending", raw: '{"command":' },
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_shell",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_shell",
        tool: "shell",
        state: {
          status: "running",
          input: { command: "bun run lint", workdir: "packages/app" },
          metadata: { output: "Linting…\n" },
        },
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_todo_clear",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_todo_clear",
        tool: "todowrite",
        state: {
          status: "completed",
          input: { todos: [] },
          output: "Plan cleared.",
          metadata: {},
        },
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_shell",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_shell",
        tool: "shell",
        state: {
          status: "completed",
          input: { command: "bun run lint", workdir: "packages/app" },
          output: "Lint failed.\n",
          metadata: { exit: 1, output: "Lint failed.\n", truncated: false },
        },
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_todo",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_todo",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { content: "Inspect output", status: "completed" },
              { content: "Verify UI", status: "in_progress" },
            ],
          },
          output: "Plan updated.",
          metadata: {},
        },
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_edit",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_edit",
        tool: "edit",
        state: {
          status: "completed",
          input: {
            file_path: "/workspace/src/app.ts",
            old_string: "old",
            new_string: "new",
          },
          output: "Applied edit.",
          metadata: {
            filediff: {
              file: "/workspace/src/app.ts",
              patch: "@@ -1 +1 @@\n-old\n+new",
            },
          },
        },
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_task",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_task",
        tool: "task",
        state: {
          status: "running",
          input: {
            subagent_type: "explore",
            prompt: "Inspect the renderer.",
          },
          metadata: { sessionId: "ses_child" },
        },
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_child",
      part: {
        id: "part_child_text",
        sessionID: "ses_child",
        messageID: "msg_child",
        type: "text",
        text: "Inspecting structured output.",
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_task",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_task",
        tool: "task",
        state: {
          status: "completed",
          input: {
            subagent_type: "explore",
            prompt: "Inspect the renderer.",
          },
          output:
            '<task state="completed"><task_result>Renderer inspected.</task_result></task>',
          metadata: { sessionId: "ses_child" },
        },
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_shell_error",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_shell_error",
        tool: "shell",
        state: {
          status: "running",
          input: { command: "broken-command" },
          metadata: { output: "partial output\n" },
        },
      },
    },
  },
  {
    type: "message.part.updated",
    properties: {
      sessionID: "ses_root",
      part: {
        id: "part_shell_error",
        sessionID: "ses_root",
        messageID: "msg_assistant",
        type: "tool",
        callID: "call_shell_error",
        tool: "shell",
        state: {
          status: "error",
          input: { command: "broken-command" },
          error: { data: { message: "Unable to start command." } },
          metadata: { output: "partial output\n" },
        },
      },
    },
  },
]

const expectedToolPartEvents = [
  {
    type: "tool_call",
    id: "call_shell",
    name: "shell",
    input:
      '{\n  "command": "bun run lint",\n  "workdir": "packages/app",\n  "cwd": "/workspace/packages/app"\n}',
  },
  {
    type: "tool_output",
    id: "call_shell",
    name: "shell",
    output: "Linting…\n",
  },
  { type: "plan_update", todos: [] },
  {
    type: "tool_result",
    id: "call_shell",
    name: "shell",
    status: "complete",
    output:
      '{\n  "formatted_output": "Lint failed.\\n",\n  "exit_code": 1\n}',
  },
  {
    type: "plan_update",
    todos: [
      { text: "Inspect output", status: "completed" },
      { text: "Verify UI", status: "in_progress" },
    ],
  },
  {
    type: "tool_call",
    id: "call_edit",
    name: "edit_file",
    input:
      '{\n  "file_path": "/workspace/src/app.ts",\n  "old_string": "old",\n  "new_string": "new"\n}',
  },
  {
    type: "tool_result",
    id: "call_edit",
    name: "edit_file",
    status: "complete",
    output: "Applied edit.",
  },
  {
    type: "file_change",
    path: "src/app.ts",
    kind: "edit",
    status: "complete",
    diff: "@@ -1 +1 @@\n-old\n+new",
  },
  {
    type: "subagent_start",
    taskId: "ses_child",
    name: "explore",
    taskInput: "Inspect the renderer.",
  },
  {
    type: "subagent_update",
    taskId: "ses_child",
    contentDelta: "Inspecting structured output.",
    status: "running",
  },
  {
    type: "subagent_end",
    taskId: "ses_child",
    name: "explore",
    status: "complete",
    summary: "Renderer inspected.",
  },
  {
    type: "tool_call",
    id: "call_shell_error",
    name: "shell",
    input:
      '{\n  "command": "broken-command",\n  "cwd": "/workspace"\n}',
  },
  {
    type: "tool_output",
    id: "call_shell_error",
    name: "shell",
    output: "partial output\n",
  },
  {
    type: "tool_result",
    id: "call_shell_error",
    name: "shell",
    status: "error",
    output:
      '{\n  "formatted_output": "partial output\\n",\n  "exit_code": null\n}',
    error: "Unable to start command.",
  },
] satisfies AgentEvent[]

export function evaluateOpenCodeToolPartFixture() {
  return {
    actual: mapOpenCodeNativeEvents(toolPartEvents, {
      sessionId: "ses_root",
      workspace: "/workspace",
    }),
    expected: expectedToolPartEvents,
  }
}
