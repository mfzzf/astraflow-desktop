import {
  PROTOCOL_VERSION,
  RequestError,
  agent as createAgentApp,
  methods,
} from "@agentclientprotocol/sdk"
import {
  Agent,
  convertToLlm,
  createCompactionSummaryMessage,
  estimateContextTokens,
  estimateTokens,
} from "@earendil-works/pi-agent-core"
import { Type, getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import { streamSimple } from "@earendil-works/pi-ai/compat"
import {
  formatSkillsForPrompt,
  generateSummary,
  loadSkills,
} from "@earendil-works/pi-coding-agent"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { AcpPermissionBackend } from "./backend.mjs"
import {
  ASTRAFLOW_ACP_FEATURES,
  ASTRAFLOW_ACP_RECURSION_LIMIT,
  ASTRAFLOW_ACP_RUNTIME_VERSION,
  ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
  asErrorMessage,
  getRecord,
  stringify,
} from "./constants.mjs"
import {
  assertSupportedMcpServers,
  createAcpMcpTools,
  formatMcpConnectionFailures,
} from "./mcp-tools.mjs"
import {
  createAstraflowPiModel,
  readAstraflowRuntimeConfiguration,
} from "./model.mjs"
import { createAstraflowPiSession } from "./pi-session.mjs"
import { AstraflowSessionStore, boundedPiHistory } from "./session-store.mjs"
import { subscribePiSessionEventForwarder } from "./stream.mjs"

function executionLabel(execution) {
  return execution === "local"
    ? "local workspace"
    : "persistent Sandbox workspace"
}

function baseSystemPrompt(execution) {
  const location =
    execution === "local"
      ? "on the user's local machine"
      : "inside the user's selected persistent Sandbox"

  return `You are AstraFlow Agent, powered by Pi Agent, running in the user's selected ${executionLabel(execution)}.

The model, Pi orchestration, planning, subagents, filesystem tools, and terminal execution run ${location}. AstraFlow Desktop owns the UI, session record, permission prompts, API-key vault, and bridged MCP servers.

Work from the selected workspace. Read relevant files before editing. Use the plan tool to keep genuinely multi-step work current, and the task tool only for a broad independent subtask. Verify results with focused commands. Do not claim a result that was not observed. Never print, search for, or expose runtime credentials. Use request_user_input only when the answer materially changes the result.

When available, use web_fetch for user-provided URLs, web_search for current or source-backed facts, and studio_generate_image or studio_generate_video for media requests. Use list_installed_mcp_servers to inspect the MCP catalog when integrations matter. After creating a standalone artifact for the user, use download_file with its exact path; do not use it for ordinary repository edits.`
}

function subagentPrompt(execution) {
  return `You are an AstraFlow Agent task subagent powered by Pi Agent and running in the same ${executionLabel(execution)}. Complete only the delegated objective, use concrete workspace evidence, and return a concise report to the parent Agent. You cannot ask the user questions or delegate another subagent.`
}
const MAX_PROJECT_INSTRUCTIONS_BYTES = 256 * 1024
const DEFAULT_COMPACTION_RESERVE_TOKENS = 16_384
const DEFAULT_COMPACTION_KEEP_RECENT_TOKENS = 20_000
const DEFAULT_SESSION_MODE_ID = "default"
const SESSION_LIST_PAGE_SIZE = 50
const ASTRAFLOW_PROVIDER_ID = "astraflow-modelverse"
const ACP_PROVIDER_PLACEHOLDER_API_KEY = "acp-provider-header-auth"
const SUPPORTED_PROVIDER_API_TYPES = Object.freeze(["openai", "anthropic"])
const SESSION_MODES = Object.freeze([
  Object.freeze({
    id: DEFAULT_SESSION_MODE_ID,
    name: "Agent",
    description:
      "Use the configured AstraFlow agent workflow. Permissions remain controlled separately by the Desktop security policy.",
  }),
])
const THINKING_LEVEL_NAMES = Object.freeze({
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum",
})
const ASTRAFLOW_AVAILABLE_COMMANDS = Object.freeze([
  Object.freeze({
    name: "status",
    description:
      "Summarize completed work, active work, blockers, and the next step without changing files.",
  }),
  Object.freeze({
    name: "review",
    description:
      "Review the current workspace changes for correctness, regressions, and missing verification.",
    input: Object.freeze({ hint: "optional review focus" }),
  }),
  Object.freeze({
    name: "plan",
    description:
      "Create or refresh the execution plan before continuing with an objective.",
    input: Object.freeze({ hint: "objective" }),
  }),
])

function providerApiType(protocol) {
  return protocol === "anthropic-messages" ? "anthropic" : "openai"
}

function modelProtocolForProvider(apiType, currentProtocol) {
  if (apiType === "anthropic") {
    return "anthropic-messages"
  }

  return currentProtocol === "openai-chat" ? "openai-chat" : "openai-responses"
}

function piApiForProvider(apiType, modelProtocol) {
  if (apiType === "anthropic") {
    return "anthropic-messages"
  }

  return modelProtocol === "openai-chat"
    ? "openai-completions"
    : "openai-responses"
}

function normalizeProviderBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw RequestError.invalidParams(
      undefined,
      "ACP provider baseUrl must be a non-empty absolute URL."
    )
  }

  let url

  try {
    url = new URL(value.trim())
  } catch {
    throw RequestError.invalidParams(
      undefined,
      "ACP provider baseUrl must be a non-empty absolute URL."
    )
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw RequestError.invalidParams(
      undefined,
      "ACP provider baseUrl must use http or https."
    )
  }

  const sensitiveQueryName =
    /^(?:api[-_]?key|access[-_]?token|auth|authorization|credential|key|password|secret|token)$/i

  if (
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((name) => sensitiveQueryName.test(name))
  ) {
    throw RequestError.invalidParams(
      undefined,
      "ACP provider baseUrl must not contain credentials; pass authentication through headers."
    )
  }

  return value.trim()
}

function normalizeProviderHeaders(value) {
  if (value === undefined) {
    return {}
  }

  const headers = getRecord(value)

  if (!headers) {
    throw RequestError.invalidParams(
      undefined,
      "ACP provider headers must be a string map."
    )
  }

  return Object.fromEntries(
    Object.entries(headers).map(([name, headerValue]) => {
      if (
        !name.trim() ||
        /[\r\n]/.test(name) ||
        typeof headerValue !== "string" ||
        /[\r\n]/.test(headerValue)
      ) {
        throw RequestError.invalidParams(
          undefined,
          "ACP provider headers must be a valid string map."
        )
      }

      return [name, headerValue]
    })
  )
}

function hasProviderHeader(headers, expectedName) {
  const expected = expectedName.toLowerCase()

  return Object.keys(headers).some((name) => name.toLowerCase() === expected)
}

