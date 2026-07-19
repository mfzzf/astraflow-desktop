import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { after, before } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"

import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client"
import { WebSocket } from "ws"

import { createWorkspaceGateway } from "../src/server.mjs"

const TOKEN = "workspace-gateway-test-token-000001"
const execFileAsync = promisify(execFile)
const fakeAgentScript = [
  'const readline = require("node:readline")',
  "const input = readline.createInterface({ input: process.stdin })",
  'input.on("line", (line) => {',
  "  const message = JSON.parse(line)",
  "  process.stdout.write(JSON.stringify({",
  '    jsonrpc: "2.0",',
  "    id: message.id,",
  "    result: {",
  "      cwd: process.cwd(),",
  "      defaultAuthRequest: process.env.DEFAULT_AUTH_REQUEST || null,",
  "      noBrowser: process.env.NO_BROWSER || null,",
  "      openaiApiKey: process.env.OPENAI_API_KEY || null,",
  "      hiddenValue: process.env.SECRET_SHOULD_DROP || null,",
  "      hasGatewayToken: Boolean(process.env.ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN),",
  "      path: process.env.PATH || null,",
  "    },",
  '  }) + "\\n")',
  "})",
].join("\n")
const fakeAstraflowAgentScript = [
  'const readline = require("node:readline")',
  "const input = readline.createInterface({ input: process.stdin })",
  'input.on("line", (line) => {',
  "  const message = JSON.parse(line)",
  "  process.stdout.write(JSON.stringify({",
  '    jsonrpc: "2.0",',
  "    id: message.id,",
  "    result: {",
  "      cwd: process.cwd(),",
  "      apiKey: process.env.ASTRAFLOW_MODELVERSE_API_KEY || null,",
  "      modelConfig: process.env.ASTRAFLOW_ACP_MODEL_CONFIG || null,",
  "      permissionMode: process.env.ASTRAFLOW_PERMISSION_MODE || null,",
  "      droppedOpenAIKey: process.env.OPENAI_API_KEY || null,",
  "      hasGatewayToken: Boolean(process.env.ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN),",
  "    },",
  '  }) + "\\n")',
  "})",
].join("\n")
const fakeClaudeAgentScript = [
  'const readline = require("node:readline")',
  "const input = readline.createInterface({ input: process.stdin })",
  "const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')",
  'input.on("line", (line) => {',
  "  const message = JSON.parse(line)",
  '  if (message.method === "session/new") {',
  "    send({",
  '      jsonrpc: "2.0",',
  "      id: message.id,",
  "      result: {",
  '        sessionId: "claude-sandbox-session",',
  '        modes: { currentModeId: "default", availableModes: [',
  '          { id: "default", name: "Manual" },',
  '          { id: "plan", name: "Plan Mode" },',
  "        ] },",
  "        configOptions: [{",
  '          id: "mode",',
  '          name: "Mode",',
  '          type: "select",',
  '          currentValue: "default",',
  '          options: [{ value: "default", name: "Manual" }, { value: "plan", name: "Plan Mode" }],',
  "        }],",
  "        receivedMeta: message.params?._meta || null,",
  "      },",
  "    })",
  "    send({",
  '      jsonrpc: "2.0",',
  '      method: "session/update",',
  "      params: {",
  '        sessionId: "claude-sandbox-session",',
  "        update: {",
  '          sessionUpdate: "available_commands_update",',
  "          availableCommands: [{",
  '            name: "plan",',
  '            description: "Enter plan mode",',
  '            input: { hint: "[description]", _meta: { source: "claude" } },',
  '            _meta: { claudeCode: { commandKind: "builtin" } },',
  "          }],",
  "        },",
  "      },",
  "    })",
  "    send({",
  '      jsonrpc: "2.0",',
  '      method: "_claude/sdkMessage",',
  "      params: {",
  '        sessionId: "claude-sandbox-session",',
  '        message: { type: "prompt_suggestion", suggestion: "Run the focused tests" },',
  "      },",
  "    })",
  "    return",
  "  }",
  '  if (message.method === "session/set_config_option") {',
  "    send({",
  '      jsonrpc: "2.0",',
  "      id: message.id,",
  "      result: {",
  "        configOptions: [{",
  '          id: "mode",',
  '          name: "Mode",',
  '          type: "select",',
  "          currentValue: message.params.value,",
  '          options: [{ value: "default", name: "Manual" }, { value: "plan", name: "Plan Mode" }],',
  "        }],",
  "      },",
  "    })",
  "    return",
  "  }",
  '  if (message.method === "session/prompt") {',
  "    send({",
  '      jsonrpc: "2.0",',
  "      id: message.id,",
  '      result: { stopReason: "end_turn", receivedPrompt: message.params.prompt },',
  "    })",
  "    return",
  "  }",
  "  send({",
  '    jsonrpc: "2.0",',
  "    id: message.id,",
  "    result: {",
  "      authToken: process.env.ANTHROPIC_AUTH_TOKEN || null,",
  "      baseUrl: process.env.ANTHROPIC_BASE_URL || null,",
  "      model: process.env.ANTHROPIC_MODEL || null,",
  "      droppedApiKey: process.env.ANTHROPIC_API_KEY || null,",
  "      hasGatewayToken: Boolean(process.env.ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN),",
  "    },",
  "  })",
  "})",
].join("\n")
const fakeOpenCodeAgentScript = [
  'const readline = require("node:readline")',
  "const input = readline.createInterface({ input: process.stdin })",
  'input.on("line", (line) => {',
  "  const message = JSON.parse(line)",
  "  const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT || '{}')",
  "  const provider = Object.values(config.provider || {})[0] || {}",
  "  process.stdout.write(JSON.stringify({",
  '    jsonrpc: "2.0",',
  "    id: message.id,",
  "    result: {",
  "      apiKey: process.env.ASTRAFLOW_MODELVERSE_API_KEY || null,",
  "      baseUrl: provider.options?.baseURL || null,",
  "      configApiKey: provider.options?.apiKey || null,",
  "      database: process.env.OPENCODE_DB || null,",
  "      droppedOpenAIKey: process.env.OPENAI_API_KEY || null,",
  "      hasGatewayToken: Boolean(process.env.ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN),",
  "    },",
  '  }) + "\\n")',
  "})",
].join("\n")

