import type { AgentRuntimeId } from "@/lib/agent-model-settings-shared"
import type { ChatReasoningEffort, SupportedChatModel } from "@/lib/chat-models"
import type { AgentEvent } from "@/lib/agent/events"
import type { ComposerCapabilities } from "@/lib/agent/composer-types"
import type { AgentMessage } from "@/lib/agent/messages"
import type { StudioPermissionMode } from "@/lib/studio-types"

export type RuntimeCapabilities = {
  hitl: boolean
  resume: boolean
  subagents: boolean
  plan: boolean
  sandbox: boolean
  mcp: boolean
  skills: boolean
  compact: boolean
}

export type AgentRuntimeInfo = {
  id: AgentRuntimeId
  label: string
  description: string
  capabilities: RuntimeCapabilities
  composer?: ComposerCapabilities
}

export type AgentRunEnvironment = "remote" | "local"

export type AgentRunInput = {
  sessionId: string
  messages: AgentMessage[]
  model: SupportedChatModel
  reasoningEffort?: ChatReasoningEffort
  projectPath?: string | null
  workspaceId?: string | null
  workspaceRoot?: string | null
  permissionMode: StudioPermissionMode
  runtimeSessionRef?: string | null
  environment?: AgentRunEnvironment
  signal: AbortSignal
}

export interface AgentRuntime {
  readonly info: AgentRuntimeInfo
  getInfo?: () => AgentRuntimeInfo
  prepareRun?: (input: AgentRunInput) => Promise<void>
  startRun(input: AgentRunInput): AsyncIterable<AgentEvent>
}

export const DEFAULT_AGENT_RUNTIME_ID: AgentRuntimeId = "astraflow"

declare global {
  var astraflowAgentRuntimeRegistry:
    Map<AgentRuntimeId, AgentRuntime> | undefined
}

function getAgentRuntimeRegistry() {
  if (!globalThis.astraflowAgentRuntimeRegistry) {
    globalThis.astraflowAgentRuntimeRegistry = new Map()
  }

  return globalThis.astraflowAgentRuntimeRegistry
}

export function registerAgentRuntime(runtime: AgentRuntime): void {
  const registry = getAgentRuntimeRegistry()

  registry.set(runtime.info.id, runtime)
}

export function getAgentRuntime(id: string): AgentRuntime | null {
  return getAgentRuntimeRegistry().get(id as AgentRuntimeId) ?? null
}

export function listAgentRuntimeInfos(): AgentRuntimeInfo[] {
  return Array.from(getAgentRuntimeRegistry().values()).map(
    (runtime) => runtime.getInfo?.() ?? runtime.info
  )
}