function runtimeProviderHeaders(apiType, headers) {
  const runtimeHeaders = { ...headers }

  if (apiType === "openai") {
    if (!hasProviderHeader(headers, "authorization")) {
      runtimeHeaders.Authorization = null
    }

    return runtimeHeaders
  }

  if (!hasProviderHeader(headers, "x-api-key")) {
    runtimeHeaders["x-api-key"] = null
  }
  if (!hasProviderHeader(headers, "authorization")) {
    runtimeHeaders.Authorization = null
  }

  return runtimeHeaders
}

function sessionModes(currentModeId = DEFAULT_SESSION_MODE_ID) {
  return {
    currentModeId,
    availableModes: SESSION_MODES.map((mode) => ({ ...mode })),
  }
}

function encodeSessionListCursor(offset, cwd) {
  return Buffer.from(
    JSON.stringify({ version: 1, offset, cwd: cwd || null }),
    "utf8"
  ).toString("base64url")
}

function decodeSessionListCursor(cursor, cwd) {
  if (!cursor) {
    return 0
  }

  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))

    if (
      getRecord(value)?.version !== 1 ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 0 ||
      (value.cwd ?? null) !== (cwd || null)
    ) {
      throw new Error("invalid cursor payload")
    }

    return value.offset
  } catch {
    throw new Error("Invalid or expired ACP session/list cursor.")
  }
}

function resolveAdditionalDirectories(values) {
  if (values === undefined) {
    return []
  }

  if (!Array.isArray(values)) {
    throw new Error("ACP additionalDirectories must be an array.")
  }

  const directories = []
  const seen = new Set()

  for (const value of values) {
    if (typeof value !== "string" || !path.isAbsolute(value)) {
      throw new Error(
        "ACP additionalDirectories entries must be absolute paths."
      )
    }

    const directory = realpathSync(value)

    if (!seen.has(directory)) {
      seen.add(directory)
      directories.push(directory)
    }
  }

  return directories
}

function loadNativeSkills(cwd, additionalDirectories) {
  if (!additionalDirectories.length) {
    return []
  }

  return loadSkills({
    cwd,
    agentDir: path.join(cwd, ".astraflow-agent"),
    includeDefaults: false,
    skillPaths: additionalDirectories.map((directory) =>
      path.join(directory, ".agents", "skills")
    ),
  }).skills
}

function defaultStateRoot() {
  return (
    process.env.ASTRAFLOW_ACP_STATE_ROOT?.trim() ||
    "/root/.astraflow/acp-sessions"
  )
}

function contentBlockToText(block) {
  if (block?.type === "text" && typeof block.text === "string") {
    return block.text
  }

  if (block?.type === "resource_link") {
    return `[Referenced resource: ${block.name || block.uri}]\n${block.uri}`
  }

  if (block?.type === "resource") {
    const resource = getRecord(block.resource)

    if (typeof resource?.text === "string") {
      return `[Embedded resource: ${resource.uri || "resource"}]\n${resource.text}`
    }

    return `[Embedded resource: ${resource?.uri || "binary resource"}]`
  }

  if (block?.type === "audio") {
    return `[Audio input: ${block.mimeType || "audio"}]`
  }

  return stringify(block)
}

export function expandAstraflowSlashCommand(value) {
  const match = /^\/(status|review|plan)(?:\s+([\s\S]*))?$/i.exec(value.trim())

  if (!match) {
    return value
  }

  const command = match[1].toLowerCase()
  const input = match[2]?.trim() || ""

  if (command === "status") {
    return "Summarize the current work status: completed work, active work, blockers, and the next concrete step. Do not modify files for this status request."
  }

  if (command === "review") {
    return `Review the current workspace changes for correctness, regressions, security concerns, and missing verification.${input ? ` Focus on: ${input}` : ""}`
  }

  return `Create or refresh a concise execution plan with the plan tool, then continue with this objective: ${input || "the current user request"}`
}

function promptToUserMessage(prompt) {
  const content = prompt.flatMap((block) => {
    if (
      block?.type === "image" &&
      typeof block.data === "string" &&
      typeof block.mimeType === "string"
    ) {
      return [
        {
          type: "image",
          data: block.data,
          mimeType: block.mimeType,
        },
      ]
    }

    const text = contentBlockToText(block)

    return text
      ? [{ type: "text", text: expandAstraflowSlashCommand(text) }]
      : []
  })
  const hasImage = content.some((entry) => entry.type === "image")

  return {
    role: "user",
    content: hasImage
      ? content
      : content
          .map((entry) => entry.text)
          .filter(Boolean)
          .join("\n\n"),
    timestamp: Date.now(),
  }
}

function contextLimit(model) {
  return Number.isSafeInteger(model?.contextWindow) && model.contextWindow > 0
    ? model.contextWindow
    : 128_000
}

export function summarizePiSessionUsage(messages, model) {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cachedReadTokens: 0,
    cachedWriteTokens: 0,
    totalTokens: 0,
  }
  let cost = 0

  for (const message of messages) {
    if (message?.role !== "assistant" || !message.usage) {
      continue
    }

    usage.inputTokens += Math.max(0, message.usage.input || 0)
    usage.outputTokens += Math.max(0, message.usage.output || 0)
    usage.cachedReadTokens += Math.max(0, message.usage.cacheRead || 0)
    usage.cachedWriteTokens += Math.max(0, message.usage.cacheWrite || 0)
    cost += Math.max(0, message.usage.cost?.total || 0)
  }

  usage.totalTokens =
    usage.inputTokens +
    usage.outputTokens +
    usage.cachedReadTokens +
    usage.cachedWriteTokens

  return {
    promptUsage: usage,
    update: {
      sessionUpdate: "usage_update",
      used: Math.max(0, estimateContextTokens(messages).tokens),
      size: contextLimit(model),
      ...(cost > 0
        ? { cost: { amount: cost, currency: "USD" } }
        : {}),
    },
  }
}

async function notifyAvailableCommands(client, sessionId) {
  await client.notify(methods.client.session.update, {
    sessionId,
    update: {
      sessionUpdate: "available_commands_update",
      availableCommands: ASTRAFLOW_AVAILABLE_COMMANDS,
    },
  })
}

function compactionSettings(model) {
  const window = contextLimit(model)
  const modelMaxTokens =
    Number.isSafeInteger(model?.maxTokens) && model.maxTokens > 0
      ? model.maxTokens
      : DEFAULT_COMPACTION_RESERVE_TOKENS
  const maxReserveTokens = Math.max(1, Math.floor(window * 0.4))
  const reserveTokens = Math.min(
    maxReserveTokens,
    Math.max(
      Math.min(1_024, maxReserveTokens),
      Math.max(DEFAULT_COMPACTION_RESERVE_TOKENS, modelMaxTokens)
    )
  )
  const keepRecentTokens = Math.max(
    512,
    Math.min(
      DEFAULT_COMPACTION_KEEP_RECENT_TOKENS,
      Math.floor((window - reserveTokens) * 0.5)
    )
  )

  return { keepRecentTokens, reserveTokens, window }
}