let baseUrl
let gateway
let workspaceRoot
let outsideFile

function authenticatedFetch(pathname, init = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...init.headers,
    },
  })
}

async function git(root, args) {
  return execFileAsync("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  })
}

async function createDirtyGitWorkspace(name, committed, current, untracked) {
  const root = path.join(workspaceRoot, name)

  await mkdir(root)
  await git(root, ["init", "-q"])
  await git(root, ["config", "user.name", "Gateway Test"])
  await git(root, ["config", "user.email", "gateway@example.test"])
  await writeFile(path.join(root, "tracked.txt"), committed)
  await git(root, ["add", "tracked.txt"])
  await git(root, ["commit", "-q", "-m", "initial"])
  await writeFile(path.join(root, "tracked.txt"), current)
  await writeFile(path.join(root, "untracked.txt"), untracked)

  return root
}

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "astraflow-gateway-workspace-"))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), "astraflow-gateway-outside-"))
  outsideFile = path.join(outsideRoot, "secret.txt")

  await writeFile(path.join(workspaceRoot, "hello.txt"), "hello gateway")
  await writeFile(path.join(workspaceRoot, ".env"), "VISIBLE=yes")
  await writeFile(path.join(workspaceRoot, ".hidden"), "hidden")
  await mkdir(path.join(workspaceRoot, "src"))
  await writeFile(path.join(workspaceRoot, "src", "index.mjs"), "export {}")
  await createDirtyGitWorkspace(
    "project-a",
    "project a before\n",
    "project a after\n",
    "project a new\n"
  )
  await createDirtyGitWorkspace(
    "project-b",
    "project b before\n",
    "project b after\n",
    "project b new\n"
  )
  await mkdir(path.join(workspaceRoot, "project-a", "nested"))
  await writeFile(outsideFile, "outside")
  await symlink(outsideFile, path.join(workspaceRoot, "outside-link.txt"))

  gateway = await createWorkspaceGateway({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    workspaceRoot,
    workspaceId: "workspace-test",
    sandboxId: "sandbox-test",
    templateVersion: "template-test",
    agentCommands: {
      astraflow: {
        command: process.execPath,
        args: ["-e", fakeAstraflowAgentScript],
        version: "0.1.0",
      },
      codex: {
        command: process.execPath,
        args: ["-e", fakeAgentScript],
        version: "test-runtime-1",
      },
      "claude-code": {
        command: process.execPath,
        args: ["-e", fakeClaudeAgentScript],
        version: "test-runtime-2",
      },
      opencode: {
        command: process.execPath,
        args: ["-e", fakeOpenCodeAgentScript],
        version: "test-runtime-3",
      },
    },
    terminalDisposeDelayMs: 100,
    terminalDetachedDisposeDelayMs: 100,
    webSocketHeartbeatIntervalMs: 20,
  })
  const address = await gateway.listen()

  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await gateway?.close()
  await rm(workspaceRoot, { recursive: true, force: true })
  await rm(path.dirname(outsideFile), { recursive: true, force: true })
})

