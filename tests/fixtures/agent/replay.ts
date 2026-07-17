import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  evaluateAcpMapperFixture,
  evaluateAcpRuntimeInfoFixture,
} from "./acp/mapper-fixture"
import {
  codexDirectNotificationAgentEvents,
  codexDirectTurnAgentEvents,
  evaluateCodexDirectMapperFixture,
} from "./codex-direct/mapper-fixture"
import { evaluateClaudeNativeMapperFixture } from "./claude-native/mapper-fixture"
import { agentRuntimeVersionCompatibilityMatrix } from "./version-compatibility-matrix"
import expectedOpenCodeEvents from "./opencode-native/expected-agent-events.json"
import openCodeEvents from "./opencode-native/events.json"
import { evaluateOpenCodeToolPartFixture } from "./opencode-native/tool-part-fixture"
import { mapOpenCodeNativeEvents } from "@/lib/agent/adapters/opencode-native-runtime"
import { AGENT_RUNTIME_PROVIDER_METADATA } from "@/lib/agent/provider-metadata"
import { createSnapshotAccumulator } from "@/lib/agent/run-orchestrator"
import type { AgentFileChangeEvent } from "@/lib/agent/events"
import {
  getRunCommandActivityResult,
  getRunCommandPayload,
  getRunCommandResult,
  isCommandProcessResult,
} from "@/components/studio-message-parts/shared"

assert.ok(codexDirectNotificationAgentEvents.length > 0)
assert.ok(codexDirectTurnAgentEvents.length > 0)
const codexTurnDiffSnapshot = codexDirectNotificationAgentEvents.find(
  (event) => event.type === "file_changes_snapshot"
)

assert.ok(codexTurnDiffSnapshot)
assert.equal(codexTurnDiffSnapshot.source, "provider")
assert.deepEqual(
  codexTurnDiffSnapshot.changes.map((change) => [change.path, change.kind]),
  [["src/app.ts", "edit"]]
)
const codexLifecycleFileChanges = codexDirectNotificationAgentEvents.filter(
  (event): event is AgentFileChangeEvent =>
    event.type === "file_change" &&
    event.trace?.itemId === "patch_notification_fixture"
)

assert.equal(codexLifecycleFileChanges.length, 1)
assert.equal(codexLifecycleFileChanges[0]?.diff, "provider item final")

const codexDirectFixture = evaluateCodexDirectMapperFixture()
assert.deepEqual(codexDirectFixture.actual, codexDirectFixture.expected)

const claudeFixture = evaluateClaudeNativeMapperFixture()
assert.deepEqual(claudeFixture.actual, claudeFixture.expected)

const acpFixture = evaluateAcpMapperFixture()
assert.deepEqual(acpFixture.actual, acpFixture.expected)

const retryAccumulator = createSnapshotAccumulator()
retryAccumulator.handleEvent({
  type: "reasoning_delta",
  delta: "partial reasoning",
  messageId: "attempt-1",
})
retryAccumulator.handleEvent({
  type: "text_delta",
  delta: "partial answer",
  messageId: "attempt-1",
})
retryAccumulator.handleEvent({
  type: "assistant_retry",
  phase: "start",
  messageId: "attempt-1",
  channel: "text",
  attempt: 1,
  maxAttempts: 3,
  delayMs: 1,
})
retryAccumulator.handleEvent({
  type: "reasoning_delta",
  delta: "recovered reasoning",
  messageId: "attempt-2",
})
retryAccumulator.handleEvent({
  type: "text_delta",
  delta: "recovered answer",
  messageId: "attempt-2",
})
assert.equal(retryAccumulator.getSnapshot().content, "recovered answer")
assert.equal(
  retryAccumulator.getSnapshot().reasoningContent,
  "recovered reasoning"
)
assert.equal(
  retryAccumulator
    .getSnapshot()
    .parts.some(
      (part) => part.type === "text" && part.content === "partial answer"
    ),
  false
)
assert.equal(
  retryAccumulator
    .getSnapshot()
    .parts.some(
      (part) =>
        part.type === "reasoning" && part.content === "partial reasoning"
    ),
  false
)

const inputAccumulator = createSnapshotAccumulator()
inputAccumulator.handleEvent({
  type: "tool_call",
  id: "tool-streaming-input",
  name: "edit",
  input: JSON.stringify({ title: "write" }),
})
inputAccumulator.handleEvent({
  type: "tool_input",
  id: "tool-streaming-input",
  name: "edit",
  input: '{"path":"a.md"',
})
inputAccumulator.handleEvent({
  type: "tool_input",
  id: "tool-streaming-input",
  name: "edit",
  input: '{"path":"a.md","content":"# Hi"',
})
// The canonical tool_call must replace the streamed partial input text.
inputAccumulator.handleEvent({
  type: "tool_call",
  id: "tool-streaming-input",
  name: "edit",
  input: JSON.stringify({ path: "a.md", content: "# Hi" }),
})
assert.equal(
  inputAccumulator
    .getSnapshot()
    .activities.find((activity) => activity.id === "tool-streaming-input")
    ?.input,
  JSON.stringify({ path: "a.md", content: "# Hi" })
)