function compactionCutIndex(messages, keepRecentTokens) {
  let tokens = 0
  let index = messages.length

  while (index > 0) {
    const nextTokens = estimateTokens(messages[index - 1])

    if (tokens > 0 && tokens + nextTokens > keepRecentTokens) {
      break
    }

    index -= 1
    tokens += nextTokens
  }

  // Never retain a tool result without the assistant tool call that produced
  // it. Starting at either a user or assistant message is valid once the
  // generated checkpoint summary is inserted before the retained suffix.
  while (index > 0 && messages[index]?.role === "toolResult") {
    index -= 1
  }

  return index
}

function summaryStream({ onPayload, streamFn }) {
  const runStream = streamFn || streamSimple

  if (!onPayload) {
    return runStream
  }

  return (model, context, options = {}) =>
    runStream(model, context, { ...options, onPayload })
}

/**
 * Apply Pi's native summary format before a model request can exceed its
 * context window. The returned summary is persisted with recent Pi messages,
 * so resumed ACP sessions do not repeatedly summarize the same history.
 */
export async function compactPiHistory({
  apiKey,
  messages,
  model,
  onPayload,
  pendingMessages = [],
  signal,
  streamFn,
  summarize = generateSummary,
  systemPrompt = "",
  thinkingLevel = "off",
}) {
  const { keepRecentTokens, reserveTokens, window } = compactionSettings(model)
  const tokens =
    estimateContextTokens([...messages, ...pendingMessages]).tokens +
    Math.ceil(systemPrompt.length / 4)

  if (tokens <= window - reserveTokens || messages.length < 2) {
    return messages
  }

  const cutIndex = compactionCutIndex(messages, keepRecentTokens)

  if (cutIndex <= 0) {
    return messages
  }

  const prefix = messages.slice(0, cutIndex)
  const previousSummary = [...prefix]
    .reverse()
    .find((message) => message?.role === "compactionSummary")?.summary
  const messagesToSummarize = prefix.filter(
    (message) => message?.role !== "compactionSummary"
  )

  if (!messagesToSummarize.length && !previousSummary) {
    return messages
  }

  try {
    const summary = await summarize(
      messagesToSummarize,
      model,
      reserveTokens,
      apiKey,
      undefined,
      signal,
      undefined,
      previousSummary,
      thinkingLevel,
      summaryStream({ onPayload, streamFn })
    )

    if (!summary?.trim()) {
      throw new Error("Pi returned an empty context summary.")
    }

    return [
      createCompactionSummaryMessage(
        summary.trim(),
        tokens,
        new Date().toISOString()
      ),
      ...messages.slice(cutIndex),
    ]
  } catch (error) {
    console.warn("[astraflow-acp] context_compaction_failed", {
      error: asErrorMessage(error),
    })
    return messages
  }
}

export function createContextTransform(options) {
  let cache = null

  const transform = async (messages, signal) => {
    const effectiveMessages = cache
      ? [...cache.messages, ...messages.slice(cache.sourceLength)]
      : messages
    const compacted = await compactPiHistory({
      ...options,
      messages: effectiveMessages,
      signal,
    })

    if (compacted !== effectiveMessages) {
      cache = { messages: compacted, sourceLength: messages.length }
      return compacted
    }

    if (cache) {
      cache = { messages: effectiveMessages, sourceLength: messages.length }
    }

    return effectiveMessages
  }

  transform.materialize = (messages) =>
    cache
      ? [...cache.messages, ...messages.slice(cache.sourceLength)]
      : messages

  return transform
}

function createTurnLimitHook(getAgent) {
  let completedTurns = 0

  const hook = () => {
    completedTurns += 1

    if (completedTurns >= ASTRAFLOW_ACP_RECURSION_LIMIT) {
      hook.exhausted = true
      getAgent()?.abort()
    }
  }

  hook.exhausted = false
  return hook
}

function isAbortError(error, signal) {
  return (
    signal.aborted ||
    getRecord(error)?.name === "AbortError" ||
    /abort|cancel/i.test(asErrorMessage(error))
  )
}

function textResult(text, details = {}) {
  return {
    content: [{ type: "text", text }],
    details,
  }
}

function directInvoke(tool, input) {
  return tool.execute("direct-invoke", input).then((result) =>
    result.content
      .filter((entry) => entry.type === "text")
      .map((entry) => entry.text)
      .join("\n")
  )
}

export function createRequestUserInputTool({ client, sessionId, signal }) {
  const inputTool = {
    name: "request_user_input",
    label: "Request user input",
    description:
      "Ask one to three concise structured questions when a user choice materially changes the result.",
    parameters: Type.Object({
      questions: Type.Array(
        Type.Object({
          id: Type.Optional(Type.String()),
          header: Type.Optional(Type.String({ maxLength: 24 })),
          question: Type.String({ minLength: 1 }),
          options: Type.Optional(
            Type.Array(
              Type.Object({
                label: Type.String({ minLength: 1 }),
                value: Type.Optional(Type.String()),
                description: Type.Optional(Type.String()),
              }),
              { maxItems: 3 }
            )
          ),
        }),
        { minItems: 1, maxItems: 3 }
      ),
    }),
    async execute(_toolCallId, { questions }, toolSignal) {
      const properties = {}
      const required = []

      questions.forEach((question, index) => {
        const id = question.id?.trim() || `question_${index + 1}`
        const options = Array.isArray(question.options)
          ? question.options.filter((entry) => entry?.label?.trim())
          : []

        properties[id] = {
          type: "string",
          title: question.header?.trim() || `Question ${index + 1}`,
          description: question.question,
          ...(options.length
            ? {
                oneOf: options.map((entry) => ({
                  const: entry.value?.trim() || entry.label.trim(),
                  title: entry.label.trim(),
                  ...(entry.description?.trim()
                    ? { description: entry.description.trim() }
                    : {}),
                })),
              }
            : {}),
        }
        required.push(id)
      })

      const response = await client.request(
        methods.client.elicitation.create,
        {
          mode: "form",
          sessionId,
          message: "AstraFlow Agent needs your input to continue.",
          requestedSchema: {
            type: "object",
            properties,
            required,
          },
        },
        { cancellationSignal: toolSignal || signal }
      )

      if (response?.action !== "accept") {
        return textResult("The user cancelled or declined the input request.", {
          action: response?.action || "cancel",
        })
      }

      return textResult(stringify(response.content || {}), {
        action: "accept",
        content: response.content || {},
      })
    },
  }

  inputTool.invoke = (input) => directInvoke(inputTool, input)
  return inputTool
}

export function clientSupportsFormElicitation(clientCapabilities) {
  return Boolean(clientCapabilities?.elicitation?.form)
}

export function resolveAcpPromptStopReason({
  lastAssistantStopReason,
  signalAborted,
  turnLimitExhausted,
}) {
  if (turnLimitExhausted) {
    return "max_turn_requests"
  }

  if (signalAborted || lastAssistantStopReason === "aborted") {
    return "cancelled"
  }

  if (lastAssistantStopReason === "length") {
    return "max_tokens"
  }

  return "end_turn"
}