test("exposes only the minimal unauthenticated health probe", async () => {
  const probe = await fetch(`${baseUrl}/healthz`)
  const unauthorized = await fetch(`${baseUrl}/v1/health`)

  assert.equal(probe.status, 200)
  assert.deepEqual(await probe.json(), { ok: true, status: "ok" })
  assert.equal(unauthorized.status, 401)
  assert.equal((await unauthorized.json()).error.code, "UNAUTHORIZED")
})

test("reports versioned workspace capabilities", async () => {
  const health = await authenticatedFetch("/v1/health")
  const workspace = await authenticatedFetch("/v1/workspace")

  assert.equal(health.status, 200)
  assert.deepEqual((await health.json()).data, {
    status: "ok",
    protocolVersion: 1,
    gatewayVersion: "0.4.0",
    templateVersion: "template-test",
    workspaceId: "workspace-test",
    sandboxId: "sandbox-test",
    agentRuntimes: [
      { id: "astraflow", available: true, version: "0.1.0" },
      { id: "codex", available: true, version: "test-runtime-1" },
      { id: "claude-code", available: true, version: "test-runtime-2" },
      { id: "opencode", available: true, version: "test-runtime-3" },
    ],
  })
  assert.deepEqual((await workspace.json()).data.capabilities, [
    "fs.entries",
    "fs.read",
    "git.review",
    "terminal.pty",
    "terminal.websocket-ticket",
    "agent.acp.websocket",
  ])
  assert.deepEqual(
    (await authenticatedFetch("/v1/workspace").then((value) => value.json()))
      .data.agentRuntimes,
    [
      { id: "astraflow", available: true, version: "0.1.0" },
      { id: "codex", available: true, version: "test-runtime-1" },
      { id: "claude-code", available: true, version: "test-runtime-2" },
      { id: "opencode", available: true, version: "test-runtime-3" },
    ]
  )
})

test("reviews Git changes inside one selected workspace directory", async () => {
  const projectA = await authenticatedFetch("/v1/git/review?path=project-a")
  const payload = await projectA.json()

  assert.equal(projectA.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.gitAvailable, true)
  assert.equal(typeof payload.data.git.branch, "string")
  assert.deepEqual(
    payload.data.files.map((file) => file.path).sort(),
    ["tracked.txt", "untracked.txt"]
  )
  assert.match(
    payload.data.files.find((file) => file.path === "tracked.txt").diff,
    /project a after/
  )
  assert.equal(
    payload.data.files.some((file) => file.diff?.includes("project b after")),
    false
  )

  const projectB = await authenticatedFetch("/v1/git/review?path=project-b")
  const projectBPayload = await projectB.json()

  assert.equal(projectB.status, 200)
  assert.match(
    projectBPayload.data.files.find((file) => file.path === "tracked.txt").diff,
    /project b after/
  )

  const nested = await authenticatedFetch(
    "/v1/git/review?path=project-a/nested"
  )
  const nestedPayload = await nested.json()

  assert.equal(nested.status, 200)
  assert.equal(nestedPayload.data.gitAvailable, false)
  assert.deepEqual(nestedPayload.data.files, [])
})

test("blocks Git review traversal and escaping directory symlinks", async () => {
  const outsideRoot = path.dirname(outsideFile)
  const outsideDirectoryLink = path.join(workspaceRoot, "outside-directory")

  await symlink(outsideRoot, outsideDirectoryLink, "dir")

  const traversal = await authenticatedFetch(
    "/v1/git/review?path=../outside"
  )
  const symlinkEscape = await authenticatedFetch(
    "/v1/git/review?path=outside-directory"
  )

  assert.equal(traversal.status, 400)
  assert.equal((await traversal.json()).error.code, "PATH_OUTSIDE_WORKSPACE")
  assert.equal(symlinkEscape.status, 403)
  assert.equal((await symlinkEscape.json()).error.code, "PATH_OUTSIDE_WORKSPACE")
})

