import {
  PROTOCOL_VERSION,
  agent as createAgentApp,
  methods,
} from "@agentclientprotocol/sdk"
import {
  HumanMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
} from "@langchain/core/messages"
import { tool } from "@langchain/core/tools"
import { createDeepAgent, registerHarnessProfile } from "deepagents"
import { randomUUID } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import path from "node:path"
import { z } from "zod"

import { AcpPermissionBackend } from "./backend.mjs"
import {
  ASTRAFLOW_ACP_FEATURES,
  ASTRAFLOW_ACP_MAX_HISTORY_MESSAGES,
  ASTRAFLOW_ACP_RECURSION_LIMIT,
  ASTRAFLOW_ACP_RUNTIME_VERSION,
  asErrorMessage,
  getRecord,
  stringify,
} from "./constants.mjs"
import { createAcpMcpTools } from "./mcp-tools.mjs"
import {
  createAstraflowChatModel,
  readAstraflowRuntimeConfiguration,
} from "./model.mjs"
import { AstraflowSessionStore } from "./session-store.mjs"
import { pumpDeepAgentRun } from "./stream.mjs"

const BASE_SYSTEM_PROMPT = `You are AstraFlow Agent running inside the user's selected persistent Sandbox workspace.

The model, DeepAgents/LangGraph orchestration, planning, subagents, filesystem tools, and terminal execution all run in this Sandbox. AstraFlow Desktop only owns the UI, session record, permission prompts, API-key vault, and bridged local MCP servers.

Work from the selected workspace, read relevant files before editing, keep multi-step plans current, delegate only genuinely independent work, and verify results with focused commands. Do not claim a result that was not observed. Never print, search for, or expose runtime credentials. Use request_user_input only when the answer materially changes the result.`

const SUBAGENT_PROMPT = `You are an AstraFlow Agent subagent running inside the same Sandbox workspace. Complete only the delegated objective, use concrete workspace evidence, and return a concise report to the parent Agent. You cannot ask the user questions.`

let profileRegistered = false

function registerAstraflowProfile() {
  if (profileRegistered) {
    return
  }

  const profile = {
    baseSystemPrompt: BASE_SYSTEM_PROMPT,
    toolDescriptionOverrides: {
      execute:
        "Run a shell command inside the selected Sandbox workspace after AstraFlow permission policy allows it.",
      task:
        "Delegate a broad independent subtask to a temporary DeepAgents subagent inside this Sandbox.",
      write_todos:
        "Create or update a short plan only for genuinely multi-step work.",
    },
    generalPurposeSubagent: {
      description:
        "AstraFlow Sandbox subagent for independent codebase exploration, research, and verification.",
      systemPrompt: SUBAGENT_PROMPT,
    },
  }

  for (const provider of ["openai", "anthropic", "google"]) {
    registerHarnessProfile(provider, profile)
  }

  profileRegistered = true
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

  if (block?.type === "image") {
    return `[Image input: ${block.uri || block.mimeType || "image"}]`
  }

  if (block?.type === "audio") {
    return `[Audio input: ${block.mimeType || "audio"}]`
  }

  return stringify(block)
}

function promptToHumanMessage(prompt) {
  return new HumanMessage(
    prompt.map(contentBlockToText).filter(Boolean).join("\n\n")
  )
}

function isAbortError(error, signal) {
  return (
    signal.aborted ||
    getRecord(error)?.name === "AbortError" ||
    /abort|cancel/i.test(asErrorMessage(error))
  )
}

export function createRequestUserInputTool({ client, sessionId, signal }) {
  return tool(
    async ({ questions }) => {
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
        { signal }
      )

      if (response?.action !== "accept") {
        return "The user cancelled or declined the input request."
      }

      return stringify(response.content || {})
    },
    {
      name: "request_user_input",
      description:
        "Ask one to three concise structured questions when a user choice materially changes the result.",
      schema: z.object({
        questions: z
          .array(
            z.object({
              id: z.string().optional(),
              header: z.string().max(24).optional(),
              question: z.string().min(1),
              options: z
                .array(
                  z.object({
                    label: z.string().min(1),
                    value: z.string().optional(),
                    description: z.string().optional(),
                  })
                )
                .max(3)
                .optional(),
            })
          )
          .min(1)
          .max(3),
      }),
    }
  )
}

function sessionMeta() {
  return {
    astraflow: {
      runtimeVersion: ASTRAFLOW_ACP_RUNTIME_VERSION,
      engine: "deepagents",
      execution: "sandbox",
      checkpoint: "persistent",
    },
  }
}

export class AstraflowAcpAgent {
  constructor({
    configuration = readAstraflowRuntimeConfiguration(),
    modelFactory = createAstraflowChatModel,
    stateRoot = defaultStateRoot(),
    workspaceRoot = process.cwd(),
  } = {}) {
    registerAstraflowProfile()
    this.configuration = configuration
    this.model = modelFactory(configuration)
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

    if (relation === ".." || relation.startsWith(`..${path.sep}`)) {
      throw new Error(
        `ACP session cwd must stay inside ${this.workspaceRoot}.`
      )
    }

    return cwd
  }

  async newSession(params) {
    const now = new Date().toISOString()
    const record = {
      schemaVersion: 1,
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
    this.sessions.get(params.sessionId)?.abortController?.abort(
      new Error("AstraFlow ACP run cancelled.")
    )
  }

  projectMemoryFiles(cwd) {
    const memoryFile = path.join(cwd, "AGENTS.md")

    return existsSync(memoryFile) ? [memoryFile] : []
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

    try {
      await backend.ensureReady()
      mcp = await createAcpMcpTools({
        client,
        mcpServers: session.mcpServers,
        sessionId: params.sessionId,
        signal: abortController.signal,
      })
      const history = mapStoredMessagesToChatMessages(session.record.history)
      const messages = [...history, promptToHumanMessage(params.prompt)]
      const tools = [
        createRequestUserInputTool({
          client,
          sessionId: params.sessionId,
          signal: abortController.signal,
        }),
        ...mcp.tools,
      ]
      const agent = createDeepAgent({
        model: this.model,
        backend,
        tools,
        memory: this.projectMemoryFiles(session.record.cwd),
        systemPrompt: BASE_SYSTEM_PROMPT,
      })
      const run = await agent.streamEvents(
        { messages },
        {
          version: "v3",
          signal: abortController.signal,
          recursionLimit: ASTRAFLOW_ACP_RECURSION_LIMIT,
        }
      )
      const output = await pumpDeepAgentRun({
        client,
        run,
        sessionId: params.sessionId,
        signal: abortController.signal,
      })
      const outputMessages = Array.isArray(output?.messages)
        ? output.messages
        : messages
      const updatedAt = new Date().toISOString()

      session.record = {
        ...session.record,
        history: mapChatMessagesToStoredMessages(outputMessages).slice(
          -ASTRAFLOW_ACP_MAX_HISTORY_MESSAGES
        ),
        updatedAt,
      }
      await this.store.save(session.record)

      return {
        stopReason: "end_turn",
        _meta: sessionMeta(),
      }
    } catch (error) {
      if (isAbortError(error, abortController.signal)) {
        return { stopReason: "cancelled", _meta: sessionMeta() }
      }

      throw error
    } finally {
      session.abortController = null
      await mcp?.close().catch(() => undefined)
      await backend.close().catch(() => undefined)
    }
  }

  shutdown() {
    for (const session of this.sessions.values()) {
      session.abortController?.abort(new Error("AstraFlow ACP shutting down."))
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
