import {
  PROTOCOL_VERSION,
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
import { Type } from "@earendil-works/pi-ai"
import { streamSimple } from "@earendil-works/pi-ai/compat"
import { generateSummary } from "@earendil-works/pi-coding-agent"
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
import { createAcpMcpTools } from "./mcp-tools.mjs"
import {
  createAstraflowPiModel,
  readAstraflowRuntimeConfiguration,
} from "./model.mjs"
import { AstraflowSessionStore, boundedPiHistory } from "./session-store.mjs"
import { createPiEventForwarder } from "./stream.mjs"

const BASE_SYSTEM_PROMPT = `You are AstraFlow Agent, powered by Pi Agent, running inside the user's selected persistent Sandbox workspace.

The model, Pi orchestration, planning, subagents, filesystem tools, and terminal execution run in this Sandbox. AstraFlow Desktop owns the UI, session record, permission prompts, API-key vault, and bridged local MCP servers.

Work from the selected workspace. Read relevant files before editing. Use the plan tool to keep genuinely multi-step work current, and the task tool only for a broad independent subtask. Verify results with focused commands. Do not claim a result that was not observed. Never print, search for, or expose runtime credentials. Use request_user_input only when the answer materially changes the result.`

const SUBAGENT_PROMPT = `You are an AstraFlow Agent task subagent powered by Pi Agent and running inside the same Sandbox workspace. Complete only the delegated objective, use concrete workspace evidence, and return a concise report to the parent Agent. You cannot ask the user questions or delegate another subagent.`
const MAX_PROJECT_INSTRUCTIONS_BYTES = 256 * 1024
const DEFAULT_COMPACTION_RESERVE_TOKENS = 16_384
const DEFAULT_COMPACTION_KEEP_RECENT_TOKENS = 20_000

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

  if (block?.type === "image") {
    return `[Image input: ${block.uri || block.mimeType || "image"}]`
  }

  if (block?.type === "audio") {
    return `[Audio input: ${block.mimeType || "audio"}]`
  }

  return stringify(block)
}

function promptToUserMessage(prompt) {
  return {
    role: "user",
    content: prompt.map(contentBlockToText).filter(Boolean).join("\n\n"),
    timestamp: Date.now(),
  }
}

function contextLimit(model) {
  return Number.isSafeInteger(model?.contextWindow) && model.contextWindow > 0
    ? model.contextWindow
    : 128_000
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
      Math.max(DEFAULT_COMPACTION_RESERVE_TOKENS, modelMaxTokens),
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
  const { keepRecentTokens, reserveTokens, window } =
    compactionSettings(model)
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
        { signal: toolSignal || signal }
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
        .map((todo) => `- [${todo.status}] ${todo.content}`)
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
  getApiKey,
  getTools,
  model,
  onPayload,
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
        input.task?.trim() ||
        input.prompt?.trim() ||
        input.description?.trim()

      if (!objective) {
        throw new Error("The task tool requires a delegated objective.")
      }

      let subagent = null
      const turnLimitHook = createTurnLimitHook(() => subagent)
      const contextTransform = createContextTransform({
        apiKey: await getApiKey(model.provider),
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
          tools: getTools(),
          messages: [],
        },
        convertToLlm,
        transformContext: contextTransform,
        ...(streamFn ? { streamFn } : {}),
        getApiKey,
        ...(onPayload ? { onPayload } : {}),
        beforeToolCall: (context, toolSignal) =>
          backend.beforeToolCall(context, toolSignal),
        prepareNextTurn: turnLimitHook,
        sessionId: `${sessionId}:${toolCallId}`,
      })
      const unsubscribe = subagent.subscribe(
        createPiEventForwarder({
          client,
          sessionId,
          parentTaskId: toolCallId,
        })
      )
      const abort = () => subagent.abort()

      if (signal?.aborted) {
        abort()
      } else {
        signal?.addEventListener("abort", abort, { once: true })
      }

      try {
        await subagent.prompt(objective)
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
        unsubscribe()
      }
    },
  }
}