test("lists workspace directories without exposing hidden or escaping entries", async () => {
  const root = await authenticatedFetch("/v1/fs/entries?path=")
  const child = await authenticatedFetch("/v1/fs/entries?path=src")
  const rootData = (await root.json()).data
  const childData = (await child.json()).data

  assert.equal(root.status, 200)
  assert.equal(rootData.path, "")
  assert.equal(rootData.parent, null)
  assert.deepEqual(
    rootData.entries.map((entry) => entry.name),
    ["project-a", "project-b", "src", ".env", "hello.txt"]
  )
  assert.equal(rootData.entries.find((entry) => entry.name === "src").kind, "directory")
  assert.equal(rootData.entries.some((entry) => entry.name === ".hidden"), false)
  assert.equal(rootData.entries.some((entry) => entry.name === "outside-link.txt"), false)
  assert.equal(childData.path, "src")
  assert.equal(childData.parent, "")
  assert.equal(childData.entries[0].path, "src/index.mjs")
})

test("reads files with ranges and blocks traversal or escaping symlinks", async () => {
  const file = await authenticatedFetch("/v1/fs/file?path=hello.txt")
  const head = await authenticatedFetch("/v1/fs/file?path=hello.txt", {
    method: "HEAD",
  })
  const range = await authenticatedFetch("/v1/fs/file?path=hello.txt", {
    headers: { range: "bytes=6-12" },
  })
  const traversal = await authenticatedFetch(
    "/v1/fs/file?path=../outside.txt"
  )
  const symlinkEscape = await authenticatedFetch(
    "/v1/fs/file?path=outside-link.txt"
  )

  assert.equal(file.status, 200)
  assert.equal(await file.text(), "hello gateway")
  assert.equal(head.status, 200)
  assert.equal(head.headers.get("content-length"), "13")
  assert.equal(await head.text(), "")
  assert.equal(range.status, 206)
  assert.equal(range.headers.get("content-range"), "bytes 6-12/13")
  assert.equal(await range.text(), "gateway")
  assert.equal(traversal.status, 400)
  assert.equal((await traversal.json()).error.code, "PATH_OUTSIDE_WORKSPACE")
  assert.equal(symlinkEscape.status, 403)
  assert.equal((await symlinkEscape.json()).error.code, "PATH_OUTSIDE_WORKSPACE")
})

test("proxies one-time ACP WebSockets to an allowlisted Sandbox Agent runtime", async () => {
  const created = await authenticatedFetch("/v1/agent-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtimeId: "codex",
      env: {
        DEFAULT_AUTH_REQUEST: '{"methodId":"api-key"}',
        NO_BROWSER: "1",
        OPENAI_API_KEY: "test-openai-key",
        SECRET_SHOULD_DROP: "not-forwarded",
        ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN: "not-forwarded",
      },
    }),
  })
  const connection = (await created.json()).data

  assert.equal(created.status, 201)

  const stream = createWebSocketStream(
    `${baseUrl.replace(/^http/, "ws")}${connection.websocketPath}`
  )
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()

  await writer.write({ jsonrpc: "2.0", id: 7, method: "initialize" })
  const response = await reader.read()

  assert.deepEqual(response.value.result, {
    cwd: gateway.config.workspaceRoot,
    defaultAuthRequest: '{"methodId":"api-key"}',
    noBrowser: "1",
    openaiApiKey: "test-openai-key",
    hiddenValue: null,
    hasGatewayToken: false,
    path: "/usr/local/bin:/usr/bin:/bin",
  })

  const replayStatus = await new Promise((resolve) => {
    const replay = new WebSocket(
      `${baseUrl.replace(/^http/, "ws")}${connection.websocketPath}`
    )

    replay.once("unexpected-response", (_request, response) => {
      resolve(response.statusCode)
      response.resume()
    })
    replay.once("open", () => {
      replay.close()
      resolve(101)
    })
    replay.on("error", () => undefined)
  })

  assert.equal(replayStatus, 401)
  await writer.close()
})

