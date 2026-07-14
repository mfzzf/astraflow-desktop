import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"

import {
  PROTOCOL_VERSION,
  client as createAcpClient,
  methods,
} from "@agentclientprotocol/sdk"
import { createWebSocketStream } from "@agentclientprotocol/sdk/experimental/ws-client"
import { Sandbox } from "@e2b/code-interpreter"
import { WebSocket } from "ws"

const DEFAULT_DOMAIN = "cn-wlcb.sandbox.ucloudai.com"
const DEFAULT_TEMPLATE = "yeyb5hbs2kweus6ku07l"
const GATEWAY_PORT = 8787
const WORKSPACE = "/workspace"
const REQUEST_TIMEOUT_MS = 30_000
const PROMPT_TIMEOUT_MS = 8 * 60_000
const RUNTIMES = ["astraflow", "codex", "claude-code", "opencode"]

class DiagnosticWebSocket extends WebSocket {
  constructor(...args) {
    super(...args)
    this.once("close", (code, reason) => {
      if (code !== 1000 && code !== 1005) {
        logStage(
          `ACP WebSocket closed with code ${code}: ${reason.toString("utf8") || "no reason"}`
        )
      }
    })
  }
}

function logStage(message) {
  process.stderr.write(`[sandbox-smoke] ${message}\n`)
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required.`)
  }

  return value
}

function normalizeDomain(value) {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\*\./, "")
    .replace(/\/+$/, "")
}

function withTimeout(promise, timeoutMs, label) {
  let timer

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs
      )
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

async function runChecked(sandbox, command, timeoutMs = 60_000) {
  const result = await sandbox.commands.run(command, {
    timeoutMs,
    requestTimeoutMs: Math.max(REQUEST_TIMEOUT_MS, timeoutMs + 10_000),
  })

  if (result.exitCode !== 0) {
    throw new Error(
      result.stderr || result.stdout || `Sandbox command failed: ${command}`
    )
  }

  return result.stdout.trim()
}

async function startGateway(sandbox) {
  const token = randomBytes(32).toString("base64url")

  await sandbox.commands.run(
    "pkill -f '[n]ode /opt/astraflow/workspace-gateway/src/server.mjs' >/dev/null 2>&1 || true",
    { timeoutMs: 10_000, requestTimeoutMs: 20_000 }
  )
  await sandbox.commands.run(
    "/usr/local/bin/node /opt/astraflow/workspace-gateway/src/server.mjs",
    {
      background: true,
      envs: {
        ASTRAFLOW_WORKSPACE_GATEWAY_HOST: "0.0.0.0",
        ASTRAFLOW_WORKSPACE_GATEWAY_PORT: String(GATEWAY_PORT),
        ASTRAFLOW_WORKSPACE_GATEWAY_TOKEN: token,
        ASTRAFLOW_WORKSPACE_ROOT: WORKSPACE,
        ASTRAFLOW_WORKSPACE_ID: sandbox.sandboxId,
        ASTRAFLOW_SANDBOX_ID: sandbox.sandboxId,
        ASTRAFLOW_TEMPLATE_VERSION: template,
        PATH:
          "/usr/local/bin:/root/.nvm/versions/node/v20.9.0/bin:/usr/bin:/bin",
      },
      timeoutMs: 0,
      requestTimeoutMs: 20_000,
    }
  )
  await runChecked(
    sandbox,
    [
      "for attempt in $(seq 1 80); do",
      `  if curl -fsS http://127.0.0.1:${GATEWAY_PORT}/healthz >/dev/null; then exit 0; fi`,
      "  sleep 0.25",
      "done",
      "exit 1",
    ].join("\n"),
    30_000
  )

  const host = sandbox.getHost(GATEWAY_PORT)

  return {
    baseUrl: `${host.includes("localhost") ? "http" : "https"}://${host}`,
    token,
  }
}

