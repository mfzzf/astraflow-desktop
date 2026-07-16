import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import {
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Readable, Writable } from "node:stream"
import { fileURLToPath } from "node:url"

import {
  PROTOCOL_VERSION,
  client as createAcpClient,
  methods,
  ndJsonStream,
} from "@agentclientprotocol/sdk"

const RUNTIME_ENTRY = fileURLToPath(
  new URL("../runtime/astraflow-acp/src/index.mjs", import.meta.url)
)
const HOST_TOOLS_MANIFEST = JSON.parse(
  readFileSync(
    new URL(
      "../runtime/astraflow-acp/host-tools-manifest.json",
      import.meta.url
    ),
    "utf8"
  )
)
const MCP_SERVER = {
  type: "acp",
  name: HOST_TOOLS_MANIFEST.server.name,
  serverId: HOST_TOOLS_MANIFEST.server.serverId,
}
const PROMPT_TIMEOUT_MS = 8 * 60_000
const RUNTIME_TIMEOUT_MS = 30 * 60_000
const CHILD_EXIT_TIMEOUT_MS = 5_000

function requiredEnvironment(name) {
  const value = process.env[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required for the local live ACP smoke test.`)
  }

  return value
}

function logStage(message) {
  process.stderr.write(`[local-acp-live] ${message}\n`)
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

function redact(value, secret) {
  const text = value instanceof Error ? value.message : String(value)

  return secret ? text.replaceAll(secret, "[REDACTED]") : text
}

function elicitationContent(params) {
  if (params.mode !== "form") {
    return {}
  }

  const properties = params.requestedSchema?.properties || {}

  return Object.fromEntries(
    Object.entries(properties).map(([name, schema]) => {
      const option = Array.isArray(schema?.oneOf) ? schema.oneOf[0] : null
      return [name, option?.const ?? "local-live-approved"]
    })
  )
}

function responseText(updates) {
  return updates
    .filter(
      (update) =>
        update.sessionUpdate === "agent_message_chunk" &&
        update.content?.type === "text"
    )
    .map((update) => update.content.text)
    .join("")
}

function toolNames(updates) {
  return updates
    .filter(
      (update) =>
        update.sessionUpdate === "tool_call" &&
        !update._meta?.astraflow?.parentTaskId
    )
    .map((update) => update.title)
}

function toolRuns(updates) {
  const runs = new Map()

  for (const update of updates) {
    if (update._meta?.astraflow?.parentTaskId) {
      continue
    }

    if (update.sessionUpdate === "tool_call") {
      runs.set(update.toolCallId, {
        name: update.title,
        rawInput: update.rawInput,
        rawOutput: undefined,
        status: update.status,
        toolCallId: update.toolCallId,
      })
      continue
    }

    if (update.sessionUpdate !== "tool_call_update") {
      continue
    }

    const run = runs.get(update.toolCallId)

    if (!run) {
      throw new Error(
        `Received a tool result without its call: ${update.toolCallId}`
      )
    }

    run.rawOutput = update.rawOutput
    run.status = update.status
  }

  return [...runs.values()]
}

function printable(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function assertCompletedToolRun(run, label) {
  if (run.status === "failed") {
    throw new Error(
      `${label}: ${run.name} failed: ${printable(run.rawOutput)}`
    )
  }

  if (run.status !== "completed") {
    throw new Error(
      `${label}: ${run.name} ended without a completed result (status=${run.status || "missing"}): ${printable(run.rawOutput)}`
    )
  }
}

async function runPromptWithTools(
  agent,
  desktop,
  sessionId,
  {
    completionMarker,
    expectedTools,
    label,
    maxAttempts = 2,
    prompt,
  }
) {
  const completed = new Map()
  const allCallbacks = []
  const allUpdates = []
  let nextPrompt = prompt

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runPrompt(
      agent,
      desktop,
      sessionId,
      `${label} (attempt ${attempt}/${maxAttempts})`,
      nextPrompt
    )
    const runs = toolRuns(result.updates)

    for (const run of runs) {
      if (!expectedTools.includes(run.name)) {
        throw new Error(
          `${label}: unexpected ${run.name} tool call; expected only ${expectedTools.join(", ")}`
        )
      }

      if (completed.has(run.name)) {
        throw new Error(`${label}: ${run.name} was called more than once.`)
      }

      assertCompletedToolRun(run, label)
      completed.set(run.name, run)
    }

    allCallbacks.push(...result.callbacks)
    allUpdates.push(...result.updates)
    const missing = expectedTools.filter((name) => !completed.has(name))

    if (missing.length === 0) {
      if (completionMarker) {
        assert.match(
          result.responseText,
          new RegExp(completionMarker),
          `${label}: final response did not include ${completionMarker}`
        )
      }

      return {
        callbacks: allCallbacks,
        responseText: result.responseText,
        runs: Object.fromEntries(completed),
        updates: allUpdates,
      }
    }

    if (attempt === maxAttempts) {
      throw new Error(
        `${label}: model omitted required tool calls after ${maxAttempts} attempts: ${missing.join(", ")}; observed: ${toolNames(allUpdates).join(", ") || "none"}`
      )
    }

    logStage(
      `${label}: retrying omitted model tool calls: ${missing.join(", ")}`
    )
    nextPrompt = [
      `Retry the ${label} check.`,
      `The previous turn already completed: ${[...completed.keys()].join(", ") || "none"}.`,
      `Call only these omitted tools exactly once now: ${missing.join(", ")}.`,
      "Do not repeat completed tools and do not call any other tools.",
      "Use the exact argument values from the original instructions below:",
      prompt,
      ...(completionMarker
        ? [`Then reply with exactly ${completionMarker}.`]
        : []),
    ].join("\n")
  }

  throw new Error(`${label}: unreachable retry state.`)
}

function createDesktopClient() {
  const updates = []
  const callbacks = []
  const permissionTools = []
  const parser = { parse: (value) => value }
  const app = createAcpClient({ name: "AstraFlow local ACP live smoke" })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update)
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      callbacks.push("permission")
      permissionTools.push(params.toolCall.title)
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
      assert.equal(params.serverId, MCP_SERVER.serverId)
      return { connectionId: "local-live-desktop-mcp" }
    })
    .onRequest("mcp/message", parser, ({ params }) => {
      callbacks.push(`mcp/message:${params.method}`)

      if (params.method === "tools/list") {
        return {
          tools: [
            {
              name: "studio_generate_image",
              description:
                "Fake AstraFlow Desktop image generation callback for the local live smoke test.",
              inputSchema: {
                type: "object",
                properties: {
                  prompt: { type: "string" },
                },
                required: ["prompt"],
                additionalProperties: true,
              },
            },
          ],
        }
      }

      if (params.method === "tools/call") {
        const name = params.params?.name
        callbacks.push(`mcp/tool:${name}`)

        assert.equal(name, "studio_generate_image")
        assert.match(
          String(params.params?.arguments?.prompt || ""),
          /ASTRAFLOW_LOCAL_IMAGE_OK/
        )

        return {
          content: [
            {
              type: "text",
              text: "desktop-mcp:studio_generate_image:ok",
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

  return { app, callbacks, permissionTools, updates }
}

function createRuntimeEnvironment({ apiKey, stateRoot }) {
  const model =
    process.env.ASTRAFLOW_ACP_LOCAL_LIVE_MODEL?.trim() || "gpt-5.6-sol"
  const baseUrl =
    process.env.ASTRAFLOW_ACP_LOCAL_LIVE_BASE_URL?.trim() ||
    "https://api.modelverse.cn/v1"

  return {
    ...process.env,
    ASTRAFLOW_ACP_EXECUTION: "local",
    ASTRAFLOW_ACP_MODEL_CONFIG: JSON.stringify({
      id: model,
      label: model,
      providerModel: model,
      protocol: "openai-responses",
      baseUrl,
      contextWindow: 200_000,
      maxTokens: 8_192,
      reasoning: true,
      reasoningEffort: "low",
      reasoningMode: "openai_reasoning_effort",
    }),
    ASTRAFLOW_ACP_STATE_ROOT: stateRoot,
    ASTRAFLOW_MODELVERSE_API_KEY: apiKey,
    ASTRAFLOW_PERMISSION_MODE: "ask",
  }
}

async function stopChild(child, stream) {
  await stream.writable.close().catch(() => undefined)

  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.kill("SIGTERM")

  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) =>
      setTimeout(resolve, CHILD_EXIT_TIMEOUT_MS).unref?.()
    ),
  ])

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL")
  }
}

async function withLocalRuntime(
  { apiKey, stateRoot, workspace },
  callback
) {
  const desktop = createDesktopClient()
  const child = spawn(process.execPath, [RUNTIME_ENTRY], {
    cwd: workspace,
    env: createRuntimeEnvironment({ apiKey, stateRoot }),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout)
  )
  let stderr = ""
  let runtimeActive = true

  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString("utf8")}`.slice(-8_000)
  })

  const childFailure = new Promise((_, reject) => {
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      if (runtimeActive) {
        reject(
          new Error(
            `AstraFlow ACP exited early: code=${code ?? "null"} signal=${signal ?? "null"}`
          )
        )
      }
    })
  })

  try {
    return await withTimeout(
      Promise.race([
        desktop.app.connectWith(stream, (agent) => callback(agent, desktop)),
        childFailure,
      ]),
      RUNTIME_TIMEOUT_MS,
      "AstraFlow local ACP runtime"
    )
  } catch (error) {
    const details = [redact(error, apiKey), redact(stderr.trim(), apiKey)]
      .filter(Boolean)
      .join("\n")
    throw new Error(details)
  } finally {
    runtimeActive = false
    await stopChild(child, stream)
  }
}