function sessionMeta() {
  return {
    astraflow: {
      runtimeVersion: ASTRAFLOW_ACP_RUNTIME_VERSION,
      engine: "pi-agent",
      execution: "sandbox",
      checkpoint: "persistent-pi-messages",
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

export class AstraflowAcpAgent {
  constructor({
    configuration = readAstraflowRuntimeConfiguration(),
    modelFactory = createAstraflowPiModel,
    stateRoot = defaultStateRoot(),
    workspaceRoot = process.cwd(),
  } = {}) {
    this.configuration = configuration
    this.modelRuntime = normalizeModelRuntime(modelFactory(configuration))
    this.model = this.modelRuntime.model
    this.permissionMode = configuration.permissionMode
    this.workspaceRoot = realpathSync(workspaceRoot)
    this.store = new AstraflowSessionStore({ root: stateRoot })
    this.sessions = new Map()
  }

  initialize(params) {
    return {
      protocolVersion:
        params.protocolVersion === PROTOCOL_VERSION
          ? params.protocolVersion
          : PROTOCOL_VERSION,
      agentInfo: {
        name: "AstraFlow Agent",
        title: "AstraFlow Agent (Sandbox)",
        version: ASTRAFLOW_ACP_RUNTIME_VERSION,
      },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          embeddedContext: true,
          image: false,
          audio: false,
        },
        mcpCapabilities: { acp: true },
        sessionCapabilities: {
          list: {},
          delete: {},
          resume: {},
          close: {},
        },
        _meta: {
          subagents: true,
          skills: true,
          astraflow: {
            execution: "sandbox",
            features: ASTRAFLOW_ACP_FEATURES,
            runtimeVersion: ASTRAFLOW_ACP_RUNTIME_VERSION,
          },
        },
      },
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

  async newSession(params) {
    const now = new Date().toISOString()
    const record = {
      schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
      sessionId: randomUUID(),
      cwd: this.resolveCwd(params.cwd),
      history: [],
      createdAt: now,
      updatedAt: now,
    }

    await this.store.save(record)
    this.sessions.set(record.sessionId, {
      record,
      mcpServers: params.mcpServers || [],
      abortController: null,
      activeAgent: null,
      deleted: false,
    })

    return { sessionId: record.sessionId, _meta: sessionMeta() }
  }

  async restoreSession(params) {
    const record = await this.store.load(params.sessionId)

    if (!record) {
      throw new Error(`AstraFlow ACP session ${params.sessionId} was not found.`)
    }

    const cwd = this.resolveCwd(params.cwd)

    if (cwd !== record.cwd) {
      throw new Error("AstraFlow ACP session cwd does not match its checkpoint.")
    }

    this.sessions.set(record.sessionId, {
      record,
      mcpServers: params.mcpServers || [],
      abortController: null,
      activeAgent: null,
      deleted: false,
    })

    return { _meta: sessionMeta() }
  }

  loadSession(params) {
    return this.restoreSession(params)
  }

  resumeSession(params) {
    return this.restoreSession(params)
  }

  async listSessions(params) {
    const cwd = params.cwd ? this.resolveCwd(params.cwd) : null
    const records = await this.store.list()

    return {
      sessions: records
        .filter((record) => !cwd || record.cwd === cwd)
        .map((record) => ({
          sessionId: record.sessionId,
          cwd: record.cwd,
          updatedAt: record.updatedAt,
          title: "AstraFlow Agent",
          _meta: sessionMeta(),
        })),
    }
  }

  async deleteSession(params) {
    const session = this.sessions.get(params.sessionId)

    if (session) {
      session.deleted = true
    }

    this.cancel(params)
    this.sessions.delete(params.sessionId)
    await this.store.delete(params.sessionId)
    return {}
  }

  closeSession(params) {
    this.cancel(params)
    this.sessions.delete(params.sessionId)
    return {}
  }

  cancel(params) {
    const session = this.sessions.get(params.sessionId)

    session?.abortController?.abort(new Error("AstraFlow ACP run cancelled."))
    session?.activeAgent?.abort()
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

    session.record = {
      ...session.record,
      history: boundedPiHistory(messages),
      updatedAt: new Date().toISOString(),
    }
    await this.store.save(session.record)
  }

  async prompt(params, client) {
    const session = this.sessions.get(params.sessionId)

    if (!session) {
      throw new Error(`AstraFlow ACP session ${params.sessionId} is not active.`)
    }

    if (session.abortController) {
      throw new Error("AstraFlow ACP session already has an active prompt.")
    }

    const abortController = new AbortController()
    session.abortController = abortController
    const backend = new AcpPermissionBackend({
      client,
      cwd: session.record.cwd,
      permissionMode: this.permissionMode,
      sessionId: params.sessionId,
      signal: abortController.signal,
    })
    let mcp = null
    let piAgent = null
    let contextTransform = null
    let unsubscribe = null
    let abort = null

    try {
      await backend.ensureReady()
      mcp = await createAcpMcpTools({
        client,
        mcpServers: session.mcpServers,
        sessionId: params.sessionId,
        signal: abortController.signal,
      })
      const projectInstructions = await this.projectInstructions(
        session.record.cwd
      )
      const systemPrompt = `${BASE_SYSTEM_PROMPT}${projectInstructions}`
      const subagentSystemPrompt = `${SUBAGENT_PROMPT}${projectInstructions}`
      const builtinTools = backend.createTools()
      const planTool = createPlanTool()
      const requestInputTool = createRequestUserInputTool({
        client,
        sessionId: params.sessionId,
        signal: abortController.signal,
      })
      const getApiKey = () => this.configuration.apiKey
      const subagentTools = () => [
        ...builtinTools,
        createPlanTool(),
        ...mcp.tools,
      ]
      const taskTool = createTaskTool({
        backend,
        client,
        getApiKey,
        getTools: subagentTools,
        model: this.modelRuntime.model,
        onPayload: this.modelRuntime.onPayload,
        sessionId: params.sessionId,
        streamFn: this.modelRuntime.streamFn,
        systemPrompt: subagentSystemPrompt,
        thinkingLevel: this.modelRuntime.thinkingLevel,
      })
      const tools = [
        ...builtinTools,
        planTool,
        taskTool,
        requestInputTool,
        ...mcp.tools,
      ]
      const userMessage = promptToUserMessage(params.prompt)
      const compactedHistory = await compactPiHistory({
        apiKey: this.configuration.apiKey,
        messages: session.record.history,
        model: this.modelRuntime.model,
        onPayload: this.modelRuntime.onPayload,
        pendingMessages: [userMessage],
        signal: abortController.signal,
        streamFn: this.modelRuntime.streamFn,
        systemPrompt,
        thinkingLevel: this.modelRuntime.thinkingLevel,
      })

      if (compactedHistory !== session.record.history) {
        await this.saveAgentHistory(session, compactedHistory)
      }

      const turnLimitHook = createTurnLimitHook(() => piAgent)

      contextTransform = createContextTransform({
        apiKey: this.configuration.apiKey,
        model: this.modelRuntime.model,
        onPayload: this.modelRuntime.onPayload,
        streamFn: this.modelRuntime.streamFn,
        systemPrompt,
        thinkingLevel: this.modelRuntime.thinkingLevel,
      })

      piAgent = new Agent({
        initialState: {
          model: this.modelRuntime.model,
          thinkingLevel: this.modelRuntime.thinkingLevel,
          systemPrompt,
          tools,
          messages: compactedHistory,
        },
        convertToLlm,
        transformContext: contextTransform,
        ...(this.modelRuntime.streamFn
          ? { streamFn: this.modelRuntime.streamFn }
          : {}),
        getApiKey,
        ...(this.modelRuntime.onPayload
          ? { onPayload: this.modelRuntime.onPayload }
          : {}),
        beforeToolCall: (context, signal) =>
          backend.beforeToolCall(context, signal),
        prepareNextTurn: turnLimitHook,
        sessionId: params.sessionId,
      })
      session.activeAgent = piAgent
      unsubscribe = piAgent.subscribe(
        createPiEventForwarder({
          client,
          sessionId: params.sessionId,
        })
      )
      abort = () => piAgent.abort()

      if (abortController.signal.aborted) {
        abort()
      } else {
        abortController.signal.addEventListener("abort", abort, { once: true })
      }

      await piAgent.prompt(userMessage)
      await this.saveAgentHistory(
        session,
        contextTransform.materialize(piAgent.state.messages)
      )

      const lastAssistant = [...piAgent.state.messages]
        .reverse()
        .find((message) => message?.role === "assistant")

      if (turnLimitHook.exhausted) {
        throw new Error(
          `Pi Agent exceeded ${ASTRAFLOW_ACP_RECURSION_LIMIT} turns.`
        )
      }

      if (
        abortController.signal.aborted ||
        lastAssistant?.stopReason === "aborted"
      ) {
        return { stopReason: "cancelled", _meta: sessionMeta() }
      }

      if (lastAssistant?.stopReason === "error" || piAgent.state.errorMessage) {
        throw new Error(
          lastAssistant?.errorMessage ||
            piAgent.state.errorMessage ||
            "Pi Agent provider request failed."
        )
      }

      return {
        stopReason: "end_turn",
        _meta: sessionMeta(),
      }
    } catch (error) {
      if (isAbortError(error, abortController.signal)) {
        if (piAgent) {
          const messages = contextTransform
            ? contextTransform.materialize(piAgent.state.messages)
            : piAgent.state.messages
          await this.saveAgentHistory(session, messages).catch(() => undefined)
        }

        return { stopReason: "cancelled", _meta: sessionMeta() }
      }

      throw error
    } finally {
      if (abort) {
        abortController.signal.removeEventListener("abort", abort)
      }

      unsubscribe?.()
      session.abortController = null
      session.activeAgent = null
      await mcp?.close().catch(() => undefined)
      await backend.close().catch(() => undefined)
    }
  }

  shutdown() {
    for (const session of this.sessions.values()) {
      session.abortController?.abort(new Error("AstraFlow ACP shutting down."))
      session.activeAgent?.abort()
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
    .onRequest(methods.agent.session.new, ({ params }) =>
      runtime.newSession(params)
    )
    .onRequest(methods.agent.session.load, ({ params }) =>
      runtime.loadSession(params)
    )
    .onRequest(methods.agent.session.resume, ({ params }) =>
      runtime.resumeSession(params)
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
    .onRequest(methods.agent.session.prompt, ({ params, client }) =>
      runtime.prompt(params, client)
    )
    .onNotification(methods.agent.session.cancel, ({ params }) =>
      runtime.cancel(params)
    )

  return { app, runtime }
}