async function gatewayJson(gateway, path, init = {}) {
  const headers = new Headers(init.headers)
  headers.set("authorization", `Bearer ${gateway.token}`)

  if (init.body) {
    headers.set("content-type", "application/json")
  }

  const response = await fetch(new URL(path, `${gateway.baseUrl}/`), {
    ...init,
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const payload = await response.json()

  if (!response.ok || payload?.ok !== true) {
    throw new Error(
      payload?.error?.message ||
        `Workspace Gateway ${path} failed with HTTP ${response.status}.`
    )
  }

  return payload.data
}

function runtimeEnvironment(runtimeId) {
  const openAiModel = process.env.ASTRAFLOW_SANDBOX_SMOKE_OPENAI_MODEL?.trim() ||
    "gpt-5.6-sol"
  const claudeModel = process.env.ASTRAFLOW_SANDBOX_SMOKE_CLAUDE_MODEL?.trim() ||
    "claude-haiku-4-5-20251001"
  const openAiBaseUrl =
    process.env.ASTRAFLOW_SANDBOX_SMOKE_OPENAI_BASE_URL?.trim() ||
    "https://api.modelverse.cn/v1"

  if (runtimeId === "astraflow") {
    return {
      ASTRAFLOW_ACP_MODEL_CONFIG: JSON.stringify({
        id: openAiModel,
        label: openAiModel,
        providerModel: openAiModel,
        protocol: "openai-responses",
        baseUrl: openAiBaseUrl,
        reasoningEffort: "medium",
        reasoningMode: "openai_reasoning_effort",
      }),
      ASTRAFLOW_MODELVERSE_API_KEY: modelverseApiKey,
      ASTRAFLOW_PERMISSION_MODE: "auto",
    }
  }

  if (runtimeId === "codex") {
    return {
      ASTRAFLOW_MODELVERSE_API_KEY: modelverseApiKey,
      CODEX_API_KEY: modelverseApiKey,
      CODEX_CONFIG: JSON.stringify({
        model: openAiModel,
        model_provider: "modelverse",
        model_providers: {
          modelverse: {
            name: "Modelverse",
            base_url: openAiBaseUrl,
            env_key: "ASTRAFLOW_MODELVERSE_API_KEY",
            wire_api: "responses",
          },
        },
      }),
      DEFAULT_AUTH_REQUEST: JSON.stringify({ methodId: "api-key" }),
      INITIAL_AGENT_MODE: "agent",
      MODEL_PROVIDER: "modelverse",
      NO_BROWSER: "1",
      OPENAI_API_KEY: modelverseApiKey,
    }
  }

  if (runtimeId === "claude-code") {
    return {
      ANTHROPIC_MODEL: claudeModel,
      CLAUDE_CODE_REMOTE: "1",
      CLAUDE_MODEL_CONFIG: JSON.stringify({ availableModels: [claudeModel] }),
      NO_BROWSER: "1",
    }
  }

  return {
    ASTRAFLOW_MODELVERSE_API_KEY: modelverseApiKey,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      model: `modelverse-openai/${openAiModel}`,
      permission: "allow",
      small_model: `modelverse-openai/${openAiModel}`,
      provider: {
        "modelverse-openai": {
          npm: "@ai-sdk/openai",
          name: "Modelverse OpenAI",
          options: {
            apiKey: "{env:ASTRAFLOW_MODELVERSE_API_KEY}",
            baseURL: openAiBaseUrl,
          },
          models: {
            [openAiModel]: { name: openAiModel },
          },
        },
      },
    }),
    OPENCODE_DB: "astraflow-opencode-smoke.db",
  }
}

function claudeGatewayAuthentication() {
  const anthropicBaseUrl =
    process.env.ASTRAFLOW_SANDBOX_SMOKE_ANTHROPIC_BASE_URL?.trim() ||
    "https://api.modelverse.cn"

  return {
    methodId: "gateway",
    _meta: {
      gateway: {
        protocol: "anthropic",
        baseUrl: anthropicBaseUrl.replace(/\/v1\/?$/i, ""),
        headers: {
          Authorization: `Bearer ${modelverseApiKey}`,
        },
      },
    },
  }
}

async function createAgentTicket(gateway, runtimeId) {
  const data = await gatewayJson(gateway, "/v1/agent-connections", {
    method: "POST",
    body: JSON.stringify({
      runtimeId,
      env: runtimeEnvironment(runtimeId),
    }),
  })
  const websocketBaseUrl = gateway.baseUrl.replace(/^http/, "ws")

  return {
    ...data,
    websocketUrl: new URL(data.websocketPath, `${websocketBaseUrl}/`).toString(),
  }
}

function textFromUpdates(updates) {
  return updates
    .filter(
      (update) =>
        (update.sessionUpdate === "agent_message_chunk" ||
          update.sessionUpdate === "agent_thought_chunk") &&
        update.content?.type === "text"
    )
    .map((update) => update.content.text)
    .join("")
}

function elicitationContent(params) {
  if (params.mode !== "form") {
    return {}
  }

  const properties = params.requestedSchema?.properties || {}

  return Object.fromEntries(
    Object.entries(properties).map(([name, schema]) => {
      const option = Array.isArray(schema?.oneOf) ? schema.oneOf[0] : null
      return [name, option?.const ?? "sandbox-smoke-approved"]
    })
  )
}