export function createPlanTool() {
  return {
    name: "plan",
    label: "Update plan",
    description:
      "Create or update a concise plan for genuinely multi-step work. Keep exactly one item in progress.",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String({ minLength: 1 }),
          priority: Type.Optional(
            Type.Union([
              Type.Literal("high"),
              Type.Literal("medium"),
              Type.Literal("low"),
            ])
          ),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
        }),
        { minItems: 1, maxItems: 50 }
      ),
    }),
    async execute(_toolCallId, { todos }) {
      const summary = todos
        .map(
          (todo) =>
            `- [${todo.status}] [${todo.priority || "medium"}] ${todo.content}`
        )
        .join("\n")

      return textResult(`Plan updated:\n${summary}`, { todos })
    },
  }
}

function finalAssistantText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message?.role !== "assistant" || !Array.isArray(message.content)) {
      continue
    }

    const text = message.content
      .filter((entry) => entry?.type === "text")
      .map((entry) => entry.text)
      .join("")
      .trim()

    if (text) {
      return text
    }
  }

  return "The task subagent completed without a textual report."
}

export function createTaskTool({
  backend,
  client,
  cwd,
  getApiKey,
  getTools,
  model,
  onPayload,
  retrySettings,
  sessionId,
  streamFn,
  systemPrompt,
  thinkingLevel,
}) {
  return {
    name: "task",
    label: "Delegate task",
    description:
      "Delegate one broad, independent objective to a temporary Pi Agent subagent in the same workspace.",
    parameters: Type.Object({
      task: Type.Optional(Type.String({ minLength: 1 })),
      prompt: Type.Optional(Type.String({ minLength: 1 })),
      description: Type.Optional(Type.String()),
    }),
    async execute(toolCallId, input, signal) {
      const objective =
        input.task?.trim() || input.prompt?.trim() || input.description?.trim()

      if (!objective) {
        throw new Error("The task tool requires a delegated objective.")
      }

      let subagent = null
      let subagentSession = null
      const turnLimitHook = createTurnLimitHook(() => subagent)
      const apiKey = await getApiKey(model.provider)
      const tools = getTools()
      const contextTransform = createContextTransform({
        apiKey,
        model,
        onPayload,
        streamFn,
        systemPrompt,
        thinkingLevel,
      })

      subagent = new Agent({
        initialState: {
          model,
          thinkingLevel,
          systemPrompt,
          tools,
          messages: [],
        },
        convertToLlm,
        transformContext: contextTransform,
        ...(streamFn ? { streamFn } : {}),
        getApiKey,
        ...(onPayload ? { onPayload } : {}),
        prepareNextTurn: turnLimitHook,
        sessionId: `${sessionId}:${toolCallId}`,
      })
      subagentSession = await createAstraflowPiSession({
        agent: subagent,
        apiKey,
        beforeToolCall: (context, toolSignal) =>
          backend.beforeToolCall(context, toolSignal),
        cwd,
        model,
        retrySettings,
        systemPrompt,
        tools,
      })
      const eventBridge = subscribePiSessionEventForwarder({
        agent: subagent,
        agentSession: subagentSession,
        client,
        sessionId,
        parentTaskId: toolCallId,
      })
      const abort = () => void subagentSession.abort()

      if (signal?.aborted) {
        abort()
      } else {
        signal?.addEventListener("abort", abort, { once: true })
      }

      try {
        await subagentSession.sendUserMessage(objective)
        await eventBridge.flush()
        const lastAssistant = [...subagent.state.messages]
          .reverse()
          .find((message) => message?.role === "assistant")

        if (
          signal?.aborted ||
          lastAssistant?.stopReason === "aborted" ||
          turnLimitHook.exhausted
        ) {
          throw (
            signal?.reason ||
            new Error(
              turnLimitHook.exhausted
                ? `Task subagent exceeded ${ASTRAFLOW_ACP_RECURSION_LIMIT} Pi turns.`
                : "Task subagent cancelled."
            )
          )
        }

        if (
          lastAssistant?.stopReason === "error" ||
          subagent.state.errorMessage
        ) {
          throw new Error(
            lastAssistant?.errorMessage ||
              subagent.state.errorMessage ||
              "Task subagent provider request failed."
          )
        }

        return textResult(finalAssistantText(subagent.state.messages), {
          taskId: toolCallId,
          messageCount: subagent.state.messages.length,
        })
      } finally {
        signal?.removeEventListener("abort", abort)
        eventBridge.unsubscribe()
        subagentSession.dispose()
      }
    },
  }
}

function desktopSessionIdFromParams(params) {
  const meta = getRecord(params?._meta)
  const astraflow = getRecord(meta?.astraflow)
  const desktopSessionId = astraflow?.desktopSessionId

  return typeof desktopSessionId === "string" && desktopSessionId.trim()
    ? desktopSessionId.trim().slice(0, 2048)
    : null
}

function sessionMeta(execution, desktopSessionId = null) {
  return {
    astraflow: {
      runtimeVersion: ASTRAFLOW_ACP_RUNTIME_VERSION,
      engine: "pi-agent",
      execution,
      checkpoint: "persistent-pi-messages",
      ...(desktopSessionId ? { desktopSessionId } : {}),
    },
  }
}

function normalizeModelRuntime(value) {
  const runtime = getRecord(value)
  const model = getRecord(runtime?.model) || runtime

  if (
    !model ||
    typeof model.id !== "string" ||
    typeof model.api !== "string" ||
    typeof model.provider !== "string"
  ) {
    throw new Error("AstraFlow Pi model factory returned an invalid model.")
  }

  return {
    model,
    thinkingLevel:
      typeof runtime?.thinkingLevel === "string"
        ? runtime.thinkingLevel
        : model.reasoning
          ? "medium"
          : "off",
    streamFn:
      typeof runtime?.streamFn === "function" ? runtime.streamFn : undefined,
    onPayload:
      typeof runtime?.onPayload === "function" ? runtime.onPayload : undefined,
  }
}

function sessionConfigOptions({
  modeId,
  model,
  modelConfig,
  supportedThinkingLevels,
  thinkingLevel,
}) {
  return [
    {
      id: "mode",
      name: "Session mode",
      description:
        "Controls the agent workflow independently from Desktop permission policy.",
      category: "mode",
      type: "select",
      currentValue: modeId,
      options: SESSION_MODES.map((mode) => ({
        value: mode.id,
        name: mode.name,
        description: mode.description,
      })),
    },
    {
      id: "model",
      name: "Model",
      category: "model",
      type: "select",
      currentValue: modelConfig.id,
      options: [
        {
          value: modelConfig.id,
          name: modelConfig.label || model.name || model.id,
          description: model.id,
        },
      ],
    },
    {
      id: "thought_level",
      name: "Reasoning effort",
      category: "thought_level",
      type: "select",
      currentValue: thinkingLevel,
      options: supportedThinkingLevels.map((value) => ({
        value,
        name: THINKING_LEVEL_NAMES[value] || value,
      })),
    },
  ]
}

