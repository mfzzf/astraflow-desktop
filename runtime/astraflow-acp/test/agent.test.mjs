import assert from "node:assert/strict"
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  PROTOCOL_VERSION,
  client as createClientApp,
  methods,
} from "@agentclientprotocol/sdk"
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai"
import { streamSimple } from "@earendil-works/pi-ai/compat"

import {
  compactPiHistory,
  createContextTransform,
  createAstraflowAcpApp,
  createRequestUserInputTool,
  createTaskTool,
} from "../src/agent.mjs"
import { AcpPermissionBackend } from "../src/backend.mjs"
import { ASTRAFLOW_ACP_STATE_SCHEMA_VERSION } from "../src/constants.mjs"
import { createAcpMcpTools } from "../src/mcp-tools.mjs"
import {
  createAstraflowPiModel,
  readAstraflowRuntimeConfiguration,
} from "../src/model.mjs"
import { AstraflowSessionStore } from "../src/session-store.mjs"

function configuration(permissionMode = "auto") {
  return {
    apiKey: "unit-test-secret-that-must-not-be-persisted",
    permissionMode,
    model: {
      id: "test-model",
      label: "Test Model",
      providerModel: "test-model",
      protocol: "openai-chat",
      baseUrl: "https://example.invalid/v1",
      reasoningEffort: "none",
      reasoningMode: "openai_reasoning_effort",
    },
  }
}

function fauxRuntime(responses, options = {}) {
  const core = createFauxCore(options)

  core.setResponses(responses)

  return {
    core,
    modelFactory: () => ({
      model: core.getModel(),
      thinkingLevel: "off",
      streamFn: core.streamSimple,
    }),
  }
}

function parser() {
  return { parse: (value) => value }
}

async function checkpointAt(stateRoot) {
  const [name] = await readdir(stateRoot)

  return JSON.parse(await readFile(path.join(stateRoot, name), "utf8"))
}