async function runAcpPrompt({
  gateway,
  prompt,
  resumeSessionId = null,
  runtimeId,
  useDesktopCallbacks = false,
}) {
  const ticket = await createAgentTicket(gateway, runtimeId)
  const updates = []
  const callbacks = []
  const observedUpdateKinds = new Set()
  const parser = { parse: (value) => value }
  const app = createAcpClient({ name: "AstraFlow Sandbox live smoke" })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update)
      const update = params.update

      if (update.sessionUpdate === "tool_call") {
        logStage(`${runtimeId} tool: ${update.title || "tool"}`)
      } else if (!observedUpdateKinds.has(update.sessionUpdate)) {
        observedUpdateKinds.add(update.sessionUpdate)
        logStage(`${runtimeId} update: ${update.sessionUpdate}`)
      }
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      callbacks.push("permission")
      const option =
        params.options.find((candidate) =>
          String(candidate.kind).startsWith("allow")
        ) || params.options[0]

      return {
        outcome: option
          ? { outcome: "selected", optionId: option.optionId }
          : { outcome: "cancelled" },
      }
    })
    .onRequest(methods.client.elicitation.create, ({ params }) => {
      callbacks.push("elicitation")
      return { action: "accept", content: elicitationContent(params) }
    })
    .onRequest("mcp/connect", parser, ({ params }) => {
      callbacks.push(`mcp/connect:${params.serverId}`)
      return { connectionId: "desktop-smoke-mcp" }
    })
    .onRequest("mcp/message", parser, ({ params }) => {
      callbacks.push(`mcp/message:${params.method}`)

      if (params.method === "tools/list") {
        return {
          tools: [
            {
              name: "desktop_echo",
              description: "Return text through the Desktop MCP callback.",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
          ],
        }
      }

      if (params.method === "tools/call") {
        return {
          content: [
            {
              type: "text",
              text: `desktop-mcp:${params.params?.arguments?.text || "ok"}`,
            },
          ],
        }
      }

      return {}
    })
    .onRequest("mcp/disconnect", parser, ({ params }) => {
      callbacks.push(`mcp/disconnect:${params.connectionId}`)
      return {}
    })
  const stream = createWebSocketStream(ticket.websocketUrl, {
    WebSocket: DiagnosticWebSocket,
    cookies: "omit",
  })

  const outcome = await withTimeout(
    app.connectWith(stream, async (agent) => {
      const initialized = await agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          auth: { terminal: false, _meta: { gateway: true } },
          elicitation: { form: {} },
          plan: {},
          positionEncodings: ["utf-16", "utf-8"],
        },
        clientInfo: { name: "AstraFlow Sandbox smoke", version: "1.1.4" },
      })

      if (runtimeId === "claude-code") {
        await agent.request(
          methods.agent.authenticate,
          claudeGatewayAuthentication()
        )
      }

      const mcpServers = useDesktopCallbacks
        ? [{ type: "acp", name: "desktop_smoke", serverId: "studio:smoke" }]
        : []
      const session = resumeSessionId
        ? await agent.request(methods.agent.session.resume, {
            cwd: WORKSPACE,
            mcpServers,
            sessionId: resumeSessionId,
          })
        : await agent.request(methods.agent.session.new, {
            cwd: WORKSPACE,
            mcpServers,
          })
      const sessionId = resumeSessionId || session.sessionId
      const preferredModes =
        runtimeId === "codex"
          ? ["agent"]
          : runtimeId === "claude-code"
            ? ["auto", "default"]
            : ["auto", "agent", "default"]
      const selectedMode = preferredModes.find((modeId) =>
        session.modes?.availableModes?.some((mode) => mode.id === modeId)
      )

      if (selectedMode && session.modes?.currentModeId !== selectedMode) {
        await agent
          .request(methods.agent.session.setMode, { sessionId, modeId: selectedMode })
          .catch(() => undefined)
      }

      const result = await agent.request(methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: "text", text: prompt }],
      })

      return { initialized, result, sessionId }
    }),
    PROMPT_TIMEOUT_MS,
    `${runtimeId} ACP prompt`
  )

  await stream.writable.close().catch(() => undefined)

  return {
    ...outcome,
    callbacks,
    responseText: textFromUpdates(updates),
    ticket,
    updates,
  }
}