function firstUserMessageTitle(messages) {
  const message = messages.find((entry) => entry?.role === "user")
  const parts =
    typeof message?.content === "string"
      ? [message.content]
      : Array.isArray(message?.content)
        ? message.content
            .filter((entry) => entry?.type === "text")
            .map((entry) => entry.text)
        : []
  const title = parts.join(" ").replace(/\s+/g, " ").trim()

  return title ? title.slice(0, 100) : null
}

function replayToolKind(name) {
  if (["read", "ls"].includes(name)) {
    return "read"
  }

  if (["find", "grep"].includes(name)) {
    return "search"
  }

  if (["edit", "write"].includes(name)) {
    return "edit"
  }

  if (["plan", "task"].includes(name)) {
    return "think"
  }

  return name === "bash" ? "execute" : "other"
}

function replayContentBlock(value) {
  if (value?.type === "text" && typeof value.text === "string") {
    return { ...value }
  }

  if (
    value?.type === "image" &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string"
  ) {
    return { ...value }
  }

  return null
}

async function replaySessionHistory({ client, record, signal }) {
  for (const [messageIndex, message] of record.history.entries()) {
    if (signal?.aborted) {
      throw signal.reason || new Error("ACP session/load cancelled.")
    }

    const messageId = `${record.sessionId}:replay:${messageIndex}`

    if (message.role === "user") {
      const blocks =
        typeof message.content === "string"
          ? [{ type: "text", text: message.content }]
          : message.content.map(replayContentBlock).filter(Boolean)

      for (const content of blocks) {
        await client.notify(methods.client.session.update, {
          sessionId: record.sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            messageId,
            content,
          },
        })
      }
      continue
    }

    if (message.role === "assistant") {
      for (const content of message.content) {
        if (content.type === "text") {
          await client.notify(methods.client.session.update, {
            sessionId: record.sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              messageId,
              content: { type: "text", text: content.text },
            },
          })
          continue
        }

        if (content.type === "thinking") {
          await client.notify(methods.client.session.update, {
            sessionId: record.sessionId,
            update: {
              sessionUpdate: "agent_thought_chunk",
              messageId,
              content: { type: "text", text: content.thinking },
            },
          })
          continue
        }

        if (content.type === "toolCall") {
          await client.notify(methods.client.session.update, {
            sessionId: record.sessionId,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: content.id,
              title: content.name,
              kind: replayToolKind(content.name),
              status: "in_progress",
              rawInput: content.arguments,
            },
          })
        }
      }
      continue
    }

    if (message.role === "toolResult") {
      const blocks = message.content.map(replayContentBlock).filter(Boolean)

      await client.notify(methods.client.session.update, {
        sessionId: record.sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: message.toolCallId,
          status: message.isError ? "failed" : "completed",
          content: blocks.map((content) => ({ type: "content", content })),
          rawOutput: {
            content: blocks,
            isError: message.isError,
          },
        },
      })
      continue
    }

    if (message.role === "compactionSummary") {
      await client.notify(methods.client.session.update, {
        sessionId: record.sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          messageId,
          content: { type: "text", text: message.summary },
          _meta: {
            astraflow: {
              replayKind: "compaction_summary",
              tokensBefore: message.tokensBefore,
            },
          },
        },
      })
    }
  }
}

export class AstraflowAcpAgent {
  constructor({
    configuration = readAstraflowRuntimeConfiguration(),
    modelFactory = createAstraflowPiModel,
    stateRoot = defaultStateRoot(),
    workspaceRoot = process.cwd(),
    agentSessionRetrySettings,
  } = {}) {
    this.configuration = configuration
    this.modelFactory = modelFactory
    this.modelRuntime = normalizeModelRuntime(modelFactory(configuration))
    this.model = this.modelRuntime.model
    this.supportedThinkingLevels = getSupportedThinkingLevels(this.model)
    this.providerConfig = {
      apiType: providerApiType(configuration.model.protocol),
      baseUrl: this.model.baseUrl,
      headers: { ...(configuration.model.headers || {}) },
    }
    this.execution = configuration.execution === "local" ? "local" : "sandbox"
    this.permissionMode = configuration.permissionMode
    this.workspaceRoot = realpathSync(workspaceRoot)
    this.store = new AstraflowSessionStore({ root: stateRoot })
    this.sessions = new Map()
    this.clientCapabilities = {}
    this.agentSessionRetrySettings = agentSessionRetrySettings
  }

