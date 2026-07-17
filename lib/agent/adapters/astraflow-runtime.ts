import { randomUUID } from "node:crypto"
import { join } from "node:path"

import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import {
  type AssistantMessage,
  type ImageContent,
  type Message,
  type TextContent,
  type Usage,
  type UserMessage,
} from "@earendil-works/pi-ai"
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"

import { AcpRuntime } from "@/lib/agent/acp/acp-runtime"
import { createStudioAcpSessionPlugins } from "@/lib/agent/acp/studio-plugins"
import {
  resolveAstraflowAcpConfiguration,
  resolveAstraflowAcpLocalCommand,
} from "@/lib/agent/astraflow-acp-config"
import type { PromptMention } from "@/lib/agent/composer-types"
import type {
  AgentMessage,
  AgentMessageContent,
} from "@/lib/agent/messages"
import { resolveAstraFlowPiPackageResources } from "@/lib/agent/pi-packages"
import {
  registerAgentRuntime,
  type AgentRuntime,
} from "@/lib/agent/runtime"
import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"
import {
  DEFAULT_CHAT_REASONING_EFFORT,
  type ChatReasoningEffort,
} from "@/lib/chat-models"
import {
  createModelversePiRuntime,
  type ModelversePiRuntime,
} from "@/lib/modelverse-pi"
import { getStudioModelverseApiKey } from "@/lib/studio-db"
import { createStudioRemoteAgentConnection } from "@/lib/studio-remote-workspace"

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function stringifyToolPayload(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function messageContentToText(content: AgentMessageContent) {
  if (typeof content === "string") {
    return content
  }

  if (!Array.isArray(content)) {
    return stringifyToolPayload(content)
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part
      }

      const record = getRecord(part)
      return typeof record?.text === "string"
        ? record.text
        : stringifyToolPayload(part)
    })
    .filter(Boolean)
    .join("\n")
}

function getFilePromptMentions(message: AgentMessage) {
  const mentions = message.mentions

  if (!Array.isArray(mentions)) {
    return []
  }

  return mentions.filter(
    (mention): mention is Extract<PromptMention, { kind: "file" | "folder" }> =>
      typeof mention === "object" &&
      mention !== null &&
      (mention.kind === "file" || mention.kind === "folder") &&
      typeof mention.path === "string" &&
      mention.path.length > 0 &&
      typeof mention.name === "string" &&
      mention.name.length > 0
  )
}

function appendTextToMessageContent(
  content: AgentMessageContent,
  text: string
) {
  if (typeof content === "string") {
    return [content, text].filter((part) => part.trim().length > 0).join("\n\n")
  }

  if (Array.isArray(content)) {
    return [...content, { type: "text", text }] as AgentMessageContent
  }

  return [stringifyToolPayload(content), text]
    .filter((part) => part.trim().length > 0)
    .join("\n\n")
}

export function appendAstraFlowMentionPaths(messages: AgentMessage[]) {
  let changed = false
  const nextMessages = messages.map((message) => {
    if (message.role !== "user") {
      return message
    }

    const messageText = messageContentToText(message.content)
    const paths = getFilePromptMentions(message)
      .map((mention) => mention.path)
      .filter((path) => !messageText.includes(path))

    if (!paths.length) {
      return message
    }

    changed = true
    return {
      ...message,
      content: appendTextToMessageContent(
        message.content,
        ["Referenced files:", ...paths].join("\n")
      ),
    }
  })

  return changed ? nextMessages : messages
}

export function sortAstraFlowToolsForPromptCache<T extends { name: string }>(
  tools: T[]
) {
  return [...tools].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )
}

function parseDataUrl(value: string): ImageContent | null {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(value)
  return match
    ? { type: "image", mimeType: match[1], data: match[2] }
    : null
}

function baseContentToPiParts(content: AgentMessageContent) {
  if (typeof content === "string") {
    return [{ type: "text" as const, text: content }]
  }
  if (!Array.isArray(content)) {
    return [{ type: "text" as const, text: stringifyToolPayload(content) }]
  }

  return content.flatMap<TextContent | ImageContent>((part) => {
    if (typeof part === "string") {
      return [{ type: "text", text: part }]
    }
    const record = getRecord(part)
    if (typeof record?.text === "string") {
      return [{ type: "text", text: record.text }]
    }
    const imageUrl =
      typeof record?.image_url === "string"
        ? record.image_url
        : typeof getRecord(record?.image_url)?.url === "string"
          ? (getRecord(record?.image_url)?.url as string)
          : null
    if (imageUrl) {
      return [
        parseDataUrl(imageUrl) ?? {
          type: "text",
          text: `Referenced image URL: ${imageUrl}`,
        },
      ]
    }
    return [{ type: "text", text: stringifyToolPayload(part) }]
  })
}

function zeroUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

export function convertAstraFlowMessagesToPi(
  messages: AgentMessage[],
  model: ModelversePiRuntime["model"]
): Message[] {
  return appendAstraFlowMentionPaths(messages).flatMap<Message>((message) => {
    const timestamp = Date.now()
    if (message.role === "user") {
      return [
        {
          role: "user",
          content: baseContentToPiParts(message.content),
          timestamp,
        } satisfies UserMessage,
      ]
    }
    if (message.role === "assistant") {
      return [
        {
          role: "assistant",
          content: baseContentToPiParts(message.content).flatMap((part) =>
            part.type === "text" ? [part] : []
          ),
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: zeroUsage(),
          stopReason: "stop",
          timestamp,
        } satisfies AssistantMessage,
      ]
    }
    if (message.role === "tool") {
      return [
        {
          role: "toolResult",
          toolCallId: message.toolCallId || `history:${randomUUID()}`,
          toolName: message.name || "tool",
          content: baseContentToPiParts(message.content),
          isError: false,
          timestamp,
        },
      ]
    }
    return []
  })
}

export type AstraFlowPiCompactionResult = {
  summary: string
  firstKeptMessageId: string
  throughMessageId: string
  tokensBefore: number
  estimatedTokensAfter: number | null
}

export async function compactAstraFlowPiMessages({
  customInstructions,
  messages,
  model,
  reasoningEffort = DEFAULT_CHAT_REASONING_EFFORT,
  sessionId,
}: {
  customInstructions?: string
  messages: AgentMessage[]
  model: string
  reasoningEffort?: ChatReasoningEffort
  sessionId: string
}): Promise<AstraFlowPiCompactionResult> {
  const modelverseApiKey = getStudioModelverseApiKey()?.key ?? null

  if (!modelverseApiKey) {
    throw new Error("ModelVerse API key is not configured locally.")
  }

  const throughMessageId = [...messages]
    .reverse()
    .find((message) => message.id)?.id

  if (!throughMessageId) {
    throw new Error("Conversation messages do not have stable ids.")
  }

  const rootDir = ensureLocalSandboxWorkspace(sessionId)
  const piRuntime = createModelversePiRuntime({
    apiKey: modelverseApiKey,
    model,
    requestedReasoningEffort: reasoningEffort,
  })
  const resources = await createPiSessionResources({
    compactionSettings: {
      keepRecentTokens: 4_000,
      reserveTokens: 8_000,
    },
    payloadTransform: piRuntime.payloadTransform,
    rootDir,
    sessionId,
    systemPrompt:
      "You compact prior AstraFlow conversation context into a precise continuation summary.",
  })
  const sessionManager = SessionManager.inMemory(rootDir)
  const messageIdsByEntryId = new Map<string, string>()

  for (const message of messages) {
    for (const piMessage of convertAstraFlowMessagesToPi(
      [message],
      piRuntime.model
    )) {
      const entryId = sessionManager.appendMessage(piMessage)

      if (message.id) {
        messageIdsByEntryId.set(entryId, message.id)
      }
    }
  }

  if (sessionManager.getEntries().length < 3) {
    throw new Error("Nothing to compact (session too small).")
  }

  const created = await createAgentSession({
    cwd: rootDir,
    authStorage: piRuntime.authStorage,
    modelRegistry: piRuntime.modelRegistry,
    model: piRuntime.model,
    thinkingLevel: piRuntime.thinkingLevel as ThinkingLevel,
    sessionManager,
    settingsManager: resources.settingsManager,
    resourceLoader: resources.resourceLoader,
    noTools: "all",
    tools: [],
  })

  try {
    const defaultInstructions =
      "Preserve user requirements, decisions, file paths, code changes, tool results, unresolved issues, and concrete next steps. Do not invent facts."
    const instructions = [defaultInstructions, customInstructions?.trim()]
      .filter(Boolean)
      .join("\n\n")
    const result = await created.session.compact(instructions)
    const firstKeptMessageId = messageIdsByEntryId.get(
      result.firstKeptEntryId
    )

    if (!result.summary.trim()) {
      throw new Error("Pi compaction returned an empty summary.")
    }

    if (!firstKeptMessageId) {
      throw new Error("Pi compaction returned an unknown history boundary.")
    }

    return {
      summary: result.summary.trim(),
      firstKeptMessageId,
      throughMessageId,
      tokensBefore: result.tokensBefore,
      estimatedTokensAfter: result.estimatedTokensAfter ?? null,
    }
  } finally {
    created.session.dispose()
  }
}

