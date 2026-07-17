import {
  AgentSession,
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent"
import path from "node:path"

/**
 * Wrap an AstraFlow-configured pi-agent-core Agent in Pi's official
 * AgentSession lifecycle without handing Pi ownership of AstraFlow's durable
 * checkpoint or compaction policy.
 */
export async function createAstraflowPiSession({
  agent,
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
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: path.join(cwd, ".astraflow", "pi"),
    settingsManager,
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

  return session
}