test("forwards only the restricted Claude gateway environment", async () => {
  const created = await authenticatedFetch("/v1/agent-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtimeId: "claude-code",
      env: {
        ANTHROPIC_AUTH_TOKEN: "short-lived-anthropic-token",
        ANTHROPIC_BASE_URL: "https://api.modelverse.cn",
        ANTHROPIC_MODEL: "claude-test-model",
        ANTHROPIC_API_KEY: "must-not-forward",
        ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN: "must-not-forward",
      },
    }),
  })
  const connection = (await created.json()).data
  const stream = createWebSocketStream(
    `${baseUrl.replace(/^http/, "ws")}${connection.websocketPath}`
  )
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()

  await writer.write({ jsonrpc: "2.0", id: 9, method: "initialize" })
  const response = await reader.read()
  const result = response.value.result

  assert.match(result.authToken, /^[a-f0-9-]{36}$/)
  assert.notEqual(result.authToken, "short-lived-anthropic-token")
  assert.match(result.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.deepEqual(
    {
      model: result.model,
      droppedApiKey: result.droppedApiKey,
      hasGatewayToken: result.hasGatewayToken,
    },
    {
      model: "claude-test-model",
      droppedApiKey: null,
      hasGatewayToken: false,
    }
  )
  const counted = await fetch(
    `${result.baseUrl}/v1/messages/count_tokens?beta=true`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${result.authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    }
  )

  assert.equal(counted.status, 200)
  assert.ok((await counted.json()).input_tokens > 0)
  assert.equal(gateway.agentManager.proxies.size, 1)
  await writer.close()

  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (gateway.agentManager.proxies.size === 0) {
        return
      }

      await delay(20)
    }

    throw new Error("Claude compatibility proxy was not reaped.")
  })
  await assert.rejects(
    fetch(`${result.baseUrl}/v1/messages/count_tokens`, {
      method: "POST",
      body: "{}",
    })
  )
})

test("preserves Claude commands, Plan controls, SDK events, and compact prompts over Sandbox ACP", async () => {
  const created = await authenticatedFetch("/v1/agent-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runtimeId: "claude-code", env: {} }),
  })
  const connection = (await created.json()).data
  const stream = createWebSocketStream(
    `${baseUrl.replace(/^http/, "ws")}${connection.websocketPath}`
  )
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  const sessionMeta = {
    claudeCode: {
      emitRawSDKMessages: [
        { type: "prompt_suggestion" },
        { type: "system", subtype: "hook_started" },
      ],
      options: {
        agentProgressSummaries: true,
        enableFileCheckpointing: true,
        includeHookEvents: true,
        promptSuggestions: true,
      },
    },
  }

  try {
    await writer.write({
      jsonrpc: "2.0",
      id: 12,
      method: "session/new",
      params: {
        cwd: gateway.config.workspaceRoot,
        mcpServers: [],
        _meta: sessionMeta,
      },
    })

    const newSession = (await reader.read()).value
    const commandUpdate = (await reader.read()).value
    const sdkMessage = (await reader.read()).value

    assert.equal(newSession.result.sessionId, "claude-sandbox-session")
    assert.deepEqual(newSession.result.receivedMeta, sessionMeta)
    assert.deepEqual(commandUpdate, {
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "claude-sandbox-session",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            {
              name: "plan",
              description: "Enter plan mode",
              input: {
                hint: "[description]",
                _meta: { source: "claude" },
              },
              _meta: { claudeCode: { commandKind: "builtin" } },
            },
          ],
        },
      },
    })
    assert.deepEqual(sdkMessage, {
      jsonrpc: "2.0",
      method: "_claude/sdkMessage",
      params: {
        sessionId: "claude-sandbox-session",
        message: {
          type: "prompt_suggestion",
          suggestion: "Run the focused tests",
        },
      },
    })

    await writer.write({
      jsonrpc: "2.0",
      id: 13,
      method: "session/set_config_option",
      params: {
        sessionId: "claude-sandbox-session",
        configId: "mode",
        value: "plan",
      },
    })
    assert.equal(
      (await reader.read()).value.result.configOptions[0].currentValue,
      "plan"
    )

    const compactPrompt = [
      { type: "text", text: "/compact focus on the implementation details" },
    ]

    await writer.write({
      jsonrpc: "2.0",
      id: 14,
      method: "session/prompt",
      params: {
        sessionId: "claude-sandbox-session",
        prompt: compactPrompt,
      },
    })
    assert.deepEqual(
      (await reader.read()).value.result.receivedPrompt,
      compactPrompt
    )
  } finally {
    await writer.close()
  }
})

