import {
  AgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"
import { createRequire } from "node:module"
import path from "node:path"

const runtimeRequire = createRequire(import.meta.url)

function getRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null
}

export function resolveAstraflowPiPackageResources() {
  const subagentsRoot = path.dirname(
    runtimeRequire.resolve("pi-subagents/package.json")
  )

  return {
    skillPaths: [path.join(subagentsRoot, "skills", "pi-subagents")],
    promptTemplatePaths: [path.join(subagentsRoot, "prompts")],
  }
}

export async function sendAstraflowPiUserMessage(
  session,
  content,
  { deliverAs } = {}
) {
  let text
  let images

  if (typeof content === "string") {
    text = content
  } else {
    const textParts = []
    images = []

    for (const part of content) {
      if (part.type === "text") {
        textParts.push(part.text)
      } else if (part.type === "image") {
        images.push(part)
      }
    }

    text = textParts.join("\n")
    if (images.length === 0) {
      images = undefined
    }
  }

  await session.prompt(text, {
    expandPromptTemplates: true,
    ...(deliverAs ? { streamingBehavior: deliverAs } : {}),
    ...(images ? { images } : {}),
    source: "extension",
  })
}

export function mergeAstraflowAfterToolCallResult(context, sessionResult) {
  const contextResult = getRecord(context)?.result
  const sessionPatch = getRecord(sessionResult)
  const contextDetails = getRecord(contextResult)?.details
  const patchedDetails = sessionPatch?.details

  if (
    getRecord(contextDetails)?.mcpIsError !== true &&
    getRecord(patchedDetails)?.mcpIsError !== true
  ) {
    return sessionResult
  }

  return {
    ...(sessionPatch || {}),
    isError: true,
  }
}

/**
 * Wrap an AstraFlow-configured pi-agent-core Agent in Pi's official
 * AgentSession lifecycle without handing Pi ownership of AstraFlow's durable
 * checkpoint or compaction policy.
 */
export async function createAstraflowPiSession({
  agent,
  agentDir,
  apiKey,
  beforeToolCall,
  cwd,
  model,
  retrySettings,
  systemPrompt,
  tools,
}) {
  const settingsManager = SettingsManager.inMemory(
    {
      compaction: { enabled: false },
      ...(retrySettings ? { retry: retrySettings } : {}),
    },
    { projectTrusted: true }
  )
  const packageResources = resolveAstraflowPiPackageResources()
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: path.resolve(agentDir),
    settingsManager,
    additionalSkillPaths: packageResources.skillPaths,
    additionalPromptTemplatePaths: packageResources.promptTemplatePaths,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt,
  })
  await resourceLoader.reload()

  const authStorage = AuthStorage.inMemory({
    [model.provider]: { type: "api_key", key: apiKey },
  })
  const modelRegistry = ModelRegistry.inMemory(authStorage)
  const sessionManager = SessionManager.inMemory(cwd)
  const baseToolsOverride = Object.fromEntries(
    tools.map((tool) => [tool.name, tool])
  )
  const session = new AgentSession({
    agent,
    sessionManager,
    settingsManager,
    cwd,
    resourceLoader,
    modelRegistry,
    baseToolsOverride,
    initialActiveToolNames: tools.map((tool) => tool.name),
  })

  // AgentSession installs extension-aware tool hooks. AstraFlow has no Pi
  // extensions in this runtime, but compose the hooks so the ACP permission
  // backend remains authoritative without disabling future Pi hooks.
  const sessionBeforeToolCall = agent.beforeToolCall
  agent.beforeToolCall = async (context, signal) => {
    const sessionDecision = await sessionBeforeToolCall?.(context, signal)

    if (sessionDecision?.block) {
      return sessionDecision
    }

    return beforeToolCall?.(context, signal)
  }

  const sessionAfterToolCall = agent.afterToolCall
  agent.afterToolCall = async (context, signal) => {
    const sessionResult = await sessionAfterToolCall?.(context, signal)

    return mergeAstraflowAfterToolCallResult(context, sessionResult)
  }

  return session
}