test("serves Pi Agent over ACP, injects AGENTS.md, and resumes Pi message history", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-workspace-"))
  const stateRoot = await mkdtemp(path.join(tmpdir(), "astraflow-acp-state-"))
  const updates = []
  const mcpEvents = []
  const contexts = []

  await writeFile(
    path.join(workspace, "AGENTS.md"),
    "# Project rules\n\nAlways preserve the fixture.\n"
  )

  const { modelFactory } = fauxRuntime([
    (context) => {
      contexts.push({
        systemPrompt: context.systemPrompt,
        messages: structuredClone(context.messages),
        toolNames: context.tools.map((tool) => tool.name),
      })
      return fauxAssistantMessage([
        fauxThinking("checking project instructions"),
        fauxText("sandbox pi ok"),
      ])
    },
    (context) => {
      contexts.push({
        systemPrompt: context.systemPrompt,
        messages: structuredClone(context.messages),
        toolNames: context.tools.map((tool) => tool.name),
      })
      return fauxAssistantMessage("resumed pi history ok")
    },
  ])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })
  const client = createClientApp({ name: "astraflow-acp-test-client" })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update)
    })
    .onRequest(methods.client.session.requestPermission, () => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }))
    .onRequest(methods.client.elicitation.create, () => ({
      action: "accept",
      content: { answer: "test" },
    }))
    .onRequest("mcp/connect", parser(), ({ params }) => {
      mcpEvents.push(["connect", params.serverId])
      return { connectionId: "mcp-connection" }
    })
    .onRequest("mcp/message", parser(), ({ params }) => {
      mcpEvents.push([params.method, params.connectionId])
      return params.method === "tools/list" ? { tools: [] } : {}
    })
    .onRequest("mcp/disconnect", parser(), ({ params }) => {
      mcpEvents.push(["disconnect", params.connectionId])
      return {}
    })

  let sessionId

  try {
    await client.connectWith(app, async (agent) => {
      const initialized = await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })

      assert.equal(initialized.protocolVersion, PROTOCOL_VERSION)
      assert.equal(initialized.agentInfo.version, "0.1.1")
      assert.equal(initialized.agentCapabilities.loadSession, true)
      assert.deepEqual(
        initialized.agentCapabilities.sessionCapabilities.resume,
        {}
      )
      assert.equal(
        initialized.agentCapabilities._meta.astraflow.features.includes(
          "pi-agent"
        ),
        true
      )
      assert.equal(
        initialized.agentCapabilities._meta.astraflow.features.includes(
          "pi-coding-tools"
        ),
        true
      )

      const created = await agent.request(methods.agent.session.new, {
        cwd: workspace,
        mcpServers: [
          { type: "acp", name: "desktop_tools", serverId: "studio:tools" },
        ],
      })

      sessionId = created.sessionId
      const result = await agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "Reply from the sandbox" }],
      })

      assert.equal(result.stopReason, "end_turn")
      assert.equal(result._meta.astraflow.engine, "pi-agent")
    })

    assert.match(
      updates
        .filter((update) => update.sessionUpdate === "agent_message_chunk")
        .map((update) => update.content.text)
        .join(""),
      /sandbox pi ok/
    )
    assert.match(
      updates
        .filter((update) => update.sessionUpdate === "agent_thought_chunk")
        .map((update) => update.content.text)
        .join(""),
      /checking project instructions/
    )
    assert.deepEqual(mcpEvents, [
      ["connect", "studio:tools"],
      ["tools/list", "mcp-connection"],
      ["disconnect", "mcp-connection"],
    ])

    await client.connectWith(app, async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      await agent.request(methods.agent.session.resume, {
        sessionId,
        cwd: workspace,
        mcpServers: [],
      })
      const result = await agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: "Continue after reconnect" }],
      })

      assert.equal(result.stopReason, "end_turn")
      const listed = await agent.request(methods.agent.session.list, {
        cwd: workspace,
      })
      assert.equal(
        listed.sessions.some((entry) => entry.sessionId === sessionId),
        true
      )
    })

    assert.match(contexts[0].systemPrompt, /powered by Pi Agent/)
    assert.match(contexts[0].systemPrompt, /Always preserve the fixture/)
    assert.equal(
      contexts[1].messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some(
            (entry) => entry.type === "text" && entry.text === "sandbox pi ok"
          )
      ),
      true
    )
    const checkpoint = await checkpointAt(stateRoot)

    assert.equal(JSON.stringify(checkpoint).includes(configuration().apiKey), false)
    assert.equal(
      checkpoint.history.some(
        (message) =>
          message.role === "user" &&
          message.content === "Continue after reconnect"
      ),
      true
    )
    assert.equal(
      checkpoint.history.filter((message) => message.role === "assistant").length,
      2
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("continues a Pi prompt when Desktop MCP tools are unavailable", async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-mcp-fallback-")
  )
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-mcp-state-")
  )
  const updates = []
  const warnings = []
  const originalWarn = console.warn
  const { modelFactory } = fauxRuntime([
    fauxAssistantMessage("reply without Desktop MCP"),
  ])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })
  const client = createClientApp({ name: "astraflow-acp-mcp-fallback-client" })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update)
    })
    .onRequest("mcp/connect", parser(), () => {
      throw new Error("Desktop MCP bridge unavailable")
    })

  console.warn = (...args) => warnings.push(args)

  try {
    await client.connectWith(app, async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const created = await agent.request(methods.agent.session.new, {
        cwd: workspace,
        mcpServers: [
          { type: "acp", name: "desktop_tools", serverId: "studio:tools" },
        ],
      })
      const result = await agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "Reply without MCP tools" }],
      })

      assert.equal(result.stopReason, "end_turn")
    })

    assert.match(
      updates
        .filter((update) => update.sessionUpdate === "agent_message_chunk")
        .map((update) => update.content.text)
        .join(""),
      /reply without Desktop MCP/
    )
    assert.equal(
      warnings.some(
        ([message, failure]) =>
          message === "[astraflow-acp] desktop_mcp_connection_failed" &&
          failure.serverId === "studio:tools"
      ),
      true
    )
  } finally {
    console.warn = originalWarn
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("streams Pi planning, coding-tool diffs, and task subagents over ACP", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-tools-"))
  const stateRoot = await mkdtemp(path.join(tmpdir(), "astraflow-acp-tools-state-"))
  const updates = []
  const { modelFactory } = fauxRuntime([
    fauxAssistantMessage(
      fauxToolCall(
        "plan",
        {
          todos: [
            { content: "Write the fixture", status: "in_progress" },
            { content: "Delegate verification", status: "pending" },
          ],
        },
        { id: "plan-call" }
      ),
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage(
      fauxToolCall(
        "write",
        { path: "result.txt", content: "written by Pi\n" },
        { id: "write-call" }
      ),
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage(
      fauxToolCall(
        "task",
        { task: "Verify that result.txt exists and report briefly." },
        { id: "task-call" }
      ),
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage([
      fauxThinking("subagent verification thinking"),
      fauxText("subagent verified the fixture"),
    ]),
    fauxAssistantMessage("primary agent finished"),
  ])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })
  const client = createClientApp({ name: "astraflow-acp-tools-client" })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update)
    })

  try {
    await client.connectWith(app, async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const created = await agent.request(methods.agent.session.new, {
        cwd: workspace,
        mcpServers: [],
      })
      const result = await agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "Exercise Pi tools" }],
      })

      assert.equal(result.stopReason, "end_turn")
    })

    assert.equal(await readFile(path.join(workspace, "result.txt"), "utf8"), "written by Pi\n")
    assert.equal(
      updates.some(
        (update) =>
          update.sessionUpdate === "plan" &&
          update.entries[0].content === "Write the fixture"
      ),
      true
    )
    assert.equal(
      updates.some(
        (update) =>
          update.sessionUpdate === "tool_call" &&
          update.toolCallId === "task-call" &&
          update.kind === "think"
      ),
      true
    )
    assert.equal(
      updates.some(
        (update) =>
          update.sessionUpdate === "tool_call_update" &&
          update.toolCallId === "write-call" &&
          update.content?.some(
            (entry) =>
              entry.type === "diff" && entry.newText === "written by Pi\n"
          )
      ),
      true
    )
    const subagentText = updates
      .filter(
        (update) =>
          update.sessionUpdate === "agent_thought_chunk" &&
          update._meta?.astraflow?.parentTaskId === "task-call"
      )
      .map((update) => update.content.text)
      .join("")

    assert.match(subagentText, /subagent verification thinking/)
    assert.match(subagentText, /subagent verified the fixture/)
    assert.match(
      updates
        .filter((update) => update.sessionUpdate === "agent_message_chunk")
        .map((update) => update.content.text)
        .join(""),
      /primary agent finished/
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("keeps Pi file and terminal execution behind ACP permission with a safe cwd", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-backend-"))
  const canonicalWorkspace = await realpath(workspace)
  const requests = []
  const backend = new AcpPermissionBackend({
    client: {
      async request(method, params) {
        requests.push([method, params])
        return { outcome: { outcome: "selected", optionId: "allow_once" } }
      },
    },
    cwd: workspace,
    permissionMode: "ask",
    sessionId: "permission-session",
    signal: new AbortController().signal,
  })

  try {
    await backend.ensureReady()
    assert.deepEqual(await backend.write("result.txt", "sandbox file\n"), {
      path: path.join(canonicalWorkspace, "result.txt"),
      filesUpdate: null,
    })
    const command = await backend.execute("pwd && test -f result.txt")

    assert.equal(command.exitCode, 0)
    assert.match(
      command.output,
      new RegExp(canonicalWorkspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    )
    assert.equal(requests.length, 2)
    assert.equal(
      requests.every(
        ([method]) => method === methods.client.session.requestPermission
      ),
      true
    )
  } finally {
    await backend.close()
    await rm(workspace, { recursive: true, force: true })
  }
})

test("blocks path escapes, prompts for unsafe shell commands, and protects secrets", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-paths-"))
  const outside = await mkdtemp(path.join(tmpdir(), "astraflow-acp-outside-"))
  const permissionRequests = []

  await writeFile(path.join(outside, "secret.txt"), "outside")
  await symlink(outside, path.join(workspace, "outside-link"))

  const backend = new AcpPermissionBackend({
    client: {
      async request(method, params) {
        permissionRequests.push([method, params])
        return { outcome: { outcome: "selected", optionId: "allow_once" } }
      },
    },
    cwd: workspace,
    permissionMode: "auto",
    sessionId: "path-session",
    signal: new AbortController().signal,
  })
  const traversal = await backend.beforeToolCall({
    toolCall: { name: "read" },
    args: { path: "../secret.txt" },
  })
  const symlinkEscape = await backend.beforeToolCall({
    toolCall: { name: "read" },
    args: { path: "outside-link/secret.txt" },
  })
  const atPrefixEscape = await backend.beforeToolCall({
    toolCall: { name: "read" },
    args: { path: "@/etc/hosts" },
  })
  const fileUrlEscape = await backend.beforeToolCall({
    toolCall: { name: "read" },
    args: { path: "file:///etc/hosts" },
  })
  const homeEscape = await backend.beforeToolCall({
    toolCall: { name: "read" },
    args: { path: "~/.ssh/config" },
  })
  const safeArgs = { path: "safe.txt" }
  const safePath = await backend.beforeToolCall({
    toolCall: { name: "read" },
    args: safeArgs,
  })
  const secretRead = await backend.beforeToolCall({
    toolCall: { name: "read" },
    args: { path: ".env.production" },
  })
  const readonlyShell = await backend.beforeToolCall({
    toolCall: { name: "bash" },
    args: { command: "rg TODO ." },
  })
  const escapingShell = await backend.beforeToolCall({
    toolCall: { name: "bash" },
    args: { command: "cd / && printf unsafe > opt/astraflow/runtime-marker" },
  })
  const gitShell = await backend.beforeToolCall({
    toolCall: { name: "bash" },
    args: { command: "git status" },
  })
  const readonly = new AcpPermissionBackend({
    client: backend.client,
    cwd: workspace,
    permissionMode: "readonly",
    sessionId: "readonly-session",
    signal: new AbortController().signal,
  })
  const readonlyWrite = await readonly.beforeToolCall({
    toolCall: { name: "write" },
    args: { path: "blocked.txt", content: "no" },
  })

  try {
    assert.match(traversal.reason, /inside the selected workspace/)
    assert.match(symlinkEscape.reason, /inside the selected workspace/)
    assert.match(atPrefixEscape.reason, /workspace-relative path/)
    assert.match(fileUrlEscape.reason, /workspace-relative path/)
    assert.match(homeEscape.reason, /workspace-relative path/)
    assert.equal(safePath, undefined)
    assert.equal(safeArgs.path, path.join(await realpath(workspace), "safe.txt"))
    assert.equal(secretRead, undefined)
    assert.equal(readonlyShell, undefined)
    assert.equal(escapingShell, undefined)
    assert.equal(gitShell, undefined)
    assert.equal(permissionRequests.length, 4)
    assert.equal(permissionRequests[1][1].toolCall.rawInput.command, "rg TODO .")
    assert.equal(
      permissionRequests[2][1].toolCall.rawInput.command,
      "cd / && printf unsafe > opt/astraflow/runtime-marker"
    )
    assert.equal(permissionRequests[3][1].toolCall.rawInput.command, "git status")
    assert.match(readonlyWrite.reason, /read-only/)
    await assert.rejects(access(path.join(workspace, "blocked.txt")), /ENOENT/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test("purges credentials and maps AstraFlow model configuration to Pi", async () => {
  const env = {
    ASTRAFLOW_ACP_MODEL_CONFIG: JSON.stringify(configuration().model),
    ASTRAFLOW_MODELVERSE_API_KEY: configuration().apiKey,
    ASTRAFLOW_PERMISSION_MODE: "auto",
    OPENAI_API_KEY: "must-also-be-removed",
    ANTHROPIC_API_KEY: "must-also-be-removed",
  }
  const resolved = readAstraflowRuntimeConfiguration(env)
  const pi = createAstraflowPiModel(resolved)

  assert.equal(resolved.apiKey, configuration().apiKey)
  assert.equal(resolved.model.providerModel, "test-model")
  assert.equal(resolved.permissionMode, "auto")
  assert.equal(env.ASTRAFLOW_ACP_MODEL_CONFIG, undefined)
  assert.equal(env.ASTRAFLOW_MODELVERSE_API_KEY, undefined)
  assert.equal(env.ASTRAFLOW_PERMISSION_MODE, undefined)
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.ANTHROPIC_API_KEY, undefined)
  assert.equal(pi.model.api, "openai-completions")
  assert.equal(pi.model.baseUrl, "https://example.invalid/v1")
  assert.equal(pi.model.compat.thinkingFormat, "openai")
  assert.equal(pi.model.reasoning, true)
  assert.equal(pi.thinkingLevel, "off")
  assert.equal(JSON.stringify(pi).includes(configuration().apiKey), false)

  const deepseek = createAstraflowPiModel({
    apiKey: "not-embedded",
    model: {
      ...configuration().model,
      reasoningEffort: "max",
      reasoningMode: "deepseek_reasoning_effort",
    },
  })

  assert.equal(deepseek.model.compat.thinkingFormat, "qwen")
  assert.equal(deepseek.thinkingLevel, "max")
  assert.deepEqual(
    await deepseek.onPayload({ enable_thinking: true }),
    { enable_thinking: true, reasoning_effort: "max" }
  )

  const anthropic = createAstraflowPiModel({
    apiKey: "not-embedded",
    model: {
      ...configuration().model,
      protocol: "anthropic-messages",
      baseUrl: "https://example.invalid/v1",
      reasoningEffort: "xhigh",
      reasoningMode: "anthropic_output_effort",
    },
  })

  assert.equal(anthropic.model.baseUrl, "https://example.invalid")
  assert.equal(anthropic.model.compat.forceAdaptiveThinking, true)
  assert.equal(anthropic.thinkingLevel, "xhigh")

  async function captureDisabledPayload(runtime) {
    let payload = null
    const stream = streamSimple(
      runtime.model,
      {
        systemPrompt: "",
        messages: [
          { role: "user", content: "test", timestamp: Date.now() },
        ],
      },
      {
        apiKey: "capture-only",
        onPayload(value) {
          payload = value
          throw new Error("payload captured")
        },
      }
    )

    await stream.result()
    return payload
  }

  assert.equal((await captureDisabledPayload(pi)).reasoning_effort, "none")

  const qwenOff = createAstraflowPiModel({
    apiKey: "not-embedded",
    model: {
      ...configuration().model,
      reasoning: true,
      reasoningMode: "qwen_thinking",
    },
  })
  const glmOff = createAstraflowPiModel({
    apiKey: "not-embedded",
    model: {
      ...configuration().model,
      reasoning: true,
      reasoningMode: "glm_thinking",
    },
  })

  assert.equal((await captureDisabledPayload(qwenOff)).enable_thinking, false)
  assert.deepEqual((await captureDisabledPayload(glmOff)).thinking, {
    type: "disabled",
  })
})

test("compacts oversized Pi history into a resumable summary", async () => {
  const core = createFauxCore({})
  const model = {
    ...core.getModel(),
    contextWindow: 10_000,
    maxTokens: 2_000,
  }
  const oldUser = {
    role: "user",
    content: "old context ".repeat(2_400),
    timestamp: 1,
  }
  const oldAssistant = fauxAssistantMessage("old answer")
  const recentUser = {
    role: "user",
    content: "recent request",
    timestamp: 3,
  }
  let summarizedMessages = null
  const compacted = await compactPiHistory({
    apiKey: "unit-test",
    messages: [oldUser, oldAssistant, recentUser],
    model,
    summarize: async (messages) => {
      summarizedMessages = messages
      return "Structured checkpoint"
    },
  })

  assert.deepEqual(summarizedMessages, [oldUser])
  assert.equal(compacted[0].role, "compactionSummary")
  assert.equal(compacted[0].summary, "Structured checkpoint")
  assert.equal(compacted[1], oldAssistant)
  assert.equal(compacted.at(-1), recentUser)

  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-compaction-state-")
  )
  const store = new AstraflowSessionStore({ root: stateRoot })

  try {
    await store.save({
      schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
      sessionId: "compacted-session",
      cwd: "/tmp/compacted-workspace",
      history: compacted,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    const loaded = await store.load("compacted-session")

    assert.equal(loaded.history[0].role, "compactionSummary")
    assert.equal(loaded.history[0].summary, "Structured checkpoint")
  } finally {
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("persists only the current Pi session schema and message contract", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "astraflow-acp-pi-state-"))
  const store = new AstraflowSessionStore({ root: stateRoot })
  const record = {
    schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
    sessionId: "pi-session",
    cwd: "/tmp/pi-workspace",
    history: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }

  try {
    await assert.rejects(
      store.save({ ...record, schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION - 1 }),
      /invalid AstraFlow ACP session/
    )
    await assert.rejects(
      store.save({
        ...record,
        history: [{ role: "user", content: "missing Pi timestamp" }],
      }),
      /invalid AstraFlow ACP session/
    )

    await store.save(record)
    assert.deepEqual(await store.load(record.sessionId), record)
  } finally {
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("keeps Pi tool-call groups intact when bounding persisted history", async () => {
  const stateRoot = await mkdtemp(path.join(tmpdir(), "astraflow-acp-bounded-state-"))
  const store = new AstraflowSessionStore({ root: stateRoot })
  const toolCalls = Array.from({ length: 401 }, (_, index) =>
    fauxToolCall("read", { path: `file-${index}.txt` }, { id: `call-${index}` })
  )
  const toolResults = toolCalls.map((toolCall, index) => ({
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: "text", text: `result-${index}` }],
    isError: false,
    timestamp: index + 3,
  }))
  const record = {
    schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
    sessionId: "bounded-pi-session",
    cwd: "/tmp/bounded-pi-workspace",
    history: [
      { role: "user", content: "read the files", timestamp: 1 },
      fauxAssistantMessage(toolCalls, { stopReason: "toolUse" }),
      ...toolResults,
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }

  try {
    await store.save(record)
    const loaded = await store.load(record.sessionId)

    assert.equal(loaded.history[0].role, "assistant")
    assert.equal(loaded.history[0].content.length, toolCalls.length)
    assert.equal(loaded.history.length, toolResults.length + 1)
    assert.equal(loaded.history.at(-1).toolCallId, toolResults.at(-1).toolCallId)
  } finally {
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("materializes in-turn Pi compaction before persisting history", async () => {
  const model = {
    id: "tiny-context-model",
    name: "Tiny Context Model",
    api: "openai-completions",
    provider: "faux",
    baseUrl: "https://example.invalid/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8_000,
    maxTokens: 2_000,
  }
  const original = [
    {
      role: "user",
      content: "old context ".repeat(2_400),
      timestamp: 1,
    },
    fauxAssistantMessage("old answer"),
    { role: "user", content: "recent request", timestamp: 3 },
  ]
  const transform = createContextTransform({
    apiKey: "unit-test",
    model,
    summarize: async () => "Persisted in-turn summary",
  })
  const compacted = await transform(original)
  const finalAssistant = fauxAssistantMessage("final answer")
  const persisted = transform.materialize([...original, finalAssistant])

  assert.equal(compacted[0].role, "compactionSummary")
  assert.equal(persisted[0].role, "compactionSummary")
  assert.equal(persisted[0].summary, "Persisted in-turn summary")
  assert.equal(persisted.includes(original[0]), false)
  assert.equal(persisted.at(-1), finalAssistant)
})

test("surfaces Pi task-subagent provider failures", async () => {
  const { core } = fauxRuntime([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "synthetic task-subagent failure",
    }),
  ])
  const tool = createTaskTool({
    backend: { beforeToolCall: async () => undefined },
    client: { notify: async () => undefined },
    getApiKey: () => "unit-test",
    getTools: () => [],
    model: core.getModel(),
    sessionId: "task-error-session",
    streamFn: core.streamSimple,
    systemPrompt: "Fail deterministically.",
    thinkingLevel: "off",
  })

  await assert.rejects(
    tool.execute(
      "task-error-call",
      { task: "Return the configured provider failure." },
      new AbortController().signal
    ),
    /synthetic task-subagent failure/
  )
})

test("turns a failed ACP permission callback into a denied Pi tool result", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-denied-"))
  const backend = new AcpPermissionBackend({
    client: {
      async request() {
        throw new Error("Desktop permission bridge disconnected")
      },
    },
    cwd: workspace,
    permissionMode: "ask",
    sessionId: "permission-error-session",
    signal: new AbortController().signal,
  })

  try {
    const result = await backend.write("denied.txt", "must not be written")

    assert.match(result.error, /Desktop permission bridge disconnected/)
    await assert.rejects(readFile(path.join(workspace, "denied.txt")), /ENOENT/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("bridges user input and Desktop MCP tools with Pi tool contracts", async () => {
  const calls = []
  const signal = new AbortController().signal
  const client = {
    async request(method, params) {
      calls.push([method, params])

      if (method === methods.client.elicitation.create) {
        return { action: "accept", content: { choice: "yes" } }
      }

      if (method === "mcp/connect") {
        return { connectionId: "mcp-1" }
      }

      if (method === "mcp/message" && params.method === "tools/list") {
        return {
          tools: [
            {
              name: "desktop_echo",
              description: "Echo through Desktop MCP",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
        }
      }

      if (method === "mcp/message" && params.method === "tools/call") {
        return {
          content: [
            { type: "text", text: `desktop:${params.params.arguments.text}` },
          ],
        }
      }

      if (method === "mcp/disconnect") {
        return {}
      }

      throw new Error(`Unexpected ACP method ${method}`)
    },
  }
  const inputTool = createRequestUserInputTool({
    client,
    sessionId: "input-session",
    signal,
  })
  const answer = await inputTool.invoke({
    questions: [{ id: "choice", question: "Continue?" }],
  })
  const mcp = await createAcpMcpTools({
    client,
    sessionId: "mcp-session",
    signal,
    mcpServers: [
      { type: "acp", name: "desktop", serverId: "studio:desktop" },
    ],
  })

  try {
    assert.match(answer, /yes/)
    assert.equal(mcp.tools.length, 1)
    assert.equal(mcp.tools[0].parameters.type, "object")
    assert.equal(await mcp.tools[0].invoke({ text: "ok" }), "desktop:ok")
  } finally {
    await mcp.close()
  }

  assert.equal(
    calls.some(([method]) => method === methods.client.elicitation.create),
    true
  )
  assert.equal(
    calls.some(
      ([method, params]) =>
        method === "mcp/message" && params.method === "tools/call"
    ),
    true
  )
  assert.equal(calls.at(-1)[0], "mcp/disconnect")
})

test("isolates MCP discovery failures and closes the failed connection", async () => {
  const calls = []
  const warnings = []
  const originalWarn = console.warn
  const signal = new AbortController().signal
  const client = {
    async request(method, params) {
      calls.push([method, params])

      if (method === "mcp/connect") {
        return { connectionId: `${params.serverId}-connection` }
      }

      if (method === "mcp/message" && params.method === "tools/list") {
        if (params.connectionId === "studio:broken-connection") {
          throw new Error("tools/list failed")
        }

        return {
          tools: [
            {
              name: "working_tool",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        }
      }

      if (method === "mcp/disconnect") {
        return {}
      }

      throw new Error(`Unexpected ACP method ${method}`)
    },
  }

  console.warn = (...args) => warnings.push(args)

  try {
    const mcp = await createAcpMcpTools({
      client,
      sessionId: "mcp-isolation-session",
      signal,
      mcpServers: [
        { type: "acp", name: "broken", serverId: "studio:broken" },
        { type: "acp", name: "working", serverId: "studio:working" },
      ],
    })

    try {
      assert.deepEqual(mcp.failures, [
        {
          name: "broken",
          serverId: "studio:broken",
          error: "tools/list failed",
        },
      ])
      assert.equal(mcp.tools.length, 1)
      assert.equal(mcp.tools[0].name, "working_tool")
      assert.equal(
        warnings.some(([, failure]) => failure.serverId === "studio:broken"),
        true
      )
      assert.equal(
        calls.some(
          ([method, params]) =>
            method === "mcp/disconnect" &&
            params.connectionId === "studio:broken-connection"
        ),
        true
      )
    } finally {
      await mcp.close()
    }

    assert.equal(
      calls.some(
        ([method, params]) =>
          method === "mcp/disconnect" &&
          params.connectionId === "studio:working-connection"
      ),
      true
    )
  } finally {
    console.warn = originalWarn
  }
})

test("still aborts MCP initialization when a Pi run is cancelled", async () => {
  const calls = []
  const signal = new AbortController().signal
  const client = {
    async request(method, params) {
      calls.push([method, params])

      if (method === "mcp/connect" && params.serverId === "studio:working") {
        return { connectionId: "working-connection" }
      }

      if (method === "mcp/message") {
        return { tools: [] }
      }

      if (method === "mcp/connect" && params.serverId === "studio:cancelled") {
        const error = new Error("The operation was aborted")

        error.name = "AbortError"
        throw error
      }

      if (method === "mcp/disconnect") {
        return {}
      }

      throw new Error(`Unexpected ACP method ${method}`)
    },
  }

  await assert.rejects(
    createAcpMcpTools({
      client,
      sessionId: "mcp-cancelled-session",
      signal,
      mcpServers: [
        { type: "acp", name: "working", serverId: "studio:working" },
        { type: "acp", name: "cancelled", serverId: "studio:cancelled" },
      ],
    }),
    { name: "AbortError" }
  )
  assert.equal(
    calls.some(
      ([method, params]) =>
        method === "mcp/disconnect" &&
        params.connectionId === "working-connection"
    ),
    true
  )
})

test("surfaces Pi provider failures and persists the failed assistant turn", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-error-"))
  const stateRoot = await mkdtemp(path.join(tmpdir(), "astraflow-acp-error-state-"))
  const { modelFactory } = fauxRuntime([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "provider unavailable",
    }),
  ])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })
  const client = createClientApp({ name: "astraflow-acp-error-client" })
    .onNotification(methods.client.session.update, () => undefined)

  try {
    await client.connectWith(app, async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const created = await agent.request(methods.agent.session.new, {
        cwd: workspace,
        mcpServers: [],
      })

      await assert.rejects(
        agent.request(methods.agent.session.prompt, {
          sessionId: created.sessionId,
          prompt: [{ type: "text", text: "Trigger provider failure" }],
        }),
        (error) => {
          assert.match(error.message, /Internal error/)
          assert.match(error.data?.details || "", /provider unavailable/)
          return true
        }
      )
    })

    const checkpoint = await checkpointAt(stateRoot)
    assert.equal(
      checkpoint.history.some(
        (message) =>
          message.role === "assistant" &&
          message.stopReason === "error" &&
          message.errorMessage === "provider unavailable"
      ),
      true
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("cancels an in-flight faux Pi provider deterministically", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-cancel-"))
  const stateRoot = await mkdtemp(path.join(tmpdir(), "astraflow-acp-cancel-state-"))
  let markStarted
  const started = new Promise((resolve) => {
    markStarted = resolve
  })
  const { modelFactory } = fauxRuntime([
    (_context, options) =>
      new Promise((resolve) => {
        const finish = () =>
          resolve(
            fauxAssistantMessage([], {
              stopReason: "aborted",
              errorMessage: "Request was aborted",
            })
          )

        markStarted()
        if (options?.signal?.aborted) {
          finish()
        } else {
          options?.signal?.addEventListener("abort", finish, { once: true })
        }
      }),
  ])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })
  const client = createClientApp({ name: "astraflow-acp-cancel-client" })
    .onNotification(methods.client.session.update, () => undefined)

  try {
    await client.connectWith(app, async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const created = await agent.request(methods.agent.session.new, {
        cwd: workspace,
        mcpServers: [],
      })
      const prompt = agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "Wait for cancellation" }],
      })

      await started
      await agent.notify(methods.agent.session.cancel, {
        sessionId: created.sessionId,
      })
      const result = await prompt

      assert.equal(result.stopReason, "cancelled")
    })

    const checkpoint = await checkpointAt(stateRoot)
    assert.equal(
      checkpoint.history.some(
        (message) =>
          message.role === "assistant" && message.stopReason === "aborted"
      ),
      true
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})