async function assertTicketConsumed(websocketUrl) {
  await withTimeout(
    new Promise((resolve, reject) => {
      const socket = new WebSocket(websocketUrl)

      socket.once("open", () => {
        socket.close()
        reject(new Error("A consumed Agent ticket opened a second WebSocket."))
      })
      socket.once("unexpected-response", (_request, response) => {
        assert.equal(response.statusCode, 401)
        response.resume()
        resolve()
      })
      socket.once("error", (error) => {
        if (/401|unexpected server response/i.test(error.message)) {
          resolve()
          return
        }

        reject(error)
      })
    }),
    10_000,
    "one-time Agent ticket rejection"
  )
}

if (process.env.ASTRAFLOW_CONFIRM_SANDBOX_SMOKE !== "1") {
  throw new Error(
    "Set ASTRAFLOW_CONFIRM_SANDBOX_SMOKE=1 to confirm creation and deletion of a temporary remote Sandbox."
  )
}

const sandboxApiKey =
  process.env.UCLOUD_SANDBOX_API_KEY?.trim() || requiredEnvironment("E2B_API_KEY")
const modelverseApiKey =
  process.env.ASTRAFLOW_MODELVERSE_API_KEY?.trim() || sandboxApiKey
const domain = normalizeDomain(
  process.env.ASTRAFLOW_SANDBOX_DOMAIN ||
    process.env.E2B_DOMAIN ||
    DEFAULT_DOMAIN
)
const template =
  process.env.ASTRAFLOW_CODE_SANDBOX_TEMPLATE?.trim() || DEFAULT_TEMPLATE
const connectionOptions = {
  apiKey: sandboxApiKey,
  domain,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  timeoutMs: 3_600_000,
  validateApiKey: false,
}
let sandbox

