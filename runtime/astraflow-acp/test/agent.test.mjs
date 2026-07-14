import assert from "node:assert/strict"
import { readFile, rm, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  PROTOCOL_VERSION,
  client as createClientApp,
  methods,
} from "@agentclientprotocol/sdk"
import { FakeListChatModel } from "@langchain/core/utils/testing"

import {
  createAstraflowAcpApp,
  createRequestUserInputTool,
} from "../src/agent.mjs"
import { AcpPermissionBackend } from "../src/backend.mjs"
import { createAcpMcpTools } from "../src/mcp-tools.mjs"
import { readAstraflowRuntimeConfiguration } from "../src/model.mjs"

function configuration() {
  return {
    apiKey: "unit-test-secret-that-must-not-be-persisted",
    permissionMode: "auto",
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

function parser() {
  return { parse: (value) => value }
}

test("serves DeepAgents over ACP and resumes its persistent checkpoint", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-workspace-"))
  const stateRoot = await mkdtemp(path.join(tmpdir(), "astraflow-acp-state-"))
  const updates = []
  const mcpEvents = []
  const { app, runtime } = createAstraflowAcpApp({
    configuration: configuration(),
    workspaceRoot: workspace,
    stateRoot,
    modelFactory: () =>
      new FakeListChatModel({ responses: ["sandbox deepagents ok"], sleep: 0 }),
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

      if (params.method === "tools/list") {
        return { tools: [] }
      }

      return {}
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
      assert.equal(initialized.agentInfo.version, "0.1.0")
      assert.equal(initialized.agentCapabilities.loadSession, true)
      assert.deepEqual(initialized.agentCapabilities.sessionCapabilities.resume, {})
      assert.equal(
        initialized.agentCapabilities._meta.astraflow.execution,
        "sandbox"
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
    })

    assert.match(
      updates
        .filter((update) => update.sessionUpdate === "agent_message_chunk")
        .map((update) => update.content.text)
        .join(""),
      /sandbox deepagents ok/
    )
    assert.deepEqual(mcpEvents, [
      ["connect", "studio:tools"],
      ["tools/list", "mcp-connection"],
      ["disconnect", "mcp-connection"],
    ])

    updates.length = 0
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
      assert.equal(listed.sessions.some((entry) => entry.sessionId === sessionId), true)
    })

    const stateFiles = await import("node:fs/promises").then((fs) =>
      fs.readdir(stateRoot)
    )
    const checkpoint = await readFile(path.join(stateRoot, stateFiles[0]), "utf8")

    assert.equal(checkpoint.includes(configuration().apiKey), false)
    assert.match(checkpoint, /Continue after reconnect/)
  } finally {
    runtime.shutdown()
    await rm(workspace, { recursive: true, force: true })
    await rm(stateRoot, { recursive: true, force: true })
  }
})

test("keeps file and terminal execution in the selected workspace behind ACP permission", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "astraflow-acp-backend-"))
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
      path: path.join(workspace, "result.txt"),
      filesUpdate: null,
    })
    const command = await backend.execute("pwd && test -f result.txt")

    assert.equal(command.exitCode, 0)
    assert.match(command.output, new RegExp(workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.equal(requests.length, 2)
    assert.equal(
      requests.every(([method]) => method === methods.client.session.requestPermission),
      true
    )
    assert.equal(process.env.ASTRAFLOW_MODELVERSE_API_KEY, undefined)
  } finally {
    await backend.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
  }
})

test("purges injected model credentials before tools can inherit the process environment", () => {
  const env = {
    ASTRAFLOW_ACP_MODEL_CONFIG: JSON.stringify(configuration().model),
    ASTRAFLOW_MODELVERSE_API_KEY: configuration().apiKey,
    ASTRAFLOW_PERMISSION_MODE: "auto",
    OPENAI_API_KEY: "must-also-be-removed",
    ANTHROPIC_API_KEY: "must-also-be-removed",
  }
  const resolved = readAstraflowRuntimeConfiguration(env)

  assert.equal(resolved.apiKey, configuration().apiKey)
  assert.equal(resolved.model.providerModel, "test-model")
  assert.equal(resolved.permissionMode, "auto")
  assert.equal(env.ASTRAFLOW_ACP_MODEL_CONFIG, undefined)
  assert.equal(env.ASTRAFLOW_MODELVERSE_API_KEY, undefined)
  assert.equal(env.ASTRAFLOW_PERMISSION_MODE, undefined)
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.ANTHROPIC_API_KEY, undefined)
})

test("turns a failed ACP permission callback into a denied tool result", async () => {
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
    await backend.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
  }
})

test("bridges user input and Desktop MCP tools through ACP callbacks", async () => {
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
          content: [{ type: "text", text: `desktop:${params.params.arguments.text}` }],
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
      ([method, params]) => method === "mcp/message" && params.method === "tools/call"
    ),
    true
  )
  assert.equal(calls.at(-1)[0], "mcp/disconnect")
})