const acpRuntimeInfoFixture = evaluateAcpRuntimeInfoFixture()
assert.deepEqual(acpRuntimeInfoFixture.actual, acpRuntimeInfoFixture.expected)

assert.deepEqual(
  getRunCommandPayload(
    JSON.stringify({
      kind: "execute",
      title: "-lic 'bun run typecheck'",
      status: "in_progress",
      rawInput: {
        command: "zsh -lic 'bun run typecheck'",
        cwd: "/workspace",
      },
      content: [{ type: "terminal", terminalId: "tool_command" }],
    })
  ),
  {
    command: "zsh -lic 'bun run typecheck'",
    cwd: "/workspace",
  }
)
assert.deepEqual(
  getRunCommandPayload(
    JSON.stringify({ command: "bun run lint", workdir: "packages/app" })
  ),
  { command: "bun run lint", cwd: "packages/app" }
)
assert.deepEqual(
  getRunCommandResult(
    JSON.stringify({ formatted_output: "TypeScript failed.\n", exit_code: 1 })
  ),
  {
    output: "TypeScript failed.\n",
    stdout: "",
    stderr: "",
    exitCode: 1,
    interrupted: false,
    failed: true,
    isProcessResult: true,
  }
)
const legacyFailedCommand = {
  id: "legacy-command",
  toolName: "execute",
  status: "error" as const,
  input: "",
  output: "",
  error: JSON.stringify({
    formatted_output: "TypeScript failed.\n",
    exit_code: 1,
  }),
}
assert.equal(isCommandProcessResult(legacyFailedCommand), true)
assert.deepEqual(getRunCommandActivityResult(legacyFailedCommand), {
  output: "TypeScript failed.\n",
  stdout: "",
  stderr: "",
  exitCode: 1,
  interrupted: false,
  failed: true,
  isProcessResult: true,
  rawOutput: legacyFailedCommand.error,
})

const claudeStructuredFailure = {
  id: "claude-bash-failure",
  toolName: "execute",
  status: "error" as const,
  input: JSON.stringify({ command: "bun run typecheck", cwd: "/workspace" }),
  output: "",
  error: JSON.stringify({
    stdout: "Checked 42 files.\n",
    stderr: "TypeScript failed.\n",
    interrupted: false,
  }),
}
assert.equal(isCommandProcessResult(claudeStructuredFailure), true)
assert.deepEqual(getRunCommandActivityResult(claudeStructuredFailure), {
  output: "Checked 42 files.\nTypeScript failed.",
  stdout: "Checked 42 files.\n",
  stderr: "TypeScript failed.\n",
  exitCode: null,
  interrupted: false,
  failed: true,
  isProcessResult: true,
  rawOutput: claudeStructuredFailure.error,
})

const openCodeTransportFailure = {
  id: "opencode-shell-transport-failure",
  toolName: "shell",
  status: "error" as const,
  input: JSON.stringify({ command: "broken-command", cwd: "/workspace" }),
  output: JSON.stringify({
    formatted_output: "partial output\n",
    exit_code: null,
  }),
  error: "Unable to start command.",
}
assert.equal(isCommandProcessResult(openCodeTransportFailure), true)
assert.deepEqual(getRunCommandActivityResult(openCodeTransportFailure), {
  output: "partial output\nUnable to start command.",
  stdout: "",
  stderr: "",
  exitCode: null,
  interrupted: false,
  failed: true,
  isProcessResult: true,
  rawOutput: openCodeTransportFailure.output,
})

assert.deepEqual(
  mapOpenCodeNativeEvents(openCodeEvents, { sessionId: "ses_root" }),
  expectedOpenCodeEvents
)
const openCodeToolPartFixture = evaluateOpenCodeToolPartFixture()
assert.deepEqual(
  openCodeToolPartFixture.actual,
  openCodeToolPartFixture.expected
)

const packageJson = JSON.parse(
  readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const declaredDependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
}

for (const entry of agentRuntimeVersionCompatibilityMatrix) {
  assert.equal(
    declaredDependencies[entry.packageName],
    entry.version,
    `${entry.packageName} must stay pinned for ${entry.coverage}`
  )

  if (entry.packageName !== "@agentclientprotocol/sdk") {
    assert.ok(
      Object.values(AGENT_RUNTIME_PROVIDER_METADATA).some(
        (metadata) =>
          metadata.packageName === entry.packageName &&
          metadata.packageVersion === entry.version
      ),
      `${entry.packageName} must be represented in provider metadata`
    )
  }
}
