import { randomUUID } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import {
  Type,
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
  type AgentSession,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent"

import { AcpRuntime } from "@/lib/agent/acp/acp-runtime"
import { createStudioAcpSessionPlugins } from "@/lib/agent/acp/studio-plugins"
import { resolveAstraflowAcpConfiguration } from "@/lib/agent/astraflow-acp-config"
import type { PromptMention } from "@/lib/agent/composer-types"
import { AgentEventQueue } from "@/lib/agent/event-queue"
import type { AgentEvent } from "@/lib/agent/events"
import { createExpertRuntimeSystemPrompt } from "@/lib/agent/expert-runtime"
import type {
  AgentMessage,
  AgentMessageContent,
} from "@/lib/agent/messages"
import {
  getAstraFlowPiSubagentProfiles,
  getAstraFlowPiSubagentInstructions,
  resolveAstraFlowPiPackageResources,
} from "@/lib/agent/pi-packages"
import { normalizeAgentToolName } from "@/lib/agent/tool-names"
import {
  adaptAstraFlowToolsToPi,
  type AnyPiToolDefinition,
  createPiLocalTools,
  createPiPlanTool,
} from "@/lib/agent/pi-tools"
import {
  type PermissionGatewayContext,
  wrapToolsWithPermissionGateway,
} from "@/lib/agent/permission-gateway"
import {
  registerAgentRuntime,
  type AgentRunInput,
  type AgentRuntime,
} from "@/lib/agent/runtime"
import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"
import { cancelSessionUserInputs } from "@/lib/agent/user-input-broker"
import { createLocalDownloadFileTool } from "@/lib/ai/tools/local-download"
import type { AstraFlowTool } from "@/lib/ai/tools/tool"
import {
  createGetStudioMediaGenerationTool,
  createGetStudioMediaModelSchemaTool,
  createListStudioImageModelsTool,
  createListStudioMediaGenerationModelsTool,
  createListStudioMediaGenerationsTool,
  createListStudioVideoModelsTool,
  createStudioGenerateImageTool,
  createStudioGenerateVideoTool,
} from "@/lib/ai/tools/media-generation"
import {
  createListInstalledMcpServersTool,
  createStudioMcpToolClient,
} from "@/lib/ai/tools/mcp"
import { createSendFileToMobileTool } from "@/lib/ai/tools/mobile-channel"
import { createRequestUserInputTool } from "@/lib/ai/tools/user-input"
import {
  createExaWebSearchTool,
  createWebFetchTool,
  getStoredExaApiKey,
} from "@/lib/ai/tools/web"
import { createStudioSkillsRuntime } from "@/lib/ai/skills/studio-skills"
import {
  createSessionSandboxUploadPath,
  uploadSessionFileToSandbox,
} from "@/lib/astraflow-session-sandbox"
import {
  DEFAULT_CHAT_REASONING_EFFORT,
  type ChatReasoningEffort,
} from "@/lib/chat-models"
import { isMcpToolName } from "@/lib/mcp"
import { getMobileChannelBindingBySessionId } from "@/lib/mobile-channels/store"
import {
  createModelversePiRuntime,
  type ModelversePiRuntime,
} from "@/lib/modelverse-pi"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import {
  resolveStudioStoragePath,
  safeFileName,
} from "@/lib/studio-file-storage"
import {
  getStudioModelverseApiKey,
  getStudioSession,
  getStudioSessionExpert,
  listStudioSessionFiles,
} from "@/lib/studio-db"
import { createStudioRemoteAgentConnection } from "@/lib/studio-remote-workspace"
import type { StudioSessionFile } from "@/lib/studio-types"

const STUDIO_CHAT_DEBUG = process.env.ASTRAFLOW_STUDIO_CHAT_DEBUG === "1"
const PROJECT_CONTEXT_MAX_CHARS = 16_000
const PROJECT_MEMORY_FILE_MAX_CHARS = 10_000
const PROJECT_README_MAX_CHARS = 2_500
const MAX_FILE_CHANGE_DIFF_CHARS = 200_000
const PI_RESERVED_TOOL_NAMES = new Set([
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "subagent",
  "task",
  "write_todos",
])
const PI_UI_ONLY_TOOL_NAMES = new Set(["subagent", "task", "write_todos"])

type PreparedSessionFile = StudioSessionFile & {
  agentPath: string
  agentEnvironment: "local" | "remote"
}

type PiToolCallState = {
  args: unknown
  existed: boolean
  name: string
}

type PiUsageAccumulator = Omit<Usage, "cost"> & {
  cost: Usage["cost"]
}

type PiEventState = {
  calls: Map<string, PiToolCallState>
  lastAssistantError: string | null
  rootDir: string
  usage: PiUsageAccumulator
}

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

function debugPi(label: string, payload: Record<string, unknown>) {
  if (STUDIO_CHAT_DEBUG) {
    console.info(`[studio-chat:pi] ${label}`, payload)
  }
}

function isAbortLikeError(error: unknown, signal?: AbortSignal) {
  const record = getRecord(error)
  const name = typeof record?.name === "string" ? record.name : ""
  const message = error instanceof Error ? error.message : String(error)

  return (
    Boolean(signal?.aborted) ||
    name === "AbortError" ||
    message.toLowerCase().includes("aborted") ||
    message.toLowerCase().includes("cancelled")
  )
}

function isDirectory(path: string) {
  try {
    return statSync(/* turbopackIgnore: true */ path).isDirectory()
  } catch {
    return false
  }
}

function findGitRoot(startDir: string) {
  let current = resolve(/* turbopackIgnore: true */ startDir)

  while (true) {
    if (
      existsSync(
        join(/* turbopackIgnore: true */ current, ".git")
      )
    ) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

function discoverProjectMemorySources(projectPath: string | null) {
  if (!projectPath || !isDirectory(projectPath)) {
    return []
  }

  const root = resolve(/* turbopackIgnore: true */ projectPath)
  const boundary = findGitRoot(root) ?? root
  const sources: string[] = []
  let current = root

  while (true) {
    const memoryPath = join(
      /* turbopackIgnore: true */ current,
      "AGENTS.md"
    )
    if (existsSync(memoryPath)) {
      sources.unshift(memoryPath)
    }
    if (current === boundary) {
      break
    }
    const parent = dirname(current)
    if (parent === current || relative(boundary, parent).startsWith("..")) {
      break
    }
    current = parent
  }

  return sources
}

function readTextExcerpt(path: string, maxChars: number) {
  try {
    const content = readFileSync(/* turbopackIgnore: true */ path, "utf8")
    return content.length <= maxChars
      ? content
      : `${content.slice(0, maxChars)}\n...[truncated ${
          content.length - maxChars
        } chars]`
  } catch {
    return null
  }
}

function createProjectGuidance(projectPath: string | null) {
  if (!projectPath) {
    return ""
  }

  const sections = [
    "<project_context>",
    `Project root: ${projectPath}`,
    "Inspect relevant files just-in-time before changing code.",
  ]
  const packageJson = readTextExcerpt(
    join(/* turbopackIgnore: true */ projectPath, "package.json"),
    80_000
  )

  if (packageJson) {
    try {
      const scripts = (JSON.parse(packageJson) as {
        scripts?: Record<string, unknown>
      }).scripts
      const names = ["lint", "typecheck", "test", "format", "dev", "build"]
      const selected = names.flatMap((name) =>
        typeof scripts?.[name] === "string"
          ? [`- ${name}: ${scripts[name]}`]
          : []
      )
      if (selected.length) {
        sections.push(`Common package scripts:\n${selected.join("\n")}`)
      }
    } catch {
      // Invalid package metadata should not block an agent run.
    }
  }

  const memorySources = discoverProjectMemorySources(projectPath)
  if (memorySources.length) {
    sections.push(
      [
        "Project AGENTS.md instructions:",
        ...memorySources.map(
          (source) =>
            `--- ${source} ---\n${
              readTextExcerpt(source, PROJECT_MEMORY_FILE_MAX_CHARS) ?? ""
            }`
        ),
      ].join("\n\n")
    )
  }

  const readmePath = ["README.md", "README.mdx", "readme.md"]
    .map((name) => join(/* turbopackIgnore: true */ projectPath, name))
    .find((path) => existsSync(/* turbopackIgnore: true */ path))
  const readme = readmePath
    ? readTextExcerpt(readmePath, PROJECT_README_MAX_CHARS)
    : null
  if (readme) {
    sections.push(`README excerpt (${readmePath}):\n${readme}`)
  }
  sections.push("</project_context>")

  const guidance = sections.join("\n\n")
  return guidance.length <= PROJECT_CONTEXT_MAX_CHARS
    ? guidance
    : `${guidance.slice(0, PROJECT_CONTEXT_MAX_CHARS)}\n...[project context truncated]`
}

function createPiSystemPrompt({
  expertContext,
  hasDownloadFile,
  hasMcpTools,
  hasMediaGeneration,
  hasUserInputRequest,
  hasWebFetch,
  hasWebSearch,
  localRootDir,
  model,
  projectGuidance,
  sessionFilesManifest,
  skillsPrompt,
}: {
  expertContext: string
  hasDownloadFile: boolean
  hasMcpTools: boolean
  hasMediaGeneration: boolean
  hasUserInputRequest: boolean
  hasWebFetch: boolean
  hasWebSearch: boolean
  localRootDir: string
  model: string
  projectGuidance: string
  sessionFilesManifest: string
  skillsPrompt: string
}) {
  const toolGuidance = [
    hasWebFetch ? "- Use web_fetch for user-provided URLs." : "",
    hasWebSearch
      ? "- Use web_search for current or source-backed facts and cite URLs."
      : "",
    hasMcpTools
      ? "- MCP tools are external capabilities. Use list_installed_mcp_servers when the user asks which MCP servers are available."
      : "",
    hasMediaGeneration
      ? "- Use the media tools for image or video requests when relevant."
      : "",
    hasDownloadFile
      ? "- After creating a standalone artifact for the user, call download_file with its exact path. Do not call it for ordinary repository edits."
      : "",
    hasUserInputRequest
      ? "- Use request_user_input only when a user choice materially changes the result."
      : "",
  ].filter(Boolean)

  return [
    DEFAULT_SYSTEM_PROMPT,
    [
      "## Environment",
      `- Selected model: ${model}. Identify as AstraFlow Agent running on this model.`,
      `- Local mode working directory: ${localRootDir}. Filesystem access and shell execution are constrained by AstraFlow's path policy, permission gateway, and OS sandbox.`,
      "- Network access from shell commands is denied by default and requires explicit host approval.",
      "- Prefer the bundled Python and Node runtimes. Do not run npm installers; use the managed Python environment only when needed and approved.",
      "- Avoid broad recursive searches from the home directory; narrow the path first.",
    ].join("\n"),
    toolGuidance.length ? `## Tool Guidance\n\n${toolGuidance.join("\n")}` : "",
    projectGuidance,
    sessionFilesManifest,
    skillsPrompt,
    expertContext,
  ]
    .filter(Boolean)
    .join("\n\n")
}

function createSessionFilesManifest(files: PreparedSessionFile[]) {
  if (!files.length) {
    return ""
  }

  return [
    "Session files available to AstraFlow Agent:",
    ...files.map((file) =>
      [
        `- ${file.originalName}`,
        `file_id: ${file.id}`,
        `path: ${file.agentPath}`,
        `environment: ${file.agentEnvironment}`,
        file.kind ? `kind: ${file.kind}` : null,
        file.mimeType ? `mime: ${file.mimeType}` : null,
        typeof file.size === "number" ? `bytes: ${file.size}` : null,
      ]
        .filter(Boolean)
        .join(" | ")
    ),
    "Use these absolute paths directly and keep original uploads intact.",
  ].join("\n")
}

async function prepareSessionFiles({
  environment,
  modelverseApiKey,
  sessionId,
  workspaceId,
  workspaceRoot,
}: {
  environment: "local" | "remote"
  modelverseApiKey: string | null
  sessionId: string
  workspaceId?: string | null
  workspaceRoot?: string | null
}) {
  const files = listStudioSessionFiles(sessionId)
  if (!files.length) {
    return []
  }

  if (environment === "remote") {
    if (!modelverseApiKey || !workspaceId?.trim() || !workspaceRoot?.trim()) {
      return []
    }

    const prepared: PreparedSessionFile[] = []
    for (const file of files) {
      const result = await uploadSessionFileToSandbox({
        sessionId,
        apiKey: modelverseApiKey,
        fileId: file.id,
        workspaceId: workspaceId.trim(),
        workspaceRoot: workspaceRoot.trim(),
      })
      prepared.push({
        ...result.file,
        agentPath:
          result.file.sandboxPath ??
          createSessionSandboxUploadPath(file, workspaceRoot.trim()),
        agentEnvironment: environment,
      })
    }
    return prepared
  }

  const filesRoot = join(ensureLocalSandboxWorkspace(sessionId), "files")
  mkdirSync(/* turbopackIgnore: true */ filesRoot, { recursive: true })

  return files.map((file) => {
    const sourcePath = resolveStudioStoragePath(file.storagePath)
    const agentPath = join(
      filesRoot,
      `${safeFileName(file.id)}-${safeFileName(file.originalName)}`
    )
    if (!existsSync(/* turbopackIgnore: true */ agentPath)) {
      copyFileSync(/* turbopackIgnore: true */ sourcePath, agentPath)
    }
    return { ...file, agentPath, agentEnvironment: environment }
  })
}

function createNativeTools({
  modelverseApiKey,
  rootDir,
  sessionId,
}: {
  modelverseApiKey: string | null
  rootDir: string
  sessionId: string
}) {
  const tools: AstraFlowTool[] = [
    createWebFetchTool(),
    createListInstalledMcpServersTool(),
    createListStudioImageModelsTool(),
    createListStudioVideoModelsTool(),
    createListStudioMediaGenerationModelsTool(),
    createGetStudioMediaModelSchemaTool(),
    createListStudioMediaGenerationsTool({
      sessionId,
      apiKey: modelverseApiKey,
    }),
    createGetStudioMediaGenerationTool({
      sessionId,
      apiKey: modelverseApiKey,
    }),
    createLocalDownloadFileTool({ rootDir, sessionId }),
  ]
  const exaApiKey = getStoredExaApiKey()
  if (exaApiKey) {
    tools.push(createExaWebSearchTool(exaApiKey))
  }
  if (getMobileChannelBindingBySessionId(sessionId)) {
    tools.push(createSendFileToMobileTool({ rootDir, sessionId }))
  }
  if (modelverseApiKey) {
    tools.push(
      createStudioGenerateImageTool({ sessionId, apiKey: modelverseApiKey }),
      createStudioGenerateVideoTool({ sessionId, apiKey: modelverseApiKey })
    )
  }
  return tools
}

function filterPiToolCollisions(tools: AstraFlowTool[]) {
  return tools.filter((tool) => {
    if (!PI_RESERVED_TOOL_NAMES.has(tool.name)) {
      return true
    }
    console.warn("[studio-chat:pi] tool_name_collision_skipped", {
      toolName: tool.name,
    })
    return false
  })
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

function piResultToText(result: unknown) {
  const record = getRecord(result)
  const content = Array.isArray(record?.content) ? record.content : []
  const text = content
    .map((part) => {
      const item = getRecord(part)
      if (typeof item?.text === "string") {
        return item.text
      }
      if (item?.type === "image") {
        return `[image: ${String(item.mimeType ?? "unknown")}]`
      }
      return stringifyToolPayload(part)
    })
    .filter(Boolean)
    .join("\n")
  return text || stringifyToolPayload(result)
}

export function mapPiAgentSessionEvent(
  event: AgentSessionEvent,
  options: { parentTaskId?: string } = {}
): AgentEvent[] {
  const parentTaskId = options.parentTaskId

  if (event.type === "message_update") {
    const update = event.assistantMessageEvent
    if (update.type === "text_delta" && update.delta) {
      return parentTaskId
        ? [
            {
              type: "subagent_update",
              taskId: parentTaskId,
              contentDelta: update.delta,
            },
          ]
        : [{ type: "text_delta", delta: update.delta }]
    }
    if (update.type === "thinking_delta" && update.delta && !parentTaskId) {
      return [{ type: "reasoning_delta", delta: update.delta }]
    }
    return []
  }

  if (event.type === "tool_execution_start") {
    if (PI_UI_ONLY_TOOL_NAMES.has(event.toolName)) {
      return []
    }
    const toolName = normalizeAgentToolName(event.toolName)
    return [
      {
        type: "tool_call",
        id: event.toolCallId,
        name: toolName,
        input: stringifyToolPayload(event.args),
        ...(parentTaskId ? { parentTaskId } : {}),
      },
    ]
  }

  if (event.type === "tool_execution_update") {
    if (PI_UI_ONLY_TOOL_NAMES.has(event.toolName)) {
      return []
    }
    const toolName = normalizeAgentToolName(event.toolName)
    return [
      {
        type: "tool_output",
        id: event.toolCallId,
        name: toolName,
        output: piResultToText(event.partialResult),
        ...(parentTaskId ? { parentTaskId } : {}),
      },
    ]
  }

  if (event.type === "tool_execution_end") {
    if (PI_UI_ONLY_TOOL_NAMES.has(event.toolName)) {
      return []
    }
    const toolName = normalizeAgentToolName(event.toolName)
    const output = piResultToText(event.result)
    return [
      {
        type: "tool_result",
        id: event.toolCallId,
        name: toolName,
        status: event.isError ? "error" : "complete",
        ...(event.isError ? { error: output } : { output }),
        ...(parentTaskId ? { parentTaskId } : {}),
      },
    ]
  }

  return []
}

function createPiEventState(rootDir: string): PiEventState {
  return {
    calls: new Map(),
    lastAssistantError: null,
    rootDir,
    usage: zeroUsage(),
  }
}

function addPiUsage(target: PiUsageAccumulator, usage: Usage) {
  target.input += usage.input
  target.output += usage.output
  target.cacheRead += usage.cacheRead
  target.cacheWrite += usage.cacheWrite
  target.reasoning = (target.reasoning ?? 0) + (usage.reasoning ?? 0)
  target.totalTokens += usage.totalTokens
  target.cost.input += usage.cost.input
  target.cost.output += usage.cost.output
  target.cost.cacheRead += usage.cost.cacheRead
  target.cost.cacheWrite += usage.cost.cacheWrite
  target.cost.total += usage.cost.total
}

function getCallPath(args: unknown) {
  const record = getRecord(args)
  const path = record?.path ?? record?.file_path ?? record?.filePath
  return typeof path === "string" ? path : ""
}

export function mapPiFileToolResult({
  args,
  existed,
  isError,
  name,
  parentTaskId,
  result,
  rootDir,
}: {
  args: unknown
  existed: boolean
  isError: boolean
  name: string
  parentTaskId?: string
  result: unknown
  rootDir: string
}): Extract<AgentEvent, { type: "file_change" }> | null {
  if (name !== "edit" && name !== "write") {
    return null
  }

  const path = getCallPath(args)
  if (!path) {
    return null
  }

  const details = getRecord(getRecord(result)?.details)
  const rawDiff =
    typeof details?.patch === "string"
      ? details.patch
      : typeof details?.diff === "string"
        ? details.diff
        : null
  const diff =
    rawDiff && rawDiff.length > MAX_FILE_CHANGE_DIFF_CHARS
      ? `${rawDiff.slice(0, MAX_FILE_CHANGE_DIFF_CHARS)}\n...[diff truncated]`
      : rawDiff
  const detailKind = details?.kind
  const kind =
    name === "edit"
      ? "edit"
      : detailKind === "create" || detailKind === "edit"
        ? detailKind
        : existed
          ? "edit"
          : "create"

  return {
    type: "file_change",
    path: isAbsolute(path) ? path : resolve(rootDir, path),
    kind,
    status: isError ? "error" : "complete",
    ...(isError ? { error: piResultToText(result) } : {}),
    diff,
    ...(parentTaskId ? { parentTaskId } : {}),
  }
}

function emitPiSessionEvent({
  emit,
  event,
  parentTaskId,
  state,
}: {
  emit: (event: AgentEvent) => void
  event: AgentSessionEvent
  parentTaskId?: string
  state: PiEventState
}) {
  if (event.type === "tool_execution_start") {
    const path = getCallPath(event.args)
    state.calls.set(event.toolCallId, {
      args: event.args,
      existed: path ? existsSync(resolve(state.rootDir, path)) : false,
      name: event.toolName,
    })
  }

  for (const mapped of mapPiAgentSessionEvent(event, { parentTaskId })) {
    emit(mapped)
  }

  if (event.type === "message_end" && event.message.role === "assistant") {
    addPiUsage(state.usage, event.message.usage)
    if (
      event.message.stopReason === "error" ||
      event.message.stopReason === "aborted"
    ) {
      state.lastAssistantError =
        event.message.errorMessage ?? `Pi stopped: ${event.message.stopReason}`
    }
  }

  if (event.type !== "tool_execution_end") {
    return
  }

  const call = state.calls.get(event.toolCallId)
  state.calls.delete(event.toolCallId)
  if (!call) {
    return
  }

  const fileChange = mapPiFileToolResult({
    args: call.args,
    existed: call.existed,
    isError: event.isError,
    name: call.name,
    parentTaskId,
    result: event.result,
    rootDir: state.rootDir,
  })

  if (fileChange) {
    emit(fileChange)
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

function assistantText(message: AssistantMessage | undefined) {
  return (
    message?.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("")
      .trim() ?? ""
  )
}

export function splitPiUserPromptContent(
  content: UserMessage["content"]
): {
  images: ImageContent[]
  text: string
} {
  if (typeof content === "string") {
    return { images: [], text: content }
  }

  const images: ImageContent[] = []
  const text: string[] = []

  for (const part of content) {
    if (typeof part === "string") {
      text.push(part)
    } else if (part.type === "text") {
      text.push(part.text)
    } else {
      images.push(part)
    }
  }

  return { images, text: text.join("\n") }
}

type PiSubagentTask = {
  agent?: string
  as?: string
  label?: string
  output?: boolean | string
  outputMode?: "file-only" | "inline"
  phase?: string
  task: string
}

type PiSubagentChainStep = Omit<PiSubagentTask, "task"> & {
  concurrency?: number
  failFast?: boolean
  parallel?: PiSubagentTask[]
  task?: string
}

type PiSubagentRequest = {
  action?: "list"
  agent?: string
  async?: boolean
  chain?: PiSubagentChainStep[]
  concurrency?: number
  context?: "fresh" | "fork"
  description?: string
  subagent_type?: string
  task?: string
  tasks?: PiSubagentTask[]
}

function expandPiSubagentTaskTemplate({
  originalTask,
  outputs,
  previous,
  template,
}: {
  originalTask: string
  outputs: ReadonlyMap<string, string>
  previous: string
  template: string
}) {
  let expanded = template
    .replaceAll("{task}", originalTask)
    .replaceAll("{previous}", previous)
    .replaceAll("{chain_dir}", "AstraFlow-managed temporary workspace")

  for (const [name, value] of outputs) {
    expanded = expanded.replaceAll(`{outputs.${name}}`, value)
  }

  return expanded
}

function createPiSubagentTool({
  baseTools,
  emit,
  piRuntime,
  rootDir,
  sessionId,
  signal: runSignal,
  systemPrompt,
  usage,
}: {
  baseTools: AnyPiToolDefinition[]
  emit: (event: AgentEvent) => void
  piRuntime: ModelversePiRuntime
  rootDir: string
  sessionId: string
  signal: AbortSignal
  systemPrompt: string
  usage: PiUsageAccumulator
}): AnyPiToolDefinition {
  const runChild = async ({
    activeSignal,
    name,
    parentTaskId,
    task,
  }: {
    activeSignal: AbortSignal
    name: string
    parentTaskId: string
    task: string
  }) => {
    emit({
      type: "subagent_start",
      taskId: parentTaskId,
      name,
      taskInput: task,
    })

    let childSession: AgentSession | null = null
    const childState = createPiEventState(rootDir)
    const onAbort = () => void childSession?.abort()

    try {
      const profileInstructions = getAstraFlowPiSubagentInstructions(name)
      const childPlan = createPiPlanTool((todos) =>
        emit({ type: "subagent_update", taskId: parentTaskId, todos })
      )
      const childTools = [
        ...baseTools.filter(
          (tool) =>
            tool.name !== "subagent" &&
            tool.name !== "task" &&
            tool.name !== "write_todos" &&
            tool.name !== "request_user_input"
        ),
        childPlan,
      ]
      const resources = await createPiSessionResources({
        payloadTransform: piRuntime.payloadTransform,
        rootDir,
        sessionId,
        systemPrompt: [
          systemPrompt,
          "You are a focused AstraFlow subagent. Complete only the delegated task and return a concise, evidence-backed result. Do not delegate another subagent.",
          profileInstructions
            ? `Apply this Pi Subagents '${name}' profile:\n\n${profileInstructions}`
            : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      })
      const created = await createAgentSession({
        cwd: rootDir,
        authStorage: piRuntime.authStorage,
        modelRegistry: piRuntime.modelRegistry,
        model: piRuntime.model,
        thinkingLevel: piRuntime.thinkingLevel,
        sessionManager: SessionManager.inMemory(rootDir),
        settingsManager: resources.settingsManager,
        resourceLoader: resources.resourceLoader,
        noTools: "builtin",
        customTools: childTools,
        tools: childTools.map((tool) => tool.name),
      })
      childSession = created.session
      const unsubscribe = childSession.subscribe((event) =>
        emitPiSessionEvent({
          emit,
          event,
          parentTaskId,
          state: childState,
        })
      )
      activeSignal.addEventListener("abort", onAbort, { once: true })

      try {
        await childSession.prompt(task, {
          expandPromptTemplates: false,
        })
      } finally {
        activeSignal.removeEventListener("abort", onAbort)
        unsubscribe()
      }

      if (childState.lastAssistantError && !activeSignal.aborted) {
        throw new Error(childState.lastAssistantError)
      }
      const lastAssistant = [...childSession.messages]
        .reverse()
        .find(
          (message): message is AssistantMessage =>
            "role" in message && message.role === "assistant"
        )
      const summary = assistantText(lastAssistant) || "Subagent completed."
      emit({
        type: "subagent_end",
        taskId: parentTaskId,
        name,
        status: "complete",
        summary,
      })
      return summary
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emit({
        type: "subagent_end",
        taskId: parentTaskId,
        name,
        status: "error",
        error: message,
      })
      throw error
    } finally {
      addPiUsage(usage, childState.usage)
      childSession?.dispose()
    }
  }

  const runParallel = async ({
    activeSignal,
    concurrency,
    parentTaskId,
    tasks,
  }: {
    activeSignal: AbortSignal
    concurrency: number
    parentTaskId: string
    tasks: Array<{ agent?: string; task: string }>
  }) => {
    const results = new Array<string>(tasks.length)
    let nextIndex = 0
    const workerCount = Math.max(
      1,
      Math.min(Math.floor(concurrency), tasks.length, 4)
    )

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < tasks.length) {
          const index = nextIndex
          nextIndex += 1
          const item = tasks[index]
          if (!item) {
            break
          }

          results[index] = await runChild({
            activeSignal,
            name: item.agent?.trim() || `subagent-${index + 1}`,
            parentTaskId: `${parentTaskId}:${index + 1}`,
            task: item.task,
          })
        }
      })
    )

    return results
  }

  const taskParameters = Type.Object(
    {
      agent: Type.Optional(Type.String()),
      task: Type.String(),
      phase: Type.Optional(Type.String()),
      label: Type.Optional(Type.String()),
      as: Type.Optional(Type.String()),
      output: Type.Optional(
        Type.Union([Type.Boolean(), Type.String()])
      ),
      outputMode: Type.Optional(
        Type.Union([Type.Literal("inline"), Type.Literal("file-only")])
      ),
    },
    { additionalProperties: true }
  )
  const chainStepParameters = Type.Object(
    {
      agent: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      phase: Type.Optional(Type.String()),
      label: Type.Optional(Type.String()),
      as: Type.Optional(Type.String()),
      output: Type.Optional(
        Type.Union([Type.Boolean(), Type.String()])
      ),
      outputMode: Type.Optional(
        Type.Union([Type.Literal("inline"), Type.Literal("file-only")])
      ),
      parallel: Type.Optional(
        Type.Array(taskParameters, { minItems: 1, maxItems: 4 })
      ),
      concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
      failFast: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: true }
  )

  return {
    name: "subagent",
    label: "subagent",
    description:
      "Delegate focused work to one or more permission-aware Pi subagents. Supports single, parallel tasks, and sequential chains.",
    parameters: Type.Object({
      action: Type.Optional(Type.Literal("list")),
      agent: Type.Optional(Type.String()),
      task: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      subagent_type: Type.Optional(Type.String()),
      tasks: Type.Optional(
        Type.Array(taskParameters, { maxItems: 4 })
      ),
      chain: Type.Optional(
        Type.Array(chainStepParameters, { maxItems: 4 })
      ),
      concurrency: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
      context: Type.Optional(
        Type.Union([Type.Literal("fresh"), Type.Literal("fork")])
      ),
      async: Type.Optional(Type.Boolean()),
    }),
    async execute(toolCallId, rawRequest, signal) {
      const request = rawRequest as PiSubagentRequest
      const activeSignal = signal ?? runSignal

      if (request.action === "list") {
        const profiles = getAstraFlowPiSubagentProfiles()

        return {
          content: [
            {
              type: "text",
              text: [
                "Available AstraFlow Pi subagent profiles:",
                ...profiles.map((name) => `- ${name}`),
                "",
                "Supported modes: single, parallel (up to 4), and sequential chain. Fork requests use a fresh permission-aware child context; async requests currently complete in the foreground.",
              ].join("\n"),
            },
          ],
          details: {
            mode: "list",
            profiles,
          },
        }
      }

      const parallelTasks = request.tasks?.filter((item) => item.task.trim())

      if (parallelTasks?.length) {
        const results = await runParallel({
          activeSignal,
          concurrency: request.concurrency ?? 4,
          parentTaskId: toolCallId,
          tasks: parallelTasks,
        })
        const summary = results
          .map((result, index) => {
            const name =
              parallelTasks[index]?.agent?.trim() || `subagent-${index + 1}`
            return `## ${name}\n\n${result}`
          })
          .join("\n\n")
        return {
          content: [{ type: "text", text: summary }],
          details: {
            mode: "parallel",
            requestedAsync: request.async === true,
            results,
          },
        }
      }

      if (request.chain?.length) {
        const originalTask =
          request.task?.trim() || request.description?.trim() || ""
        const results: string[] = []
        const outputs = new Map<string, string>()
        let previous = ""

        for (const [index, step] of request.chain.entries()) {
          if (step.parallel?.length) {
            const parallelTasks = step.parallel
              .filter((item) => item.task.trim())
              .map((item) => ({
                ...item,
                task: expandPiSubagentTaskTemplate({
                  originalTask,
                  outputs,
                  previous,
                  template: item.task,
                }),
              }))
            const parallelResults = await runParallel({
              activeSignal,
              concurrency: step.concurrency ?? request.concurrency ?? 4,
              parentTaskId: `${toolCallId}:${index + 1}`,
              tasks: parallelTasks,
            })

            for (const [taskIndex, result] of parallelResults.entries()) {
              const outputName = parallelTasks[taskIndex]?.as?.trim()
              if (outputName) {
                outputs.set(outputName, result)
              }
            }

            previous = parallelResults
              .map((result, taskIndex) => {
                const task = parallelTasks[taskIndex]
                const name =
                  task?.label?.trim() ||
                  task?.agent?.trim() ||
                  `subagent-${taskIndex + 1}`
                return `## ${name}\n\n${result}`
              })
              .join("\n\n")
            if (step.as?.trim()) {
              outputs.set(step.as.trim(), previous)
            }
            results.push(previous)
            continue
          }

          const template =
            step.task?.trim() || (index === 0 ? originalTask : "{previous}")
          const task = expandPiSubagentTaskTemplate({
            originalTask,
            outputs,
            previous,
            template,
          })
          if (!task.trim()) {
            throw new Error(`subagent chain step ${index + 1} has no task.`)
          }
          previous = await runChild({
            activeSignal,
            name: step.agent?.trim() || `subagent-${index + 1}`,
            parentTaskId: `${toolCallId}:${index + 1}`,
            task,
          })
          if (step.as?.trim()) {
            outputs.set(step.as.trim(), previous)
          }
          results.push(previous)
        }

        return {
          content: [{ type: "text", text: previous }],
          details: {
            mode: "chain",
            requestedAsync: request.async === true,
            context: request.context ?? "fresh",
            outputs: Object.fromEntries(outputs),
            results,
          },
        }
      }

      const task = request.task?.trim() || request.description?.trim()
      if (!task) {
        throw new Error("subagent requires task, tasks, or chain input.")
      }
      const name =
        request.agent?.trim() ||
        request.subagent_type?.trim() ||
        "subagent"
      const summary = await runChild({
        activeSignal,
        name,
        parentTaskId: toolCallId,
        task,
      })

      return {
        content: [{ type: "text", text: summary }],
        details: {
          mode: "single",
          requestedAsync: request.async === true,
          summary,
        },
      }
    },
  }
}

async function* streamPiRun({
  messages,
  model,
  permissionMode,
  projectPath,
  reasoningEffort,
  sessionId,
  signal,
}: AgentRunInput): AsyncGenerator<AgentEvent> {
  let mcpToolClient: Awaited<
    ReturnType<typeof createStudioMcpToolClient>
  > | null = null
  let piSession: AgentSession | null = null

  try {
    const modelverseApiKey = getStudioModelverseApiKey()?.key ?? null
    if (!modelverseApiKey) {
      throw new Error("ModelVerse API key is not configured locally.")
    }
    const rootDir = projectPath?.trim() || ensureLocalSandboxWorkspace(sessionId)
    const session = getStudioSession(sessionId)
    const queue = new AgentEventQueue()
    const permissionContext: PermissionGatewayContext = {
      sessionId,
      permissionMode,
      projectId: session?.projectId ?? null,
      signal,
      emit: (event) => queue.push(event),
    }
    const nativeTools = createNativeTools({
      modelverseApiKey,
      rootDir,
      sessionId,
    })
    nativeTools.push(
      createRequestUserInputTool({
        emit: (event) => queue.push(event),
        sessionId,
        signal,
      })
    )
    mcpToolClient = await createStudioMcpToolClient()
    const productTools = wrapToolsWithPermissionGateway(
      sortAstraFlowToolsForPromptCache(
        filterPiToolCollisions([...nativeTools, ...mcpToolClient.tools])
      ),
      permissionContext
    )
    const skills = createStudioSkillsRuntime({
      environment: "local",
      sessionId,
      modelverseApiKey,
    })
    const preparedFiles = await prepareSessionFiles({
      environment: "local",
      modelverseApiKey,
      sessionId,
    })
    const projectGuidance = createProjectGuidance(projectPath?.trim() || null)
    const expertContext = createExpertRuntimeSystemPrompt(
      getStudioSessionExpert(sessionId)?.snapshot ?? null
    )
    const systemPrompt = createPiSystemPrompt({
      expertContext,
      hasDownloadFile: productTools.some(
        (tool) => tool.name === "download_file"
      ),
      hasMcpTools: productTools.some(
        (tool) =>
          isMcpToolName(tool.name) ||
          tool.name === "list_installed_mcp_servers"
      ),
      hasMediaGeneration: productTools.some(
        (tool) =>
          tool.name === "studio_generate_image" ||
          tool.name === "studio_generate_video"
      ),
      hasUserInputRequest: productTools.some(
        (tool) => tool.name === "request_user_input"
      ),
      hasWebFetch: productTools.some((tool) => tool.name === "web_fetch"),
      hasWebSearch: productTools.some((tool) => tool.name === "web_search"),
      localRootDir: rootDir,
      model,
      projectGuidance,
      sessionFilesManifest: createSessionFilesManifest(preparedFiles),
      skillsPrompt: skills?.systemPrompt ?? "",
    })
    const piRuntime = createModelversePiRuntime({
      apiKey: modelverseApiKey,
      model,
      requestedReasoningEffort:
        reasoningEffort ?? DEFAULT_CHAT_REASONING_EFFORT,
    })
    const baseTools = [
      ...createPiLocalTools({ permissionContext, rootDir, sessionId }),
      ...adaptAstraFlowToolsToPi(productTools),
      ...adaptAstraFlowToolsToPi(skills?.tools ?? []),
    ]
    const planTool = createPiPlanTool((todos) =>
      queue.push({ type: "plan_update", todos })
    )
    const eventState = createPiEventState(rootDir)
    const subagentTool = createPiSubagentTool({
      baseTools,
      emit: (event) => queue.push(event),
      piRuntime,
      rootDir,
      sessionId,
      signal,
      systemPrompt,
      usage: eventState.usage,
    })
    const customTools = sortAstraFlowToolsForPromptCache([
      ...baseTools,
      planTool,
      subagentTool,
    ])
    const resources = await createPiSessionResources({
      payloadTransform: piRuntime.payloadTransform,
      rootDir,
      sessionId,
      systemPrompt,
    })
    const piMessages = convertAstraFlowMessagesToPi(
      messages,
      piRuntime.model
    )
    const prompt = piMessages.at(-1)
    if (!prompt || prompt.role !== "user") {
      throw new Error("AstraFlow Agent requires the latest message to be user input.")
    }
    const sessionManager = SessionManager.inMemory(rootDir)
    for (const historyMessage of piMessages.slice(0, -1)) {
      sessionManager.appendMessage(historyMessage)
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
      noTools: "builtin",
      customTools,
      tools: customTools.map((tool) => tool.name),
    })
    piSession = created.session
    const unsubscribe = piSession.subscribe((event) =>
      emitPiSessionEvent({
        emit: (agentEvent) => queue.push(agentEvent),
        event,
        state: eventState,
      })
    )
    const onAbort = () => void piSession?.abort()
    signal.addEventListener("abort", onAbort, { once: true })

    const promptInput = splitPiUserPromptContent(prompt.content)
    const completion = piSession
      .prompt(promptInput.text, {
        expandPromptTemplates: true,
        images: promptInput.images.length ? promptInput.images : undefined,
      })
      .then(() => {
        if (eventState.lastAssistantError && !signal.aborted) {
          throw new Error(eventState.lastAssistantError)
        }
        queue.push({ type: "run_meta", usage: eventState.usage })
        queue.close()
      })
      .catch((error) => {
        if (isAbortLikeError(error, signal)) {
          queue.close()
          return
        }
        queue.fail(error)
      })

    try {
      for await (const event of queue) {
        yield event
      }
      await completion
    } finally {
      signal.removeEventListener("abort", onAbort)
      unsubscribe()
    }

    debugPi("run_complete", { sessionId })
  } catch (error) {
    if (!isAbortLikeError(error, signal)) {
      throw error
    }
  } finally {
    if (signal.aborted) {
      await piSession?.abort().catch(() => undefined)
    }
    piSession?.dispose()
    cancelSessionUserInputs(sessionId)
    await mcpToolClient?.close().catch((error) => {
      console.warn("[studio-mcp] close_failed", error)
    })
  }
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

const astraflowRemoteAcpRuntime = new AcpRuntime({
  info: {
    ...ASTRAFLOW_RUNTIME_INFO,
    description:
      "AstraFlow 智能体：本地与远程沙箱均由 Pi Agent 驱动",
    capabilities: { ...ASTRAFLOW_RUNTIME_INFO.capabilities, sandbox: true },
  },
  async resolveCommand(input) {
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
      runtimeId: "astraflow",
      sessionId: input.sessionId,
    })
  },
})

export const astraflowAgentRuntime: AgentRuntime = {
  info: ASTRAFLOW_RUNTIME_INFO,
  getInfo: getAstraflowRuntimeInfo,
  startRun(input) {
    return input.environment === "remote"
      ? astraflowRemoteAcpRuntime.startRun(input)
      : streamPiRun(input)
  },
}

registerAgentRuntime(astraflowAgentRuntime)