  initialize(params = {}) {
    this.clientCapabilities = params.clientCapabilities || {}

    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: "AstraFlow Agent",
        title:
          this.execution === "local"
            ? "AstraFlow Agent (Local)"
            : "AstraFlow Agent (Sandbox)",
        version: ASTRAFLOW_ACP_RUNTIME_VERSION,
      },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          embeddedContext: true,
          image: this.model.input?.includes("image") === true,
          audio: false,
        },
        mcpCapabilities: { acp: true },
        providers: {},
        sessionCapabilities: {
          list: {},
          delete: {},
          resume: {},
          close: {},
          additionalDirectories: {},
        },
        _meta: {
          subagents: true,
          skills: true,
          astraflow: {
            execution: this.execution,
            features: ASTRAFLOW_ACP_FEATURES,
            runtimeVersion: ASTRAFLOW_ACP_RUNTIME_VERSION,
          },
        },
      },
      authMethods: [],
    }
  }

  listProviders() {
    return {
      providers: [
        {
          providerId: ASTRAFLOW_PROVIDER_ID,
          supported: [...SUPPORTED_PROVIDER_API_TYPES],
          required: true,
          current: {
            apiType: this.providerConfig.apiType,
            baseUrl: this.providerConfig.baseUrl,
          },
          _meta: {
            astraflow: {
              modelId: this.configuration.model.id,
            },
          },
        },
      ],
    }
  }

  async setProvider(params, client) {
    if (params.providerId !== ASTRAFLOW_PROVIDER_ID) {
      throw RequestError.invalidParams(
        undefined,
        `Unknown AstraFlow ACP provider: ${params.providerId}`
      )
    }

    if (!SUPPORTED_PROVIDER_API_TYPES.includes(params.apiType)) {
      throw RequestError.invalidParams(
        undefined,
        `Unsupported AstraFlow ACP provider API: ${params.apiType}`
      )
    }

    const baseUrl = normalizeProviderBaseUrl(params.baseUrl)
    const headers = normalizeProviderHeaders(params.headers)
    const modelProtocol = modelProtocolForProvider(
      params.apiType,
      this.configuration.model.protocol
    )
    const configuration = {
      ...this.configuration,
      apiKey: ACP_PROVIDER_PLACEHOLDER_API_KEY,
      model: {
        ...this.configuration.model,
        protocol: modelProtocol,
        baseUrl,
        headers,
      },
    }
    const builtRuntime = normalizeModelRuntime(this.modelFactory(configuration))
    const model = {
      ...builtRuntime.model,
      api: piApiForProvider(params.apiType, modelProtocol),
      baseUrl,
      headers: runtimeProviderHeaders(params.apiType, headers),
    }

    this.configuration = configuration
    this.modelRuntime = { ...builtRuntime, model }
    this.model = model
    this.supportedThinkingLevels = getSupportedThinkingLevels(model)
    this.providerConfig = {
      apiType: params.apiType,
      baseUrl,
      headers,
    }

    await Promise.all(
      [...this.sessions.values()].map(async (session) => {
        session.thinkingLevel = this.normalizeThinkingLevel(
          session.thinkingLevel
        )
        await this.persistSessionSettings(session)
        await client.notify(methods.client.session.update, {
          sessionId: session.record.sessionId,
          update: {
            sessionUpdate: "config_option_update",
            configOptions: this.configOptionsForSession(session),
          },
        })
      })
    )

    return {}
  }

  disableProvider(params) {
    if (params.providerId !== ASTRAFLOW_PROVIDER_ID) {
      return {}
    }

    throw RequestError.invalidParams(
      undefined,
      `AstraFlow ACP provider ${ASTRAFLOW_PROVIDER_ID} is required and cannot be disabled.`
    )
  }

  normalizeThinkingLevel(value) {
    return this.supportedThinkingLevels.includes(value)
      ? value
      : this.modelRuntime.thinkingLevel
  }

  configOptionsForSession(session) {
    return sessionConfigOptions({
      modeId: session.modeId,
      model: this.model,
      modelConfig: this.configuration.model,
      supportedThinkingLevels: this.supportedThinkingLevels,
      thinkingLevel: session.thinkingLevel,
    })
  }

  sessionSetupResponse(session) {
    return {
      modes: sessionModes(session.modeId),
      configOptions: this.configOptionsForSession(session),
      _meta: sessionMeta(this.execution, session.desktopSessionId),
    }
  }

  activeSession(sessionId) {
    const session = this.sessions.get(sessionId)

    if (!session || session.deleted) {
      throw new Error(`AstraFlow ACP session ${sessionId} is not active.`)
    }

    return session
  }

  sessionFromRecord(
    record,
    { additionalDirectories, desktopSessionId, mcpServers }
  ) {
    return {
      record,
      additionalDirectories,
      desktopSessionId,
      mcpServers,
      modeId:
        record.modeId === DEFAULT_SESSION_MODE_ID
          ? record.modeId
          : DEFAULT_SESSION_MODE_ID,
      thinkingLevel: this.normalizeThinkingLevel(record.thinkingLevel),
      abortController: null,
      activeAgentSession: null,
      activePiAgent: null,
      activePromptDone: null,
      deleted: false,
    }
  }

  resolveCwd(requestedCwd) {
    if (typeof requestedCwd !== "string" || !path.isAbsolute(requestedCwd)) {
      throw new Error("ACP session cwd must be an absolute path.")
    }

    const cwd = realpathSync(requestedCwd)
    const relation = path.relative(this.workspaceRoot, cwd)

    if (
      relation === ".." ||
      relation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relation)
    ) {
      throw new Error(`ACP session cwd must stay inside ${this.workspaceRoot}.`)
    }

    return cwd
  }

  async newSession(params, client) {
    assertSupportedMcpServers(params.mcpServers || [])
    const now = new Date().toISOString()
    const additionalDirectories = resolveAdditionalDirectories(
      params.additionalDirectories
    )
    const record = {
      schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
      sessionId: randomUUID(),
      cwd: this.resolveCwd(params.cwd),
      additionalDirectories,
      history: [],
      createdAt: now,
      updatedAt: now,
      modeId: DEFAULT_SESSION_MODE_ID,
      thinkingLevel: this.modelRuntime.thinkingLevel,
    }

    await this.store.save(record)
    const session = this.sessionFromRecord(record, {
      additionalDirectories,
      desktopSessionId: desktopSessionIdFromParams(params),
      mcpServers: params.mcpServers || [],
    })
    this.sessions.set(record.sessionId, session)
    await notifyAvailableCommands(client, record.sessionId)

    return {
      sessionId: record.sessionId,
      ...this.sessionSetupResponse(session),
    }
  }

  async restoreSession(params) {
    assertSupportedMcpServers(params.mcpServers || [])
    const storedRecord = await this.store.load(params.sessionId)

    if (!storedRecord) {
      throw new Error(
        `AstraFlow ACP session ${params.sessionId} was not found.`
      )
    }

    const cwd = this.resolveCwd(params.cwd)
    const additionalDirectories = resolveAdditionalDirectories(
      params.additionalDirectories
    )

    if (cwd !== storedRecord.cwd) {
      throw new Error(
        "AstraFlow ACP session cwd does not match its checkpoint."
      )
    }

    const record = {
      ...storedRecord,
      additionalDirectories,
      modeId:
        storedRecord.modeId === DEFAULT_SESSION_MODE_ID
          ? storedRecord.modeId
          : DEFAULT_SESSION_MODE_ID,
      thinkingLevel: this.normalizeThinkingLevel(storedRecord.thinkingLevel),
      updatedAt: new Date().toISOString(),
    }
    const session = this.sessionFromRecord(record, {
      additionalDirectories,
      desktopSessionId: desktopSessionIdFromParams(params),
      mcpServers: params.mcpServers || [],
    })

    await this.store.save(record)
    this.sessions.set(record.sessionId, session)

    return session
  }

  async loadSession(params, client, signal) {
    const session = await this.restoreSession(params)

    await replaySessionHistory({ client, record: session.record, signal })
    await notifyAvailableCommands(client, session.record.sessionId)

    return this.sessionSetupResponse(session)
  }

  async resumeSession(params, client) {
    const session = await this.restoreSession(params)
    await notifyAvailableCommands(client, session.record.sessionId)

    return this.sessionSetupResponse(session)
  }

  async listSessions(params) {
    const cwd = params.cwd ? this.resolveCwd(params.cwd) : null
    const offset = decodeSessionListCursor(params.cursor, cwd)
    const records = (await this.store.list()).filter(
      (record) => !cwd || record.cwd === cwd
    )

    if (offset > records.length) {
      throw new Error("Invalid or expired ACP session/list cursor.")
    }

    const page = records.slice(offset, offset + SESSION_LIST_PAGE_SIZE)
    const nextOffset = offset + page.length

    return {
      sessions: page.map((record) => ({
        sessionId: record.sessionId,
        cwd: record.cwd,
        additionalDirectories: record.additionalDirectories || [],
        updatedAt: record.updatedAt,
        title: record.title || "AstraFlow Agent",
        _meta: {
          ...sessionMeta(this.execution),
          messageCount: record.history.length,
        },
      })),
      ...(nextOffset < records.length
        ? { nextCursor: encodeSessionListCursor(nextOffset, cwd) }
        : {}),
    }
  }

  async persistSessionSettings(session) {
    if (session.deleted) {
      return
    }

    session.record = {
      ...session.record,
      additionalDirectories: [...session.additionalDirectories],
      modeId: session.modeId,
      thinkingLevel: session.thinkingLevel,
      updatedAt: new Date().toISOString(),
    }
    await this.store.save(session.record)
  }

  async setSessionMode(params, client) {
    const session = this.activeSession(params.sessionId)

    if (params.modeId !== DEFAULT_SESSION_MODE_ID) {
      throw new Error(
        `Unsupported AstraFlow ACP session mode: ${params.modeId}`
      )
    }

    session.modeId = params.modeId
    await this.persistSessionSettings(session)
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "current_mode_update",
        currentModeId: session.modeId,
      },
    })

    return {}
  }

  async setSessionConfigOption(params, client) {
    const session = this.activeSession(params.sessionId)

    if (params.configId === "mode") {
      if (params.value !== DEFAULT_SESSION_MODE_ID) {
        throw new Error(
          `Unsupported AstraFlow ACP session mode: ${params.value}`
        )
      }

      session.modeId = params.value
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "current_mode_update",
          currentModeId: session.modeId,
        },
      })
    } else if (params.configId === "model") {
      if (params.value !== this.configuration.model.id) {
        throw new Error(`Unsupported AstraFlow ACP model: ${params.value}`)
      }
    } else if (params.configId === "thought_level") {
      if (
        typeof params.value !== "string" ||
        !this.supportedThinkingLevels.includes(params.value)
      ) {
        throw new Error(
          `Unsupported AstraFlow ACP reasoning effort: ${String(params.value)}`
        )
      }

      session.thinkingLevel = params.value

      if (session.activePiAgent) {
        session.activePiAgent.state.thinkingLevel = params.value
      }
    } else {
      throw new Error(
        `Unknown AstraFlow ACP session config option: ${params.configId}`
      )
    }

    await this.persistSessionSettings(session)
    const configOptions = this.configOptionsForSession(session)

    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: {
        sessionUpdate: "config_option_update",
        configOptions,
      },
    })

    return { configOptions }
  }

  async deleteSession(params) {
    const session = this.sessions.get(params.sessionId)
    const activePromptDone = session?.activePromptDone

    if (session) {
      session.deleted = true
      this.cancel(params)
      await activePromptDone?.catch(() => undefined)
      this.sessions.delete(params.sessionId)
    }

    await this.store.delete(params.sessionId)
    return {}
  }

  async closeSession(params) {
    const session = this.sessions.get(params.sessionId)
    const activePromptDone = session?.activePromptDone

    if (session) {
      this.cancel(params)
      await activePromptDone?.catch(() => undefined)
      this.sessions.delete(params.sessionId)
    }

    return {}
  }

  cancel(params) {
    const session = this.sessions.get(params.sessionId)

    session?.abortController?.abort(new Error("AstraFlow ACP run cancelled."))
    void session?.activeAgentSession?.abort()
  }

  projectMemoryFiles(cwd) {
    const memoryFile = path.join(cwd, "AGENTS.md")

    return existsSync(memoryFile) ? [memoryFile] : []
  }

  async projectInstructions(cwd) {
    const [memoryFile] = this.projectMemoryFiles(cwd)

    if (!memoryFile) {
      return ""
    }

    const content = await readFile(memoryFile)
    const bounded = content.subarray(0, MAX_PROJECT_INSTRUCTIONS_BYTES)

    return `\n\nProject instructions loaded from ${memoryFile}:\n<project_instructions>\n${bounded.toString("utf8")}\n</project_instructions>`
  }

  async saveAgentHistory(session, messages) {
    if (session.deleted) {
      return
    }

    const title = session.record.title || firstUserMessageTitle(messages)

    session.record = {
      ...session.record,
      additionalDirectories: [...session.additionalDirectories],
      history: boundedPiHistory(messages),
      modeId: session.modeId,
      thinkingLevel: session.thinkingLevel,
      ...(title ? { title } : {}),
      updatedAt: new Date().toISOString(),
    }
    await this.store.save(session.record)
  }

  async prompt(params, client, requestSignal) {
    const session = this.activeSession(params.sessionId)
    const runtimeConfiguration = this.configuration
    const modelRuntime = this.modelRuntime

    if (session.abortController) {
      throw new Error("AstraFlow ACP session already has an active prompt.")
    }

    const abortController = new AbortController()
    let resolveActivePrompt
    const activePromptDone = new Promise((resolve) => {
      resolveActivePrompt = resolve
    })
    const abortFromRequest = () =>
      abortController.abort(
        requestSignal?.reason || new Error("ACP prompt request cancelled.")
      )

    session.abortController = abortController
    session.activePromptDone = activePromptDone

    if (requestSignal?.aborted) {
      abortFromRequest()
    } else {
      requestSignal?.addEventListener("abort", abortFromRequest, { once: true })
    }

    let nativeSkills = []
    let backend = null
    let mcp = null
    let piAgent = null
    let piAgentSession = null
    let contextTransform = null
    let eventBridge = null
    let abort = null
    let turnLimitHook = null
    let promptUsage = null

    const persistAndPublishUsage = async () => {
      if (!piAgent) {
        return null
      }

      const messages = contextTransform
        ? contextTransform.materialize(piAgent.state.messages)
        : piAgent.state.messages

      await this.saveAgentHistory(session, messages)
      const summary = summarizePiSessionUsage(messages, modelRuntime.model)

      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: summary.update,
      })
      await client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "session_info_update",
          title: session.record.title || null,
          updatedAt: session.record.updatedAt,
        },
      })
      promptUsage = summary.promptUsage
      return promptUsage
    }

    try {
      nativeSkills = loadNativeSkills(
        session.record.cwd,
        session.additionalDirectories
      )
      backend = new AcpPermissionBackend({
        additionalRoots: session.additionalDirectories,
        client,
        cwd: session.record.cwd,
        permissionMode: this.permissionMode,
        readOnlyRoots: nativeSkills.map((skill) => skill.baseDir),
        sessionId: params.sessionId,
        signal: abortController.signal,
      })
      await backend.ensureReady()
      mcp = await createAcpMcpTools({
        client,
        cwd: session.record.cwd,
        mcpServers: session.mcpServers,
        sessionId: params.sessionId,
        signal: abortController.signal,
      })
      const projectInstructions = await this.projectInstructions(
        session.record.cwd
      )
      const skillsPrompt = formatSkillsForPrompt(nativeSkills)
      const mcpFailurePrompt = formatMcpConnectionFailures(mcp.failures)
      const systemPrompt = `${baseSystemPrompt(this.execution)}${projectInstructions}${skillsPrompt}${mcpFailurePrompt}`
      const subagentSystemPrompt = `${subagentPrompt(this.execution)}${projectInstructions}${skillsPrompt}${mcpFailurePrompt}`
      const builtinTools = backend.createTools()
      const planTool = createPlanTool()
      const requestInputTool = clientSupportsFormElicitation(
        this.clientCapabilities
      )
        ? createRequestUserInputTool({
            client,
            sessionId: params.sessionId,
            signal: abortController.signal,
          })
        : null
      const getApiKey = () => runtimeConfiguration.apiKey
      const subagentTools = () => [
        ...builtinTools,
        createPlanTool(),
        ...mcp.tools,
      ]
      const taskTool = createTaskTool({
        backend,
        client,
        cwd: session.record.cwd,
        getApiKey,
        getTools: subagentTools,
        model: modelRuntime.model,
        onPayload: modelRuntime.onPayload,
        retrySettings: this.agentSessionRetrySettings,
        sessionId: params.sessionId,
        streamFn: modelRuntime.streamFn,
        systemPrompt: subagentSystemPrompt,
        thinkingLevel: session.thinkingLevel,
      })
      const tools = [
        ...builtinTools,
        planTool,
        taskTool,
        ...(requestInputTool ? [requestInputTool] : []),
        ...mcp.tools,
      ]
      const userMessage = promptToUserMessage(params.prompt)
      const compactedHistory = await compactPiHistory({
        apiKey: runtimeConfiguration.apiKey,
        messages: session.record.history,
        model: modelRuntime.model,
        onPayload: modelRuntime.onPayload,
        pendingMessages: [userMessage],
        signal: abortController.signal,
        streamFn: modelRuntime.streamFn,
        systemPrompt,
        thinkingLevel: session.thinkingLevel,
      })

      if (compactedHistory !== session.record.history) {
        await this.saveAgentHistory(session, compactedHistory)
      }

      turnLimitHook = createTurnLimitHook(() => piAgent)

      contextTransform = createContextTransform({
        apiKey: runtimeConfiguration.apiKey,
        model: modelRuntime.model,
        onPayload: modelRuntime.onPayload,
        streamFn: modelRuntime.streamFn,
        systemPrompt,
        thinkingLevel: session.thinkingLevel,
      })

      piAgent = new Agent({
        initialState: {
          model: modelRuntime.model,
          thinkingLevel: session.thinkingLevel,
          systemPrompt,
          tools,
          messages: compactedHistory,
        },
        convertToLlm,
        transformContext: contextTransform,
        ...(modelRuntime.streamFn ? { streamFn: modelRuntime.streamFn } : {}),
        getApiKey,
        ...(modelRuntime.onPayload
          ? { onPayload: modelRuntime.onPayload }
          : {}),
        prepareNextTurn: turnLimitHook,
        sessionId: params.sessionId,
      })
      session.activePiAgent = piAgent
      piAgentSession = await createAstraflowPiSession({
        agent: piAgent,
        apiKey: runtimeConfiguration.apiKey,
        beforeToolCall: (context, signal) =>
          backend.beforeToolCall(context, signal),
        cwd: session.record.cwd,
        model: modelRuntime.model,
        retrySettings: this.agentSessionRetrySettings,
        systemPrompt,
        tools,
      })
      session.activeAgentSession = piAgentSession
      eventBridge = subscribePiSessionEventForwarder({
        agent: piAgent,
        agentSession: piAgentSession,
        client,
        sessionId: params.sessionId,
      })
      abort = () => void piAgentSession.abort()

      if (abortController.signal.aborted) {
        abort()
      } else {
        abortController.signal.addEventListener("abort", abort, { once: true })
      }

      await piAgentSession.sendUserMessage(userMessage.content)
      await eventBridge.flush()

      await persistAndPublishUsage()

      const lastAssistant = [...piAgent.state.messages]
        .reverse()
        .find((message) => message?.role === "assistant")

      if (lastAssistant?.stopReason === "error" || piAgent.state.errorMessage) {
        throw new Error(
          lastAssistant?.errorMessage ||
            piAgent.state.errorMessage ||
            "Pi Agent provider request failed."
        )
      }

      return {
        stopReason: resolveAcpPromptStopReason({
          lastAssistantStopReason: lastAssistant?.stopReason,
          signalAborted: abortController.signal.aborted,
          turnLimitExhausted: turnLimitHook.exhausted,
        }),
        ...(promptUsage ? { usage: promptUsage } : {}),
        _meta: sessionMeta(this.execution, session.desktopSessionId),
      }
    } catch (error) {
      if (turnLimitHook?.exhausted) {
        if (piAgent) {
          await persistAndPublishUsage().catch(() => undefined)
        }

        return {
          stopReason: "max_turn_requests",
          ...(promptUsage ? { usage: promptUsage } : {}),
          _meta: sessionMeta(this.execution, session.desktopSessionId),
        }
      }

      if (isAbortError(error, abortController.signal)) {
        if (piAgent) {
          await persistAndPublishUsage().catch(() => undefined)
        }

        return {
          stopReason: "cancelled",
          ...(promptUsage ? { usage: promptUsage } : {}),
          _meta: sessionMeta(this.execution, session.desktopSessionId),
        }
      }

      throw error
    } finally {
      requestSignal?.removeEventListener("abort", abortFromRequest)

      if (abort) {
        abortController.signal.removeEventListener("abort", abort)
      }

      eventBridge?.unsubscribe()
      piAgentSession?.dispose()

      try {
        await mcp?.close().catch(() => undefined)
        await backend?.close().catch(() => undefined)
      } finally {
        session.abortController = null
        session.activeAgentSession = null
        session.activePiAgent = null

        if (session.activePromptDone === activePromptDone) {
          session.activePromptDone = null
        }

        resolveActivePrompt?.()
      }
    }
  }

  shutdown() {
    for (const session of this.sessions.values()) {
      session.abortController?.abort(new Error("AstraFlow ACP shutting down."))
      void session.activeAgentSession?.abort()
    }
  }
}

