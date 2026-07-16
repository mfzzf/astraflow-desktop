import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  Type,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai"
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  defineTool,
} from "@earendil-works/pi-coding-agent"

const rootDir = await mkdtemp(join(tmpdir(), "astraflow-pi-smoke-"))
const faux = fauxProvider({ tokensPerSecond: 0 })
const fauxModel = faux.getModel()
const authStorage = AuthStorage.inMemory()
const modelRegistry = ModelRegistry.inMemory(authStorage)
const settingsManager = SettingsManager.inMemory(
  { compaction: { enabled: false }, retry: { enabled: false } },
  { projectTrusted: true }
)
let session: Awaited<ReturnType<typeof createAgentSession>>["session"] | null =
  null

try {
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("echo", { value: "hello from Pi" }, { id: "smoke-echo" }),
      { stopReason: "toolUse" }
    ),
    fauxAssistantMessage("Pi Agent smoke test complete."),
  ])
  modelRegistry.registerProvider("faux", {
    api: faux.api,
    apiKey: "deterministic-test-key",
    streamSimple: faux.provider.streamSimple,
    baseUrl: fauxModel.baseUrl,
    models: [
      {
        id: fauxModel.id,
        name: fauxModel.name,
        api: faux.api,
        baseUrl: fauxModel.baseUrl,
        reasoning: false,
        input: ["text"],
        cost: fauxModel.cost,
        contextWindow: fauxModel.contextWindow,
        maxTokens: fauxModel.maxTokens,
      },
    ],
  })

  const model = modelRegistry.find("faux", fauxModel.id)
  assert.ok(model)
  const resourceLoader = new DefaultResourceLoader({
    cwd: rootDir,
    agentDir: join(rootDir, "agent"),
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "Run the deterministic AstraFlow Pi Agent smoke test.",
  })
  await resourceLoader.reload()

  let echoCalls = 0
  const echo = defineTool({
    name: "echo",
    label: "echo",
    description: "Echo one value.",
    parameters: Type.Object({ value: Type.String() }),
    async execute(_toolCallId, { value }) {
      echoCalls += 1
      return {
        content: [{ type: "text", text: value }],
        details: undefined,
      }
    },
  })
  const created = await createAgentSession({
    cwd: rootDir,
    authStorage,
    modelRegistry,
    model,
    thinkingLevel: "off",
    sessionManager: SessionManager.inMemory(rootDir),
    settingsManager,
    resourceLoader,
    noTools: "builtin",
    customTools: [echo],
    tools: [echo.name],
  })
  session = created.session
  const events: string[] = []
  session.subscribe((event) => {
    events.push(event.type)
  })

  await session.prompt("Exercise one tool, then answer.", {
    expandPromptTemplates: false,
  })

  const lastMessage = session.messages.at(-1)
  assert.equal(echoCalls, 1)
  assert.equal(faux.state.callCount, 2)
  assert.ok(events.includes("tool_execution_start"))
  assert.ok(events.includes("tool_execution_end"))
  assert.ok(lastMessage && "role" in lastMessage)
  assert.equal(lastMessage.role, "assistant")
  assert.equal(lastMessage.stopReason, "stop")
  assert.equal(lastMessage.content[0]?.type, "text")
  assert.equal(lastMessage.content[0]?.text, "Pi Agent smoke test complete.")

  console.log("Pi Agent 0.80.7 deterministic SDK smoke test passed.")
} finally {
  session?.dispose()
  modelRegistry.unregisterProvider("faux")
  await rm(rootDir, { recursive: true, force: true })
}