try {
  logStage(`creating temporary Sandbox from template ${template}`)
  sandbox = await Sandbox.create(template, {
    ...connectionOptions,
    allowInternetAccess: true,
    lifecycle: {
      onTimeout: { action: "pause", keepMemory: true },
      autoResume: true,
    },
    metadata: {
      app: "astraflow-runtime-smoke",
      runId: randomUUID(),
    },
  })
  logStage("starting Workspace Gateway")
  let gateway = await startGateway(sandbox)
  const health = await gatewayJson(gateway, "/v1/health")

  assert.equal(health.protocolVersion, 1)
  assert.equal(health.gatewayVersion, "0.4.0")
  assert.equal(health.templateVersion, template)
  assert.deepEqual(
    health.agentRuntimes.map((runtime) => runtime.id).sort(),
    [...RUNTIMES].sort()
  )
  assert.equal(
    health.agentRuntimes.every((runtime) => runtime.available),
    true
  )
  assert.equal(
    health.agentRuntimes.find((runtime) => runtime.id === "astraflow")?.version,
    "0.1.0"
  )

  logStage("running AstraFlow ACP plan, terminal, and file tools")
  const astraflowCore = await runAcpPrompt({
    gateway,
    runtimeId: "astraflow",
    prompt: [
      "Complete this focused Sandbox runtime check.",
      "1. Create a plan with exactly two concise items.",
      "2. Run `test -z \"${ASTRAFLOW_MODELVERSE_API_KEY:-}\" && pwd`.",
      "3. Write the exact text ASTRAFLOW_SANDBOX_OK to /workspace/astraflow-acp-live.txt.",
      "Then respond with ASTRAFLOW_CORE_OK and /workspace.",
    ].join("\n"),
  })

  assert.match(astraflowCore.responseText, /ASTRAFLOW_CORE_OK/)
  assert.match(astraflowCore.responseText, /\/workspace/)
  assert.equal(
    astraflowCore.updates.some((update) => update.sessionUpdate === "plan"),
    true
  )
  await assertTicketConsumed(astraflowCore.ticket.websocketUrl)
  assert.equal(
    await runChecked(sandbox, "cat /workspace/astraflow-acp-live.txt"),
    "ASTRAFLOW_SANDBOX_OK"
  )

  logStage("running AstraFlow ACP user-input and Desktop MCP callbacks")
  const astraflowCallbacks = await runAcpPrompt({
    gateway,
    runtimeId: "astraflow",
    useDesktopCallbacks: true,
    prompt: [
      "Use request_user_input exactly once with one concise confirmation question.",
      "After it returns, call desktop_echo with text ASTRAFLOW_MCP_OK.",
      "Then respond with ASTRAFLOW_CALLBACKS_OK.",
    ].join("\n"),
  })

  assert.match(astraflowCallbacks.responseText, /ASTRAFLOW_CALLBACKS_OK/)
  assert.equal(astraflowCallbacks.callbacks.includes("elicitation"), true)
  assert.equal(
    astraflowCallbacks.callbacks.includes("mcp/message:tools/call"),
    true
  )

  logStage("running AstraFlow ACP subagent delegation")
  const astraflowSubagent = await runAcpPrompt({
    gateway,
    runtimeId: "astraflow",
    prompt: [
      "Delegate exactly one subagent to read /workspace/astraflow-acp-live.txt and report its exact content.",
      "After the subagent returns, respond with ASTRAFLOW_SUBAGENT_OK.",
    ].join("\n"),
  })

  assert.match(astraflowSubagent.responseText, /ASTRAFLOW_SUBAGENT_OK/)
  assert.equal(
    astraflowSubagent.updates.some(
      (update) =>
        update.sessionUpdate === "tool_call" && update.title === "task"
    ),
    true
  )

  const runtimePrompts = {
    codex:
      "Run pwd in the Sandbox terminal, then reply with CODEX_SANDBOX_OK and the absolute working directory.",
    "claude-code":
      "Run pwd in the Sandbox terminal, then reply with CLAUDE_CODE_SANDBOX_OK and the absolute working directory.",
    opencode:
      "Run pwd in the Sandbox terminal, then reply with OPENCODE_SANDBOX_OK and the absolute working directory.",
  }
  const runtimeMarkers = {
    codex: "CODEX_SANDBOX_OK",
    "claude-code": "CLAUDE_CODE_SANDBOX_OK",
    opencode: "OPENCODE_SANDBOX_OK",
  }
  const runtimeResults = {}

  for (const runtimeId of ["codex", "claude-code", "opencode"]) {
    logStage(`running ${runtimeId} ACP prompt`)
    const result = await runAcpPrompt({
      gateway,
      runtimeId,
      prompt: runtimePrompts[runtimeId],
    })

    assert.match(result.responseText, new RegExp(runtimeMarkers[runtimeId]))
    assert.match(result.responseText, /\/workspace/)
    runtimeResults[runtimeId] = {
      agent: result.initialized.agentInfo,
      marker: runtimeMarkers[runtimeId],
    }
  }

  logStage("pausing and reconnecting to Sandbox")
  const paused = await Sandbox.pause(sandbox.sandboxId, {
    apiKey: sandboxApiKey,
    domain,
    keepMemory: true,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    validateApiKey: false,
  })

  assert.equal(paused, true)
  sandbox = await Sandbox.connect(sandbox.sandboxId, connectionOptions)
  assert.equal(
    await runChecked(sandbox, "cat /workspace/astraflow-acp-live.txt"),
    "ASTRAFLOW_SANDBOX_OK"
  )
  gateway = await startGateway(sandbox)

  logStage("resuming AstraFlow checkpoint")
  const resumed = await runAcpPrompt({
    gateway,
    runtimeId: "astraflow",
    resumeSessionId: astraflowCore.sessionId,
    prompt:
      "Confirm the prior ASTRAFLOW_SANDBOX_OK file still exists, then reply with ASTRAFLOW_RESUME_OK and /workspace.",
  })

  assert.match(resumed.responseText, /ASTRAFLOW_RESUME_OK/)
  assert.match(resumed.responseText, /\/workspace/)

  logStage("checking process and credential cleanup")
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  await runChecked(
    sandbox,
    [
      "test ! -f /root/.codex/auth.json",
      "test ! -f /root/.config/opencode/opencode.json",
      "test ! -f /root/.claude/settings.json",
      "! grep -R -F 'ASTRAFLOW_MODELVERSE_API_KEY' /root/.astraflow/acp-sessions >/dev/null 2>&1",
      "! pgrep -f 'astraflow-acp/src/[i]ndex.mjs|[c]odex-acp|[c]laude-agent-acp|[o]pencode acp' >/dev/null",
    ].join("\n")
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        sandboxId: sandbox.sandboxId,
        template,
        gatewayVersion: health.gatewayVersion,
        runtimes: {
          astraflow: {
            agent: astraflowCore.initialized.agentInfo,
            callbacks: astraflowCallbacks.callbacks,
            checkpointResumed: true,
            marker: "ASTRAFLOW_CORE_OK",
            subagent: true,
          },
          ...runtimeResults,
        },
        pauseResume: true,
        processCleanup: true,
        persistedCredentialFiles: false,
      },
      null,
      2
    )
  )
} finally {
  if (sandbox?.sandboxId) {
    logStage(`killing temporary Sandbox ${sandbox.sandboxId}`)
    await Sandbox.kill(sandbox.sandboxId, {
      apiKey: sandboxApiKey,
      domain,
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      validateApiKey: false,
    }).catch(() => undefined)
  }
}