async function initialize(agent) {
  const initialized = await agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {
      auth: { terminal: false, _meta: { gateway: true } },
      elicitation: { form: {} },
      plan: {},
      positionEncodings: ["utf-16", "utf-8"],
    },
    clientInfo: {
      name: "AstraFlow local ACP live smoke",
      version: "1.1.4",
    },
  })

  assert.equal(initialized.protocolVersion, PROTOCOL_VERSION)
  assert.equal(initialized.agentInfo.name, "AstraFlow Agent")
  assert.equal(
    initialized.agentCapabilities._meta.astraflow.execution,
    "local"
  )

  return initialized
}

async function runPrompt(agent, desktop, sessionId, label, prompt) {
  const updateOffset = desktop.updates.length
  const callbackOffset = desktop.callbacks.length
  const result = await withTimeout(
    agent.request(methods.agent.session.prompt, {
      sessionId,
      prompt: [{ type: "text", text: prompt }],
    }),
    PROMPT_TIMEOUT_MS,
    label
  )

  assert.equal(result.stopReason, "end_turn")

  return {
    callbacks: desktop.callbacks.slice(callbackOffset),
    responseText: responseText(desktop.updates.slice(updateOffset)),
    updates: desktop.updates.slice(updateOffset),
  }
}

async function assertMarkerFile(markerPath, context) {
  let content

  try {
    content = await readFile(markerPath, "utf8")
  } catch (error) {
    throw new Error(
      `${context}: the write tool reported success but the marker file is unavailable: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  assert.equal(
    content.trim(),
    "ASTRAFLOW_LOCAL_LIVE_OK",
    `${context}: marker file content differs from the requested value`
  )
}

const apiKey = requiredEnvironment("ASTRAFLOW_MODELVERSE_API_KEY")
const workspace = await realpath(
  await mkdtemp(join(tmpdir(), "astraflow-acp-local-live-workspace-"))
)
const stateRoot = await mkdtemp(
  join(tmpdir(), "astraflow-acp-local-live-state-")
)
const markerPath = join(workspace, "astraflow-acp-local-live.txt")
let sessionId

assert.equal(
  Object.values(HOST_TOOLS_MANIFEST.toolGroups)
    .flat()
    .includes("studio_generate_image"),
  true
)

try {
  logStage("starting shared AstraFlow ACP runtime over stdio")
  const firstRun = await withLocalRuntime(
    { apiKey, stateRoot, workspace },
    async (agent, desktop) => {
      const initialized = await initialize(agent)
      const created = await agent.request(methods.agent.session.new, {
        cwd: workspace,
        mcpServers: [MCP_SERVER],
        _meta: {
          astraflow: {
            desktopSessionId: "local-live-smoke",
            execution: "local",
          },
        },
      })

      sessionId = created.sessionId

      logStage("verifying plan and bash tools")
      const commands = await runPromptWithTools(
        agent,
        desktop,
        sessionId,
        {
          completionMarker: "ASTRAFLOW_LOCAL_COMMANDS_OK",
          expectedTools: ["plan", "bash"],
          label: "local plan and bash tools",
          prompt: [
            "Run this deterministic local runtime check exactly as written.",
            "1. Call plan exactly once with two concise items.",
            '2. Call bash exactly once with command `test -z "${ASTRAFLOW_MODELVERSE_API_KEY:-}" && pwd`.',
            "Do not use any other tools. Then reply with exactly ASTRAFLOW_LOCAL_COMMANDS_OK.",
          ].join("\n"),
        }
      )

      const planUpdates = commands.updates.filter(
        (update) => update.sessionUpdate === "plan"
      )

      assert.equal(planUpdates.length, 1)
      assert.equal(planUpdates[0].entries.length, 2)
      assert.equal(
        commands.runs.bash.rawInput?.command,
        'test -z "${ASTRAFLOW_MODELVERSE_API_KEY:-}" && pwd'
      )
      assert.match(printable(commands.runs.bash.rawOutput), /local-live-workspace/)

      logStage("verifying write tool and its filesystem effect")
      const written = await runPromptWithTools(
        agent,
        desktop,
        sessionId,
        {
          completionMarker: "ASTRAFLOW_LOCAL_WRITE_OK",
          expectedTools: ["write"],
          label: "local write tool",
          prompt: [
            `Call write exactly once with path ${markerPath} and content ASTRAFLOW_LOCAL_LIVE_OK.`,
            "Do not call any other tools. Then reply with exactly ASTRAFLOW_LOCAL_WRITE_OK.",
          ].join("\n"),
        }
      )

      assert.equal(
        resolve(workspace, written.runs.write.rawInput?.path || ""),
        markerPath
      )
      assert.equal(
        String(written.runs.write.rawInput?.content || "").trim(),
        "ASTRAFLOW_LOCAL_LIVE_OK"
      )
      await assertMarkerFile(markerPath, "local write tool")

      logStage("verifying read tool against the confirmed marker")
      const read = await runPromptWithTools(
        agent,
        desktop,
        sessionId,
        {
          completionMarker: "ASTRAFLOW_LOCAL_CORE_OK",
          expectedTools: ["read"],
          label: "local read tool",
          prompt: [
            `Call read exactly once for ${markerPath}.`,
            "Confirm its exact content is ASTRAFLOW_LOCAL_LIVE_OK.",
            "Do not call any other tools. Then reply with exactly ASTRAFLOW_LOCAL_CORE_OK.",
          ].join("\n"),
        }
      )

      assert.equal(
        resolve(workspace, read.runs.read.rawInput?.path || ""),
        markerPath
      )
      assert.match(printable(read.runs.read.rawOutput), /ASTRAFLOW_LOCAL_LIVE_OK/)

      logStage("verifying request_user_input and Desktop media callback")
      const callbacks = await runPromptWithTools(
        agent,
        desktop,
        sessionId,
        {
          completionMarker: "ASTRAFLOW_LOCAL_CALLBACKS_OK",
          expectedTools: ["request_user_input", "studio_generate_image"],
          label: "local Desktop callbacks",
          prompt: [
            "Call request_user_input exactly once with one concise confirmation question.",
            "After it is accepted, call studio_generate_image exactly once with prompt ASTRAFLOW_LOCAL_IMAGE_OK.",
            "Do not call any other tools. Then reply with exactly ASTRAFLOW_LOCAL_CALLBACKS_OK.",
          ].join("\n"),
        }
      )

      assert.equal(callbacks.callbacks.includes("elicitation"), true)
      assert.equal(
        callbacks.callbacks.includes("mcp/tool:studio_generate_image"),
        true
      )

      logStage("verifying task subagent")
      await assertMarkerFile(markerPath, "before local task subagent")
      const subagent = await runPromptWithTools(
        agent,
        desktop,
        sessionId,
        {
          completionMarker: "ASTRAFLOW_LOCAL_SUBAGENT_OK",
          expectedTools: ["task"],
          label: "local task subagent",
          prompt: [
            `Call task exactly once and ask the subagent to read ${markerPath} and report its exact content.`,
            "After the subagent returns, reply with exactly ASTRAFLOW_LOCAL_SUBAGENT_OK.",
          ].join("\n"),
        }
      )

      assert.match(printable(subagent.runs.task.rawOutput), /ASTRAFLOW_LOCAL_LIVE_OK/)

      return {
        callbacks: desktop.callbacks,
        initialized: initialized.agentInfo,
        permissionTools: desktop.permissionTools,
      }
    }
  )

  await assertMarkerFile(markerPath, "after first local runtime")
  assert.equal(firstRun.permissionTools.includes("bash"), true)
  assert.equal(firstRun.permissionTools.includes("write"), true)
  assert.equal(firstRun.permissionTools.includes("read"), true)
  assert.equal(
    firstRun.callbacks.includes("mcp/tool:studio_generate_image"),
    true
  )

  const checkpointFiles = (await readdir(stateRoot)).filter((name) =>
    name.endsWith(".json")
  )
  assert.equal(checkpointFiles.length, 1)
  const checkpointText = await readFile(
    join(stateRoot, checkpointFiles[0]),
    "utf8"
  )

  assert.equal(checkpointText.includes(apiKey), false)
  assert.match(checkpointText, /ASTRAFLOW_LOCAL_SUBAGENT_OK/)

  logStage("restarting shared runtime and resuming checkpoint")
  const resumed = await withLocalRuntime(
    { apiKey, stateRoot, workspace },
    async (agent, desktop) => {
      await initialize(agent)
      await agent.request(methods.agent.session.resume, {
        cwd: workspace,
        mcpServers: [MCP_SERVER],
        sessionId,
        _meta: {
          astraflow: {
            desktopSessionId: "local-live-smoke",
            execution: "local",
          },
        },
      })

      return runPromptWithTools(
        agent,
        desktop,
        sessionId,
        {
          completionMarker: "ASTRAFLOW_LOCAL_RESUME_OK",
          expectedTools: ["read"],
          label: "local checkpoint resume",
          prompt: [
            `Call read exactly once for ${markerPath}.`,
            "Using the resumed conversation and the file result, reply with ASTRAFLOW_LOCAL_RESUME_OK and ASTRAFLOW_LOCAL_LIVE_OK.",
          ].join("\n"),
        }
      )
    }
  )

  assert.match(resumed.responseText, /ASTRAFLOW_LOCAL_RESUME_OK/)
  assert.match(resumed.responseText, /ASTRAFLOW_LOCAL_LIVE_OK/)
  assert.match(printable(resumed.runs.read.rawOutput), /ASTRAFLOW_LOCAL_LIVE_OK/)

  console.log(
    JSON.stringify(
      {
        ok: true,
        runtime: firstRun.initialized,
        tools: {
          plan: true,
          bash: true,
          write: true,
          read: true,
          requestUserInput: true,
          subagent: true,
          studioGenerateImageCallback: true,
        },
        checkpointResumed: true,
      },
      null,
      2
    )
  )
} finally {
  await rm(workspace, { recursive: true, force: true })
  await rm(stateRoot, { recursive: true, force: true })
}
