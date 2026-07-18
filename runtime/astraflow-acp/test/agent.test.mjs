import assert from "node:assert/strict"
import {
  access,
  mkdir,
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
import { fileURLToPath } from "node:url"

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
  clientSupportsFormElicitation,
  createContextTransform,
  createAstraflowAcpApp,
  createRequestUserInputTool,
  createTaskTool,
  expandAstraflowSlashCommand,
  resolveAcpPromptStopReason,
  summarizePiSessionUsage,
} from "../src/agent.mjs"
import { AcpPermissionBackend } from "../src/backend.mjs"
import { ASTRAFLOW_ACP_STATE_SCHEMA_VERSION } from "../src/constants.mjs"
import { createAcpMcpTools } from "../src/mcp-tools.mjs"
import {
  createAstraflowPiModel,
  readAstraflowRuntimeConfiguration,
} from "../src/model.mjs"
import { AstraflowSessionStore } from "../src/session-store.mjs"

function configuration(permissionMode = "auto", execution = "sandbox") {
  return {
    apiKey: "unit-test-secret-that-must-not-be-persisted",
    execution,
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

test("gates form elicitation on the initialized client capabilities", () => {
  assert.equal(clientSupportsFormElicitation({}), false)
  assert.equal(clientSupportsFormElicitation({ elicitation: {} }), false)
  assert.equal(
    clientSupportsFormElicitation({ elicitation: { form: {} } }),
    true
  )
})

test("maps Pi completion limits to ACP stop reasons", () => {
  assert.equal(
    resolveAcpPromptStopReason({
      lastAssistantStopReason: "stop",
      signalAborted: false,
      turnLimitExhausted: true,
    }),
    "max_turn_requests"
  )
  assert.equal(
    resolveAcpPromptStopReason({
      lastAssistantStopReason: "length",
      signalAborted: false,
      turnLimitExhausted: false,
    }),
    "max_tokens"
  )
})

test("advertises executable slash commands and summarizes ACP usage", () => {
  assert.match(expandAstraflowSlashCommand("/status"), /Do not modify files/)
  assert.match(
    expandAstraflowSlashCommand("/review permissions"),
    /Focus on: permissions/
  )
  assert.match(
    expandAstraflowSlashCommand("/plan ship the fix"),
    /ship the fix/
  )

  const summary = summarizePiSessionUsage(
    [
      {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        usage: {
          input: 11,
          output: 7,
          cacheRead: 3,
          cacheWrite: 2,
          cost: { total: 0.01 },
        },
      },
    ],
    { contextWindow: 4096 }
  )

  assert.deepEqual(summary.promptUsage, {
    inputTokens: 11,
    outputTokens: 7,
    cachedReadTokens: 3,
    cachedWriteTokens: 2,
    totalTokens: 23,
  })
  assert.equal(summary.update.size, 4096)
  assert.equal(summary.update.cost.amount, 0.01)
})

async function checkpointAt(stateRoot) {
  const [name] = await readdir(stateRoot)

  return JSON.parse(await readFile(path.join(stateRoot, name), "utf8"))
}

test("replays complete ACP history before session/load returns", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-load-"))
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-load-state-")
  )
  const sessionId = "load-replay-session"
  const store = new AstraflowSessionStore({ root: stateRoot })
  const assistant = fauxAssistantMessage(
    [
      fauxThinking("historic thought"),
      fauxText("historic answer"),
      fauxToolCall("read", { path: "fixture.txt" }, { id: "historic-tool" }),
    ],
    { stopReason: "toolUse", timestamp: 2 }
  )

  await store.save({
    schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
    sessionId,
    cwd: await realpath(workspace),
    history: [
      { role: "user", content: "historic prompt", timestamp: 1 },
      assistant,
      {
        role: "toolResult",
        toolCallId: "historic-tool",
        toolName: "read",
        content: [{ type: "text", text: "historic result" }],
        isError: false,
        timestamp: 3,
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    title: "Historic session",
  })

  const { modelFactory } = fauxRuntime([])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })
  const updates = []
  let loadReturned = false
  const client = createClientApp({
    name: "astraflow-acp-load-client",
  }).onNotification(methods.client.session.update, ({ params }) => {
    assert.equal(loadReturned, false)
    updates.push(params.update)
  })

  try {
    await client.connectWith(app, async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const loaded = await agent.request(methods.agent.session.load, {
        sessionId,
        cwd: workspace,
        additionalDirectories: [],
        mcpServers: [],
      })

      loadReturned = true
      assert.equal(loaded.modes.currentModeId, "default")
      assert.equal(Array.isArray(loaded.configOptions), true)
      assert.deepEqual(
        updates.map((update) => update.sessionUpdate),
        [
          "user_message_chunk",
          "agent_thought_chunk",
          "agent_message_chunk",
          "tool_call",
          "tool_call_update",
          "available_commands_update",
        ]
      )
      assert.deepEqual(
        updates.at(-1).availableCommands.map((command) => command.name),
        ["status", "review", "plan"]
      )

      updates.length = 0
      loadReturned = false
      await agent.request(methods.agent.session.resume, {
        sessionId,
        cwd: workspace,
        additionalDirectories: [],
        mcpServers: [],
      })
      loadReturned = true
      assert.deepEqual(
        updates.map((update) => update.sessionUpdate),
        ["available_commands_update"]
      )
    })
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("implements ACP session modes, config, pagination, and idempotent lifecycle", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-list-"))
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-list-state-")
  )
  const additionalRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-extra-")
  )
  const store = new AstraflowSessionStore({ root: stateRoot })

  for (let index = 0; index < 52; index += 1) {
    const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()

    await store.save({
      schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
      sessionId: `listed-${index}`,
      cwd: await realpath(workspace),
      additionalDirectories: [await realpath(additionalRoot)],
      history: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      title: `Listed ${index}`,
    })
  }

  const { modelFactory } = fauxRuntime([])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })
  const updates = []
  const client = createClientApp({
    name: "astraflow-acp-list-client",
  }).onNotification(methods.client.session.update, ({ params }) => {
    updates.push(params.update)
  })

  try {
    await client.connectWith(app, async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      const first = await agent.request(methods.agent.session.list, {
        cwd: workspace,
      })
      const second = await agent.request(methods.agent.session.list, {
        cwd: workspace,
        cursor: first.nextCursor,
      })

      assert.equal(first.sessions.length, 50)
      assert.equal(second.sessions.length, 2)
      assert.equal(typeof first.nextCursor, "string")
      assert.equal(first.sessions[0].title, "Listed 51")
      assert.deepEqual(first.sessions[0].additionalDirectories, [
        await realpath(additionalRoot),
      ])
      await assert.rejects(
        agent.request(methods.agent.session.list, {
          cwd: workspace,
          cursor: "not-an-acp-cursor",
        })
      )

      const created = await agent.request(methods.agent.session.new, {
        cwd: workspace,
        additionalDirectories: [additionalRoot],
        mcpServers: [],
        _meta: {
          astraflow: { desktopSessionId: "desktop-created" },
        },
      })

      assert.equal(created.modes.currentModeId, "default")
      assert.equal(
        created._meta.astraflow.desktopSessionId,
        "desktop-created"
      )
      assert.deepEqual(
        created.configOptions.map((option) => option.id),
        ["mode", "model", "thought_level"]
      )
      await agent.request(methods.agent.session.setMode, {
        sessionId: created.sessionId,
        modeId: "default",
      })
      const thinking = created.configOptions.find(
        (option) => option.id === "thought_level"
      )
      const configured = await agent.request(
        methods.agent.session.setConfigOption,
        {
          sessionId: created.sessionId,
          configId: "thought_level",
          value: thinking.options[0].value,
        }
      )

      assert.equal(configured.configOptions.length, 3)
      assert.equal(
        updates.some(
          (update) => update.sessionUpdate === "current_mode_update"
        ),
        true
      )
      assert.equal(
        updates.some(
          (update) =>
            update.sessionUpdate === "config_option_update" &&
            update.configOptions.length === 3
        ),
        true
      )
      await agent.request(methods.agent.session.close, {
        sessionId: created.sessionId,
      })
      await agent.request(methods.agent.session.close, {
        sessionId: created.sessionId,
      })
      const resumed = await agent.request(methods.agent.session.resume, {
        sessionId: created.sessionId,
        cwd: workspace,
        additionalDirectories: [additionalRoot],
        mcpServers: [],
        _meta: {
          astraflow: { desktopSessionId: "desktop-resumed" },
        },
      })
      assert.equal(
        resumed._meta.astraflow.desktopSessionId,
        "desktop-resumed"
      )
      assert.equal(
        resumed.configOptions.find(
          (option) => option.id === "thought_level"
        ).currentValue,
        thinking.options[0].value
      )
      await agent.request(methods.agent.session.delete, {
        sessionId: created.sessionId,
      })
      await agent.request(methods.agent.session.delete, {
        sessionId: created.sessionId,
      })
      assert.equal(await store.load(created.sessionId), null)
    })
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
    await rm(additionalRoot, { recursive: true, force: true })
  }
})