test("keeps the OpenCode model key inside a per-run loopback proxy", async () => {
  const config = {
    model: "modelverse-openai/gpt-test",
    provider: {
      "modelverse-openai": {
        npm: "@ai-sdk/openai",
        options: {
          apiKey: "{env:ASTRAFLOW_MODELVERSE_API_KEY}",
          baseURL: "https://api.modelverse.cn/v1",
        },
      },
    },
  }
  const created = await authenticatedFetch("/v1/agent-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtimeId: "opencode",
      env: {
        ASTRAFLOW_MODELVERSE_API_KEY: "short-lived-modelverse-token",
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        OPENCODE_DB: "gateway-opencode.db",
        OPENAI_API_KEY: "must-not-forward",
        ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN: "must-not-forward",
      },
    }),
  })
  const connection = (await created.json()).data
  const stream = createWebSocketStream(
    `${baseUrl.replace(/^http/, "ws")}${connection.websocketPath}`
  )
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()

  await writer.write({ jsonrpc: "2.0", id: 10, method: "initialize" })
  const response = await reader.read()
  const result = response.value.result

  assert.match(result.apiKey, /^[a-f0-9-]{36}$/)
  assert.notEqual(result.apiKey, "short-lived-modelverse-token")
  assert.match(result.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/v1$/)
  assert.deepEqual(
    {
      configApiKey: result.configApiKey,
      database: result.database,
      droppedOpenAIKey: result.droppedOpenAIKey,
      hasGatewayToken: result.hasGatewayToken,
    },
    {
      configApiKey: "{env:ASTRAFLOW_MODELVERSE_API_KEY}",
      database: "gateway-opencode.db",
      droppedOpenAIKey: null,
      hasGatewayToken: false,
    }
  )
  await writer.close()
})

test("keeps remote WebSockets active with server heartbeats", async () => {
  const created = await authenticatedFetch("/v1/agent-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runtimeId: "codex", env: {} }),
  })
  const connection = (await created.json()).data
  const socket = new WebSocket(
    `${baseUrl.replace(/^http/, "ws")}${connection.websocketPath}`
  )

  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        socket.once("ping", resolve)
        socket.once("error", reject)
      }),
      delay(2_000).then(() => {
        throw new Error("Workspace Gateway did not send a WebSocket heartbeat.")
      }),
    ])
  } finally {
    socket.close()
  }
})

test("injects only restricted AstraFlow credentials and reaps the ACP process", async () => {
  const modelConfig = JSON.stringify({
    id: "test-model",
    providerModel: "provider-model",
    protocol: "openai-chat",
  })
  const created = await authenticatedFetch("/v1/agent-connections", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtimeId: "astraflow",
      env: {
        ASTRAFLOW_ACP_MODEL_CONFIG: modelConfig,
        ASTRAFLOW_MODELVERSE_API_KEY: "short-lived-modelverse-key",
        ASTRAFLOW_PERMISSION_MODE: "auto",
        OPENAI_API_KEY: "must-not-forward",
        ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN: "must-not-forward",
      },
    }),
  })
  const connection = (await created.json()).data

  assert.equal(created.status, 201)
  assert.equal(connection.runtimeVersion, "0.1.0")

  const stream = createWebSocketStream(
    `${baseUrl.replace(/^http/, "ws")}${connection.websocketPath}`
  )
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()

  await writer.write({ jsonrpc: "2.0", id: 11, method: "initialize" })
  const response = await reader.read()

  assert.deepEqual(response.value.result, {
    cwd: gateway.config.workspaceRoot,
    apiKey: "short-lived-modelverse-key",
    modelConfig,
    permissionMode: "auto",
    droppedOpenAIKey: null,
    hasGatewayToken: false,
  })
  assert.equal(gateway.agentManager.processes.size, 1)
  await writer.close()

  await assert.doesNotReject(async () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (gateway.agentManager.processes.size === 0) {
        return
      }

      await delay(20)
    }

    throw new Error("AstraFlow ACP child was not reaped after WebSocket close.")
  })
})