async function createPiSessionResources({
  compactionSettings,
  payloadTransform,
  rootDir,
  sessionId,
  systemPrompt,
}: {
  compactionSettings?: {
    keepRecentTokens: number
    reserveTokens: number
  }
  payloadTransform?: ModelversePiRuntime["payloadTransform"]
  rootDir: string
  sessionId: string
  systemPrompt: string
}) {
  const packageResources = resolveAstraFlowPiPackageResources()
  const settingsManager = SettingsManager.inMemory(
    {
      compaction: {
        enabled: true,
        ...(compactionSettings ?? {}),
      },
      retry: { enabled: false },
    },
    { projectTrusted: true }
  )
  const resourceLoader = new DefaultResourceLoader({
    cwd: rootDir,
    agentDir: join(ensureLocalSandboxWorkspace(sessionId), "pi"),
    settingsManager,
    additionalSkillPaths: packageResources.skillPaths,
    additionalPromptTemplatePaths: packageResources.promptTemplatePaths,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt,
    extensionFactories: payloadTransform
      ? [
          {
            name: "astraflow-modelverse-payload",
            factory(pi) {
              pi.on("before_provider_request", ({ payload }) =>
                payloadTransform(payload)
              )
            },
          },
        ]
      : [],
  })
  await resourceLoader.reload()
  return { resourceLoader, settingsManager }
}

const ASTRAFLOW_RUNTIME_INFO = {
  id: "astraflow",
  label: "AstraFlow Agent",
  description: "AstraFlow 智能体：Pi Agent 驱动的规划、子智能体与安全执行",
  capabilities: {
    hitl: true,
    resume: true,
    subagents: true,
    plan: true,
    sandbox: false,
    mcp: true,
    skills: true,
    compact: true,
  },
  composer: {
    slashCommands: "static",
    fileMentions: "text",
    sessionMentions: true,
  },
} satisfies AgentRuntime["info"]

function getAstraflowRuntimeInfo() {
  return {
    ...ASTRAFLOW_RUNTIME_INFO,
    capabilities: {
      ...ASTRAFLOW_RUNTIME_INFO.capabilities,
      sandbox: Boolean(getStudioModelverseApiKey()?.key),
    },
  }
}

const astraflowAcpRuntime = new AcpRuntime({
  info: {
    ...ASTRAFLOW_RUNTIME_INFO,
    description:
      "AstraFlow 智能体：本地与远程沙箱均由 Pi Agent 驱动",
    capabilities: { ...ASTRAFLOW_RUNTIME_INFO.capabilities, sandbox: true },
  },
  async resolveCommand(input) {
    if (input.environment !== "remote") {
      return resolveAstraflowAcpLocalCommand(input)
    }

    const configuration = resolveAstraflowAcpConfiguration(input)
    const connection = await createStudioRemoteAgentConnection({
      sessionId: input.sessionId,
      runtimeId: "astraflow",
      env: configuration.env,
    })
    return { transport: "websocket" as const, url: connection.websocketUrl }
  },
  resolveSessionKey(input) {
    return resolveAstraflowAcpConfiguration(input).sessionKey
  },
  resolveSessionMeta(input) {
    return resolveAstraflowAcpConfiguration(input).sessionMeta
  },
  resolveSessionPlugins(input) {
    return createStudioAcpSessionPlugins({
      environment: input.environment === "remote" ? "remote" : "local",
      runtimeId: "astraflow",
      sessionId: input.sessionId,
    })
  },
})

export const astraflowAgentRuntime: AgentRuntime = {
  info: ASTRAFLOW_RUNTIME_INFO,
  getInfo() {
    const info = astraflowAcpRuntime.getInfo()

    return {
      ...info,
      capabilities: {
        ...info.capabilities,
        sandbox: getAstraflowRuntimeInfo().capabilities.sandbox,
      },
    }
  },
  startRun(input) {
    return astraflowAcpRuntime.startRun(input)
  },
}

registerAgentRuntime(astraflowAgentRuntime)