export function createAstraflowAcpApp(options = {}) {
  const runtime = new AstraflowAcpAgent(options)
  const app = createAgentApp({
    name: "astraflow-acp",
    version: ASTRAFLOW_ACP_RUNTIME_VERSION,
  })
    .onRequest(methods.agent.initialize, ({ params }) =>
      runtime.initialize(params)
    )
    .onRequest(methods.agent.providers.list, () => runtime.listProviders())
    .onRequest(methods.agent.providers.set, ({ params, client }) =>
      runtime.setProvider(params, client)
    )
    .onRequest(methods.agent.providers.disable, ({ params }) =>
      runtime.disableProvider(params)
    )
    .onRequest(methods.agent.session.new, ({ params, client }) =>
      runtime.newSession(params, client)
    )
    .onRequest(methods.agent.session.load, ({ params, client, signal }) =>
      runtime.loadSession(params, client, signal)
    )
    .onRequest(methods.agent.session.resume, ({ params, client }) =>
      runtime.resumeSession(params, client)
    )
    .onRequest(methods.agent.session.list, ({ params }) =>
      runtime.listSessions(params)
    )
    .onRequest(methods.agent.session.delete, ({ params }) =>
      runtime.deleteSession(params)
    )
    .onRequest(methods.agent.session.close, ({ params }) =>
      runtime.closeSession(params)
    )
    .onRequest(methods.agent.session.setMode, ({ params, client }) =>
      runtime.setSessionMode(params, client)
    )
    .onRequest(methods.agent.session.setConfigOption, ({ params, client }) =>
      runtime.setSessionConfigOption(params, client)
    )
    .onRequest(methods.agent.session.prompt, ({ params, client, signal }) =>
      runtime.prompt(params, client, signal)
    )
    .onNotification(methods.agent.session.cancel, ({ params }) =>
      runtime.cancel(params)
    )

  return { app, runtime }
}