test(
  "runs an interactive PTY over authenticated WebSocket",
  { skip: process.platform !== "linux" },
  async () => {
    const created = await authenticatedFetch("/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "", cols: 100, rows: 30 }),
    })
    const terminal = (await created.json()).data
    const ticketResponse = await authenticatedFetch("/v1/connection-tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "terminal",
        terminalId: terminal.terminalId,
      }),
    })
    const ticket = (await ticketResponse.json()).data

    assert.equal(ticketResponse.status, 201)
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, "ws")}${ticket.websocketPath}`
    )
    let output = ""

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        output += Buffer.from(data).toString("utf8")
      }
    })

    await new Promise((resolve, reject) => {
      socket.once("open", resolve)
      socket.once("error", reject)
    })

    const replayStatus = await new Promise((resolve) => {
      const replay = new WebSocket(
        `${baseUrl.replace(/^http/, "ws")}${ticket.websocketPath}`
      )

      replay.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode)
        response.resume()
      })
      replay.once("open", () => {
        replay.close()
        resolve(101)
      })
      replay.on("error", () => undefined)
    })

    assert.equal(replayStatus, 401)

    socket.send(
      JSON.stringify({
        type: "terminal.input",
        data: "printf '__GATEWAY_PTY_OK__\\n'\\n",
      })
    )

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`PTY output timed out: ${output}`)),
        5_000
      )
      const poll = setInterval(() => {
        if (!output.includes("__GATEWAY_PTY_OK__")) {
          return
        }

        clearTimeout(timeout)
        clearInterval(poll)
        resolve()
      }, 20)

      timeout.unref?.()
    })

    assert.match(output, /__GATEWAY_PTY_OK__/)
    const closed = new Promise((resolve) => socket.once("close", resolve))
    socket.close()
    await closed

    const reconnectTicketResponse = await authenticatedFetch(
      "/v1/connection-tickets",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: "terminal",
          terminalId: terminal.terminalId,
        }),
      }
    )
    const reconnectTicket = (await reconnectTicketResponse.json()).data

    assert.equal(reconnectTicketResponse.status, 201)
    const reconnectedSocket = new WebSocket(
      `${baseUrl.replace(/^http/, "ws")}${reconnectTicket.websocketPath}`
    )
    reconnectedSocket.on("message", (data, isBinary) => {
      if (isBinary) {
        output += Buffer.from(data).toString("utf8")
      }
    })
    await new Promise((resolve, reject) => {
      reconnectedSocket.once("open", resolve)
      reconnectedSocket.once("error", reject)
    })
    reconnectedSocket.send(
      JSON.stringify({
        type: "terminal.input",
        data: "printf '__GATEWAY_PTY_RECONNECTED__\\n'; exit\\n",
      })
    )
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Reconnected PTY output timed out: ${output}`)),
        5_000
      )
      const poll = setInterval(() => {
        if (!output.includes("__GATEWAY_PTY_RECONNECTED__")) {
          return
        }

        clearTimeout(timeout)
        clearInterval(poll)
        resolve()
      }, 20)

      timeout.unref?.()
    })

    assert.match(output, /__GATEWAY_PTY_RECONNECTED__/)
    reconnectedSocket.close()
  }
)

test(
  "disposes a PTY after its WebSocket remains detached",
  { skip: process.platform !== "linux" },
  async () => {
    const created = await authenticatedFetch("/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "" }),
    })
    const terminal = (await created.json()).data
    const ticketResponse = await authenticatedFetch("/v1/connection-tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "terminal",
        terminalId: terminal.terminalId,
      }),
    })
    const ticket = (await ticketResponse.json()).data
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, "ws")}${ticket.websocketPath}`
    )

    await new Promise((resolve, reject) => {
      socket.once("open", resolve)
      socket.once("error", reject)
    })
    const closed = new Promise((resolve) => socket.once("close", resolve))

    socket.close()
    await closed
    await delay(180)

    const deletion = await authenticatedFetch(
      `/v1/terminals/${terminal.terminalId}`,
      { method: "DELETE" }
    )

    assert.equal(deletion.status, 404)
    assert.equal((await deletion.json()).error.code, "TERMINAL_NOT_FOUND")
  }
)
