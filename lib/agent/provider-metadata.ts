import type { AgentRuntimeId } from "@/lib/agent-model-settings-shared"

export type AgentRuntimeProviderMetadata = {
  packageName: string
  packageVersion: string
  provider: string
  schemaVersion: string
}

export const AGENT_RUNTIME_PROVIDER_METADATA = {
  astraflow: {
    packageName: "@earendil-works/pi-coding-agent",
    packageVersion: "0.80.7",
    provider: "pi-agent",
    schemaVersion: "pi-agent-session-v1",
  },
  codex: {
    packageName: "@agentclientprotocol/codex-acp",
    packageVersion: "1.1.4",
    provider: "acp",
    schemaVersion: "acp-v1-sdk-1.2.1",
  },
  "claude-code": {
    packageName: "@agentclientprotocol/claude-agent-acp",
    packageVersion: "0.59.0",
    provider: "acp",
    schemaVersion: "acp-v1-sdk-1.2.1",
  },
  opencode: {
    packageName: "opencode-ai",
    packageVersion: "1.18.3",
    provider: "acp",
    schemaVersion: "acp-v1-sdk-1.2.1",
  },
  "codex-direct": {
    packageName: "@openai/codex",
    packageVersion: "0.144.5",
    provider: "codex-app-server",
    schemaVersion: "codex-app-server-generated-ts-0.144.5",
  },
  "claude-native": {
    packageName: "@anthropic-ai/claude-agent-sdk",
    packageVersion: "0.3.214",
    provider: "claude-agent-sdk",
    schemaVersion: "claude-agent-sdk-0.3.214",
  },
  "opencode-native": {
    packageName: "opencode-ai",
    packageVersion: "1.18.3",
    provider: "opencode-native",
    schemaVersion: "opencode-ai-1.18.3",
  },
} satisfies Record<AgentRuntimeId, AgentRuntimeProviderMetadata>

export function getAgentRuntimeProviderMetadata(runtimeId: string) {
  return AGENT_RUNTIME_PROVIDER_METADATA[runtimeId as AgentRuntimeId] ?? null
}
