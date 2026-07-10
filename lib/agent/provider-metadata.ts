import type { AgentRuntimeId } from "@/lib/agent-model-settings-shared"

export type AgentRuntimeProviderMetadata = {
  packageName: string
  packageVersion: string
  provider: string
  schemaVersion: string
}

export const AGENT_RUNTIME_PROVIDER_METADATA = {
  astraflow: {
    packageName: "deepagents",
    packageVersion: "1.10.5",
    provider: "deepagents",
    schemaVersion: "deepagents-v3-stream",
  },
  codex: {
    packageName: "@agentclientprotocol/codex-acp",
    packageVersion: "1.1.2",
    provider: "acp",
    schemaVersion: "acp-v1-sdk-1.2.1",
  },
  "claude-code": {
    packageName: "@agentclientprotocol/claude-agent-acp",
    packageVersion: "0.58.1",
    provider: "acp",
    schemaVersion: "acp-v1-sdk-1.2.1",
  },
  opencode: {
    packageName: "opencode-ai",
    packageVersion: "1.17.18",
    provider: "acp",
    schemaVersion: "acp-v1-sdk-1.2.1",
  },
  "codex-direct": {
    packageName: "@openai/codex",
    packageVersion: "0.144.1",
    provider: "codex-app-server",
    schemaVersion: "codex-app-server-generated-ts-0.144.1",
  },
  "claude-native": {
    packageName: "@anthropic-ai/claude-agent-sdk",
    packageVersion: "0.3.206",
    provider: "claude-agent-sdk",
    schemaVersion: "claude-agent-sdk-0.3.206",
  },
  "opencode-native": {
    packageName: "opencode-ai",
    packageVersion: "1.17.18",
    provider: "opencode-native",
    schemaVersion: "opencode-ai-1.17.18",
  },
} satisfies Record<AgentRuntimeId, AgentRuntimeProviderMetadata>

export function getAgentRuntimeProviderMetadata(runtimeId: string) {
  return AGENT_RUNTIME_PROVIDER_METADATA[runtimeId as AgentRuntimeId] ?? null
}