test("configures the required ACP LLM provider without exposing secrets", async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-provider-")
  )
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-provider-state-")
  )
  const observedRequests = []
  const core = createFauxCore({})

  core.setResponses([
    (_context, options, _state, model) => {
      observedRequests.push({
        apiKey: options.apiKey,
        model: structuredClone(model),
      })
      return fauxAssistantMessage("provider one")
    },
    (_context, options, _state, model) => {
      observedRequests.push({
        apiKey: options.apiKey,
        model: structuredClone(model),
      })
      return fauxAssistantMessage("provider two")
    },
    (_context, options, _state, model) => {
      observedRequests.push({
        apiKey: options.apiKey,
        model: structuredClone(model),
      })
      return fauxAssistantMessage("provider three")
    },
  ])

  const modelFactory = (runtimeConfiguration) => ({
    model: {
      ...core.getModel(),
      baseUrl: runtimeConfiguration.model.baseUrl,
      headers: runtimeConfiguration.model.headers,
    },
    thinkingLevel: "off",
    streamFn: core.streamSimple,
  })
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })
  const updates = []
  const client = createClientApp({
    name: "astraflow-acp-provider-client",
  }).onNotification(methods.client.session.update, ({ params }) => {
    updates.push(params.update)
  })

  try {
    await client.connectWith(app, async (agent) => {
      const initialized = await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })

      assert.deepEqual(initialized.authMethods, [])
      assert.equal(initialized.agentCapabilities.auth, undefined)
      assert.deepEqual(initialized.agentCapabilities.providers, {})

      const listed = await agent.request(methods.agent.providers.list, {})

      assert.equal(listed.providers[0].required, true)
      assert.equal(JSON.stringify(listed).includes("Authorization"), false)
      await assert.rejects(
        agent.request(methods.agent.providers.set, {
          providerId: "astraflow-modelverse",
          apiType: "openai",
          baseUrl: "https://user:password@custom.invalid/v1",
        })
      )
      await assert.rejects(
        agent.request(methods.agent.providers.set, {
          providerId: "astraflow-modelverse",
          apiType: "openai",
          baseUrl: "https://custom.invalid/v1?api_key=secret",
        })
      )

      await agent.request(methods.agent.providers.set, {
        providerId: "astraflow-modelverse",
        apiType: "openai",
        baseUrl: "https://custom.invalid/v1",
        headers: {
          Authorization: "Bearer process-only-secret",
          "x-route": "first",
        },
      })
      const created = await agent.request(methods.agent.session.new, {
        cwd: workspace,
        mcpServers: [],
      })
      await agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "use provider one" }],
      })

      assert.equal(
        observedRequests[0].model.baseUrl,
        "https://custom.invalid/v1"
      )
      assert.equal(
        observedRequests[0].model.headers.Authorization,
        "Bearer process-only-secret"
      )
      assert.equal(observedRequests[0].apiKey, "acp-provider-header-auth")
      assert.notEqual(observedRequests[0].apiKey, configuration().apiKey)
      const redacted = await agent.request(methods.agent.providers.list, {})

      assert.equal(
        JSON.stringify(redacted).includes("process-only-secret"),
        false
      )

      await agent.request(methods.agent.providers.set, {
        providerId: "astraflow-modelverse",
        apiType: "anthropic",
        baseUrl: "https://anthropic.invalid",
        headers: { "x-route": "second" },
      })
      await agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "use provider two" }],
      })

      assert.equal(observedRequests[1].model.api, "anthropic-messages")
      assert.equal(observedRequests[1].model.headers.Authorization, null)
      assert.equal(observedRequests[1].model.headers["x-api-key"], null)
      assert.equal(observedRequests[1].model.headers["x-route"], "second")
      assert.notEqual(observedRequests[1].apiKey, configuration().apiKey)
      assert.equal(
        updates.some(
          (update) =>
            update.sessionUpdate === "config_option_update" &&
            update.configOptions.length === 3
        ),
        true
      )

      await agent.request(methods.agent.providers.set, {
        providerId: "astraflow-modelverse",
        apiType: "openai",
        baseUrl: "https://unauthenticated.invalid/v1",
      })
      await agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "use provider three" }],
      })

      assert.equal(observedRequests[2].model.headers.Authorization, null)
      assert.notEqual(observedRequests[2].apiKey, configuration().apiKey)
      await assert.rejects(
        agent.request(methods.agent.providers.disable, {
          providerId: "astraflow-modelverse",
        })
      )
      assert.deepEqual(
        await agent.request(methods.agent.providers.disable, {
          providerId: "unknown-provider",
        }),
        {}
      )
    })

    const checkpoint = await checkpointAt(stateRoot)

    assert.equal(
      JSON.stringify(checkpoint).includes("process-only-secret"),
      false
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("serves Pi Agent over ACP, injects AGENTS.md, and resumes Pi message history", async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-workspace-")
  )
  const stateRoot = await mkdtemp(path.join(tmpdir(), "astraflow-acp-state-"))
  const skillProjection = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-skills-")
  )
  const skillRoot = path.join(skillProjection, ".agents", "skills", "pptx")
  const skillFile = path.join(skillRoot, "SKILL.md")
  const updates = []
  const mcpEvents = []
  const contexts = []

  await writeFile(
    path.join(workspace, "AGENTS.md"),
    "# Project rules\n\nAlways preserve the fixture.\n"
  )
  await mkdir(path.join(skillRoot, "scripts"), { recursive: true })
  await writeFile(
    skillFile,
    "---\nname: pptx\ndescription: Create and validate PPTX files.\n---\n"
  )
  await writeFile(
    path.join(skillRoot, "scripts", "structural_qa.py"),
    "print('ok')\n"
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
        clientCapabilities: { elicitation: { form: {} } },
      })

      assert.equal(initialized.protocolVersion, PROTOCOL_VERSION)
      assert.equal(initialized.agentInfo.version, "0.1.0")
      assert.equal(initialized.agentCapabilities.loadSession, true)
      assert.equal(initialized.agentCapabilities.promptCapabilities.image, true)
      assert.equal(
        initialized.agentCapabilities._meta.astraflow.execution,
        "sandbox"
      )
      assert.deepEqual(
        initialized.agentCapabilities.sessionCapabilities.resume,
        {}
      )
      assert.deepEqual(
        initialized.agentCapabilities.sessionCapabilities.additionalDirectories,
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
      assert.equal(
        initialized.agentCapabilities._meta.astraflow.features.includes(
          "native-skills"
        ),
        true
      )

      const created = await agent.request(methods.agent.session.new, {
        cwd: workspace,
        additionalDirectories: [skillProjection],
        mcpServers: [
          { type: "acp", name: "desktop_tools", serverId: "studio:tools" },
        ],
      })

      sessionId = created.sessionId
      const commandsUpdate = updates.find(
        (update) => update.sessionUpdate === "available_commands_update"
      )

      assert.deepEqual(
        commandsUpdate.availableCommands.map((command) => command.name),
        ["status", "review", "plan"]
      )
      const result = await agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [
          { type: "text", text: "Reply from the sandbox" },
          {
            type: "image",
            data: Buffer.from("fixture-image").toString("base64"),
            mimeType: "image/png",
          },
        ],
      })

      assert.equal(result.stopReason, "end_turn")
      assert.equal(result._meta.astraflow.engine, "pi-agent")
      assert.equal(typeof result.usage.inputTokens, "number")
      assert.equal(typeof result.usage.outputTokens, "number")
      assert.equal(
        updates.some(
          (update) =>
            update.sessionUpdate === "usage_update" &&
            update.used >= 0 &&
            update.size > 0
        ),
        true
      )
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
    assert.equal(
      updates.some(
        (update) =>
          update.sessionUpdate === "session_info_update" &&
          update.title === "Reply from the sandbox"
      ),
      true
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
        additionalDirectories: [skillProjection],
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
    assert.equal(contexts[0].toolNames.includes("request_user_input"), true)
    assert.equal(contexts[1].toolNames.includes("request_user_input"), false)
    assert.match(contexts[0].systemPrompt, /Always preserve the fixture/)
    assert.match(contexts[0].systemPrompt, /web_fetch/)
    assert.match(contexts[0].systemPrompt, /studio_generate_image/)
    assert.match(contexts[0].systemPrompt, /download_file/)
    assert.match(contexts[0].systemPrompt, /<name>pptx<\/name>/)
    assert.match(
      contexts[0].systemPrompt,
      new RegExp(skillFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    )
    assert.match(
      contexts[0].systemPrompt,
      /resolve it against the skill directory/
    )
    assert.equal(
      contexts[0].messages.some(
        (message) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some(
            (entry) =>
              entry.type === "image" &&
              entry.mimeType === "image/png" &&
              entry.data === Buffer.from("fixture-image").toString("base64")
          )
      ),
      true
    )
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

    assert.equal(
      JSON.stringify(checkpoint).includes(configuration().apiKey),
      false
    )
    assert.equal(
      checkpoint.history.some(
        (message) =>
          message.role === "user" &&
          Array.isArray(message.content) &&
          message.content.some(
            (entry) =>
              entry.type === "text" && entry.text === "Continue after reconnect"
          )
      ),
      true
    )
    assert.equal(
      checkpoint.history.filter((message) => message.role === "assistant")
        .length,
      2
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
    await rm(skillProjection, { recursive: true, force: true })
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
  const contexts = []
  const originalWarn = console.warn
  const { modelFactory } = fauxRuntime([
    (context) => {
      contexts.push(context)
      return fauxAssistantMessage("reply without Desktop MCP")
    },
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
    assert.match(contexts[0].systemPrompt, /<unavailable_mcp_connectors>/)
    assert.match(contexts[0].systemPrompt, /- desktop_tools/)
    assert.equal(
      contexts[0].systemPrompt.includes("Desktop MCP bridge unavailable"),
      false
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
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-tools-state-")
  )
  const updates = []
  const { modelFactory } = fauxRuntime([
    fauxAssistantMessage(
      fauxToolCall(
        "plan",
        {
          todos: [
            { content: "Write the fixture", status: "in_progress" },
            {
              content: "Delegate verification",
              status: "pending",
              priority: "low",
            },
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
    fauxAssistantMessage(
      fauxToolCall(
        "read",
        { path: "result.txt" },
        { id: "subagent-read-call" }
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
  const client = createClientApp({
    name: "astraflow-acp-tools-client",
  }).onNotification(methods.client.session.update, ({ params }) => {
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

    assert.equal(
      await readFile(path.join(workspace, "result.txt"), "utf8"),
      "written by Pi\n"
    )
    assert.equal(
      updates.some(
        (update) =>
          update.sessionUpdate === "plan" &&
          update.entries[0].content === "Write the fixture" &&
          update.entries[0].priority === "medium" &&
          update.entries[1].priority === "low"
      ),
      true
    )
    assert.equal(
      updates.some(
        (update) =>
          update.sessionUpdate === "tool_call" &&
          update.toolCallId === "subagent-read-call" &&
          update.kind === "read" &&
          update._meta?.astraflow?.parentTaskId === "task-call"
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
    const toolCallCreateCounts = new Map()

    for (const update of updates) {
      if (update.sessionUpdate === "tool_call") {
        toolCallCreateCounts.set(
          update.toolCallId,
          (toolCallCreateCounts.get(update.toolCallId) || 0) + 1
        )
      }
    }
    assert.equal(
      [...toolCallCreateCounts.values()].every((count) => count === 1),
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
  const skillRoot = await mkdtemp(path.join(tmpdir(), "astraflow-acp-skill-"))
  const skillFile = path.join(skillRoot, "SKILL.md")
  const permissionRequests = []

  await writeFile(path.join(outside, "secret.txt"), "outside")
  await writeFile(skillFile, "# Read-only skill\n")
  await mkdir(path.join(skillRoot, "scripts"), { recursive: true })
  await writeFile(
    path.join(skillRoot, "scripts", "validator.py"),
    "print('valid')\n"
  )
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
    readOnlyRoots: [skillRoot],
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
  const skillReadArgs = { path: skillFile }
  const skillRead = await backend.beforeToolCall({
    toolCall: { name: "read" },
    args: skillReadArgs,
  })
  const skillRelativeReadArgs = { path: "scripts/validator.py" }
  const skillRelativeRead = await backend.beforeToolCall({
    toolCall: { name: "read" },
    args: skillRelativeReadArgs,
  })
  const skillWrite = await backend.beforeToolCall({
    toolCall: { name: "write" },
    args: { path: skillFile, content: "changed" },
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
  const readonlyProductTools = await Promise.all(
    [
      "download_file",
      "list_installed_mcp_servers",
      "studio_get_media_generation",
      "studio_get_media_model_schema",
      "studio_list_image_models",
      "studio_list_media_generation_models",
      "studio_list_media_generations",
      "studio_list_video_models",
      "web_fetch",
      "web_search",
    ].map((name) =>
      readonly.beforeToolCall({
        toolCall: { name },
        args: {},
      })
    )
  )
  const readonlyGenerate = await readonly.beforeToolCall({
    toolCall: { name: "studio_generate_image" },
    args: { prompt: "blocked" },
  })

  try {
    assert.match(traversal.reason, /inside the selected workspace/)
    assert.match(symlinkEscape.reason, /inside the selected workspace/)
    assert.match(atPrefixEscape.reason, /workspace-relative path/)
    assert.match(fileUrlEscape.reason, /workspace-relative path/)
    assert.match(homeEscape.reason, /workspace-relative path/)
    assert.equal(safePath, undefined)
    assert.equal(
      safeArgs.path,
      path.join(await realpath(workspace), "safe.txt")
    )
    assert.equal(skillRead, undefined)
    assert.equal(skillReadArgs.path, await realpath(skillFile))
    assert.equal(skillRelativeRead, undefined)
    assert.equal(
      skillRelativeReadArgs.path,
      await realpath(path.join(skillRoot, "scripts", "validator.py"))
    )
    assert.match(skillWrite.reason, /active skill root/)
    assert.equal(await readFile(skillFile, "utf8"), "# Read-only skill\n")
    assert.equal(secretRead, undefined)
    assert.equal(readonlyShell, undefined)
    assert.equal(escapingShell, undefined)
    assert.equal(gitShell, undefined)
    assert.equal(permissionRequests.length, 4)
    assert.equal(
      permissionRequests[1][1].toolCall.rawInput.command,
      "rg TODO ."
    )
    assert.equal(
      permissionRequests[2][1].toolCall.rawInput.command,
      "cd / && printf unsafe > opt/astraflow/runtime-marker"
    )
    assert.equal(
      permissionRequests[3][1].toolCall.rawInput.command,
      "git status"
    )
    assert.match(readonlyWrite.reason, /read-only/)
    assert.equal(
      readonlyProductTools.every((result) => result === undefined),
      true
    )
    assert.match(readonlyGenerate.reason, /read-only/)
    await assert.rejects(access(path.join(workspace, "blocked.txt")), /ENOENT/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
    await rm(skillRoot, { recursive: true, force: true })
  }
})

test("purges credentials and maps AstraFlow model configuration to Pi", async () => {
  const env = {
    ASTRAFLOW_ACP_MODEL_CONFIG: JSON.stringify(configuration().model),
    ASTRAFLOW_ACP_EXECUTION: "local",
    ASTRAFLOW_MODELVERSE_API_KEY: configuration().apiKey,
    ASTRAFLOW_PERMISSION_MODE: "auto",
    OPENAI_API_KEY: "must-also-be-removed",
    ANTHROPIC_API_KEY: "must-also-be-removed",
  }
  const resolved = readAstraflowRuntimeConfiguration(env)
  const pi = createAstraflowPiModel(resolved)

  assert.equal(resolved.apiKey, configuration().apiKey)
  assert.equal(resolved.execution, "local")
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
  assert.deepEqual(await deepseek.onPayload({ enable_thinking: true }), {
    enable_thinking: true,
    reasoning_effort: "max",
  })

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
        messages: [{ role: "user", content: "test", timestamp: Date.now() }],
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

  const kimi = createAstraflowPiModel({
    apiKey: "not-embedded",
    model: {
      ...configuration().model,
      id: "kimi-k3",
      providerModel: "kimi-k3",
      reasoning: true,
      reasoningEffort: "max",
      reasoningMode: "openai_reasoning_effort",
    },
  })
  let kimiPayload = null
  const kimiStream = streamSimple(
    kimi.model,
    {
      systemPrompt: "You are AstraFlow.",
      messages: [{ role: "user", content: "test", timestamp: Date.now() }],
    },
    {
      apiKey: "capture-only",
      maxTokens: 32_768,
      reasoning: kimi.thinkingLevel,
      onPayload(value) {
        kimiPayload = value
        throw new Error("payload captured")
      },
    }
  )

  await kimiStream.result()
  assert.equal(kimi.model.compat.supportsDeveloperRole, false)
  assert.equal(kimi.model.compat.supportsReasoningEffort, false)
  assert.equal(kimi.model.compat.supportsStore, false)
  assert.equal(kimi.model.compat.maxTokensField, "max_tokens")
  assert.equal(kimiPayload.messages[0].role, "system")
  assert.equal(kimiPayload.max_tokens, 32_768)
  assert.equal("max_completion_tokens" in kimiPayload, false)
  assert.equal("reasoning_effort" in kimiPayload, false)
  assert.equal("store" in kimiPayload, false)

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

test("advertises and prompts for local execution from the same ACP runtime", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-local-"))
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-local-state-")
  )
  const { modelFactory } = fauxRuntime([])
  const { runtime } = createAstraflowAcpApp({
    configuration: configuration("auto", "local"),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })

  try {
    const initialized = runtime.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })

    assert.equal(initialized.agentInfo.title, "AstraFlow Agent (Local)")
    assert.equal(
      initialized.agentCapabilities._meta.astraflow.execution,
      "local"
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
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
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-pi-state-")
  )
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
      store.save({
        ...record,
        schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION - 1,
      }),
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
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-bounded-state-")
  )
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
    assert.equal(
      loaded.history.at(-1).toolCallId,
      toolResults.at(-1).toolCallId
    )
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

test("does not retry non-transient Pi task-subagent provider failures", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-task-error-"))
  const { core } = fauxRuntime([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "insufficient_quota: billing quota exceeded",
    }),
  ])
  const tool = createTaskTool({
    backend: { beforeToolCall: async () => undefined },
    client: { notify: async () => undefined },
    cwd: workspace,
    getApiKey: () => "unit-test",
    getTools: () => [],
    model: core.getModel(),
    retrySettings: { maxRetries: 3, baseDelayMs: 1 },
    sessionId: "task-error-session",
    streamFn: core.streamSimple,
    systemPrompt: "Fail deterministically.",
    thinkingLevel: "off",
  })

  try {
    await assert.rejects(
      tool.execute(
        "task-error-call",
        { task: "Return the configured provider failure." },
        new AbortController().signal
      ),
      /insufficient_quota/
    )
    assert.equal(core.state.callCount, 1)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("cancels a Pi task-subagent retry backoff without another model call", async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "astraflow-task-retry-cancel-")
  )
  const abortController = new AbortController()
  let markRetryStarted
  const retryStarted = new Promise((resolve) => {
    markRetryStarted = resolve
  })
  const { core } = fauxRuntime([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "Stream ended without finish_reason",
    }),
  ])
  const tool = createTaskTool({
    backend: { beforeToolCall: async () => undefined },
    client: {
      notify: async (_method, { update }) => {
        if (update._meta?.astraflow?.retry?.phase === "start") {
          markRetryStarted()
        }
      },
    },
    cwd: workspace,
    getApiKey: () => "unit-test",
    getTools: () => [],
    model: core.getModel(),
    retrySettings: { maxRetries: 3, baseDelayMs: 5000 },
    sessionId: "task-retry-cancel-session",
    streamFn: core.streamSimple,
    systemPrompt: "Cancel transient provider retries.",
    thinkingLevel: "off",
  })

  try {
    const result = tool.execute(
      "task-retry-cancel-call",
      { task: "Cancel during the configured retry backoff." },
      abortController.signal
    )

    await retryStarted
    abortController.abort(new Error("Task cancellation requested."))
    await assert.rejects(result, /Task cancellation requested/)
    assert.equal(core.state.callCount, 1)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test("retries transient Pi task-subagent failures through AgentSession", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-task-retry-"))
  const updates = []
  const { core } = fauxRuntime([
    fauxAssistantMessage([fauxText("partial subagent draft")], {
      stopReason: "error",
      errorMessage: "Stream ended without finish_reason",
    }),
    fauxAssistantMessage([fauxText("recovered subagent report")]),
  ])
  const tool = createTaskTool({
    backend: { beforeToolCall: async () => undefined },
    client: {
      notify: async (_method, { update }) => {
        if (update._meta?.astraflow?.retry?.phase === "start") {
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        updates.push(update)
      },
    },
    cwd: workspace,
    getApiKey: () => "unit-test",
    getTools: () => [],
    model: core.getModel(),
    retrySettings: { maxRetries: 1, baseDelayMs: 1 },
    sessionId: "task-retry-session",
    streamFn: core.streamSimple,
    systemPrompt: "Retry transient provider failures.",
    thinkingLevel: "off",
  })

  try {
    const result = await tool.execute(
      "task-retry-call",
      { task: "Recover from the configured transient failure." },
      new AbortController().signal
    )

    assert.equal(core.state.callCount, 2)
    assert.match(result.content[0].text, /recovered subagent report/)
    const retry = updates.find(
      (update) => update._meta?.astraflow?.retry?.phase === "start"
    )
    const partial = updates.find(
      (update) =>
        update.messageId === retry?.messageId && Boolean(update.content.text)
    )
    const recovered = updates.find(
      (update) =>
        update.sessionUpdate === "agent_thought_chunk" &&
        update.messageId !== retry?.messageId &&
        Boolean(update.content.text)
    )

    assert.ok(partial, JSON.stringify(updates))
    assert.ok(retry, JSON.stringify(updates))
    assert.ok(recovered, JSON.stringify(updates))
    assert.equal(retry.messageId, partial.messageId)
    assert.notEqual(recovered.messageId, partial.messageId)
    assert.equal(retry._meta.astraflow.parentTaskId, "task-retry-call")
    assert.ok(updates.indexOf(retry) < updates.indexOf(recovered))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
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

test("uses Desktop permission feedback as the tool denial reason", async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-permission-feedback-")
  )
  const backend = new AcpPermissionBackend({
    client: {
      request: async () => ({
        outcome: {
          outcome: "selected",
          optionId: "reject_once",
          _meta: {
            astraflowFeedback: "Keep generated files out of this folder.",
          },
        },
      }),
    },
    cwd: workspace,
    permissionMode: "ask",
    sessionId: "permission-feedback-session",
  })

  try {
    assert.equal(
      await backend.permissionDenial("write", {
        path: "result.txt",
        content: "no",
      }),
      "Keep generated files out of this folder."
    )
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
    mcpServers: [{ type: "acp", name: "desktop", serverId: "studio:desktop" }],
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

test("connects to standard stdio MCP servers", async () => {
  const signal = new AbortController().signal
  const mcp = await createAcpMcpTools({
    client: null,
    cwd: process.cwd(),
    sessionId: "stdio-mcp-session",
    signal,
    mcpServers: [
      {
        name: "stdio_fixture",
        command: process.execPath,
        args: [
          fileURLToPath(
            new URL("./fixtures/stdio-mcp-server.mjs", import.meta.url)
          ),
        ],
        env: [],
      },
    ],
  })

  try {
    assert.deepEqual(mcp.failures, [])
    assert.equal(mcp.tools.length, 1)
    assert.equal(mcp.tools[0].name, "stdio_echo")
    assert.equal(await mcp.tools[0].invoke({ value: "ok" }), "stdio:ok")
  } finally {
    await mcp.close()
  }
})

test("rejects unadvertised MCP transports during session setup", async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-unsupported-mcp-")
  )
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-unsupported-mcp-state-")
  )
  const { modelFactory } = fauxRuntime([])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
  })
  const client = createClientApp({ name: "unsupported-mcp-client" })

  try {
    await client.connectWith(app, async (agent) => {
      await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {},
      })
      await assert.rejects(
        agent.request(methods.agent.session.new, {
          cwd: workspace,
          mcpServers: [
            {
              type: "http",
              name: "unsupported-http",
              url: "https://example.invalid/mcp",
              headers: [],
            },
          ],
        }),
        (error) => {
          assert.match(error.message, /Invalid params.*Unsupported MCP server/)
          return true
        }
      )
    })
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("preserves every published AstraFlow host-tool name over ACP", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../host-tools-manifest.json", import.meta.url),
      "utf8"
    )
  )
  const expectedNames = Object.values(manifest.toolGroups).flat().sort()
  const signal = new AbortController().signal
  const client = {
    async request(method, params) {
      if (method === "mcp/connect") {
        return { connectionId: "host-tools-connection" }
      }

      if (method === "mcp/message" && params.method === "tools/list") {
        return {
          tools: expectedNames.map((name) => ({
            name,
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: true,
            },
          })),
        }
      }

      if (method === "mcp/disconnect") {
        return {}
      }

      throw new Error(`Unexpected ACP method ${method}`)
    },
  }
  const mcp = await createAcpMcpTools({
    client,
    sessionId: "host-tools-session",
    signal,
    mcpServers: [
      {
        type: "acp",
        name: manifest.server.name,
        serverId: manifest.server.serverId,
      },
    ],
  })

  try {
    assert.deepEqual(mcp.tools.map((tool) => tool.name).sort(), expectedNames)
    assert.equal(
      mcp.tools.some((tool) => tool.name === "studio_generate_image"),
      true
    )
    assert.equal(
      mcp.tools.some((tool) => tool.name === "studio_generate_video"),
      true
    )
  } finally {
    await mcp.close()
  }
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

test("does not retry non-transient Pi provider failures and persists them", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-error-"))
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-error-state-")
  )
  const { core, modelFactory } = fauxRuntime([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "insufficient_quota: billing quota exceeded",
    }),
  ])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
    agentSessionRetrySettings: { maxRetries: 3, baseDelayMs: 1 },
  })
  const client = createClientApp({
    name: "astraflow-acp-error-client",
  }).onNotification(methods.client.session.update, () => undefined)

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
          assert.match(error.data?.details || "", /insufficient_quota/)
          return true
        }
      )
    })

    assert.equal(core.state.callCount, 1)
    const checkpoint = await checkpointAt(stateRoot)
    assert.equal(
      checkpoint.history.some(
        (message) =>
          message.role === "assistant" &&
          message.stopReason === "error" &&
          message.errorMessage === "insufficient_quota: billing quota exceeded"
      ),
      true
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("retries transient Pi provider stream failures and completes the turn", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-retry-"))
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-retry-state-")
  )
  const { core, modelFactory } = fauxRuntime([
    fauxAssistantMessage([fauxText("partial draft")], {
      stopReason: "error",
      errorMessage: "Stream ended without finish_reason",
    }),
    fauxAssistantMessage([fauxText("recovered after retry")]),
  ])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
    agentSessionRetrySettings: { maxRetries: 1, baseDelayMs: 1 },
  })
  const updates = []
  const client = createClientApp({
    name: "astraflow-acp-retry-client",
  }).onNotification(methods.client.session.update, ({ params }) => {
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
        prompt: [{ type: "text", text: "Trigger transient failure" }],
      })

      assert.equal(result.stopReason, "end_turn")
    })

    assert.equal(core.state.callCount, 2)
    const retry = updates.find(
      (update) => update._meta?.astraflow?.retry?.phase === "start"
    )
    const partial = updates.find(
      (update) =>
        update.messageId === retry?.messageId && Boolean(update.content.text)
    )
    const recovered = updates.find(
      (update) =>
        update.sessionUpdate === "agent_message_chunk" &&
        update.messageId !== retry?.messageId &&
        Boolean(update.content.text)
    )

    assert.ok(partial, JSON.stringify(updates))
    assert.ok(retry, JSON.stringify(updates))
    assert.ok(recovered, JSON.stringify(updates))
    assert.equal(retry.messageId, partial.messageId)
    assert.notEqual(recovered.messageId, partial.messageId)

    const checkpoint = await checkpointAt(stateRoot)
    const assistantMessages = checkpoint.history.filter(
      (message) => message.role === "assistant"
    )
    assert.equal(
      assistantMessages.some((message) => message.stopReason === "error"),
      false
    )
    assert.equal(
      assistantMessages.some((message) =>
        message.content?.some(
          (part) =>
            part.type === "text" && part.text === "recovered after retry"
        )
      ),
      true
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("surfaces transient Pi provider failures after exhausting retries", async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-retry-exhausted-")
  )
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-retry-exhausted-state-")
  )
  const { core, modelFactory } = fauxRuntime([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "Stream ended without finish_reason",
    }),
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "Stream ended without finish_reason",
    }),
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "Stream ended without finish_reason",
    }),
  ])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
    agentSessionRetrySettings: { maxRetries: 2, baseDelayMs: 1 },
  })
  const client = createClientApp({
    name: "astraflow-acp-retry-exhausted-client",
  }).onNotification(methods.client.session.update, () => undefined)

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
          prompt: [{ type: "text", text: "Trigger persistent failure" }],
        }),
        (error) => {
          assert.match(error.message, /Internal error/)
          assert.match(
            error.data?.details || "",
            /Stream ended without finish_reason/
          )
          return true
        }
      )
    })

    assert.equal(core.state.callCount, 3)

    const checkpoint = await checkpointAt(stateRoot)
    assert.equal(
      checkpoint.history.some(
        (message) =>
          message.role === "assistant" &&
          message.stopReason === "error" &&
          message.errorMessage === "Stream ended without finish_reason"
      ),
      true
    )
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("cancels an AgentSession retry backoff without another model call", async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-retry-cancel-")
  )
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-retry-cancel-state-")
  )
  let markRetryStarted
  const retryStarted = new Promise((resolve) => {
    markRetryStarted = resolve
  })
  const { core, modelFactory } = fauxRuntime([
    fauxAssistantMessage([], {
      stopReason: "error",
      errorMessage: "Stream ended without finish_reason",
    }),
  ])
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory,
    agentSessionRetrySettings: { maxRetries: 3, baseDelayMs: 5000 },
  })
  const client = createClientApp({
    name: "astraflow-acp-retry-cancel-client",
  }).onNotification(methods.client.session.update, ({ params }) => {
    if (params.update._meta?.astraflow?.retry?.phase === "start") {
      markRetryStarted()
    }
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
      const prompt = agent.request(methods.agent.session.prompt, {
        sessionId: created.sessionId,
        prompt: [{ type: "text", text: "Cancel during retry backoff" }],
      })

      await retryStarted
      await agent.notify(methods.agent.session.cancel, {
        sessionId: created.sessionId,
      })
      const result = await prompt

      assert.equal(result.stopReason, "cancelled")
    })

    assert.equal(core.state.callCount, 1)
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("honors generic ACP request cancellation for an in-flight prompt", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-cancel-"))
  const stateRoot = await mkdtemp(
    path.join(tmpdir(), "astraflow-acp-cancel-state-")
  )
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
  const client = createClientApp({
    name: "astraflow-acp-cancel-client",
  }).onNotification(methods.client.session.update, () => undefined)

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
      const requestController = new AbortController()
      const prompt = agent.request(
        methods.agent.session.prompt,
        {
          sessionId: created.sessionId,
          prompt: [{ type: "text", text: "Wait for cancellation" }],
        },
        { cancellationSignal: requestController.signal }
      )

      await started
      requestController.abort(new Error("cancel through $/cancel_request"))
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
