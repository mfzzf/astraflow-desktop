export const agentRuntimeVersionCompatibilityMatrix = [
  {
    packageName: "@agentclientprotocol/sdk",
    version: "1.2.1",
    coverage: "ACP session/update mapper fixture",
  },
  {
    packageName: "@agentclientprotocol/codex-acp",
    version: "1.1.2",
    coverage: "Codex ACP fallback runtime",
  },
  {
    packageName: "@agentclientprotocol/claude-agent-acp",
    version: "0.59.0",
    coverage: "Claude Code ACP fallback runtime",
  },
  {
    packageName: "@openai/codex",
    version: "0.144.4",
    coverage: "Generated Codex app-server TypeScript schema and direct runtime",
  },
  {
    packageName: "@anthropic-ai/claude-agent-sdk",
    version: "0.3.210",
    coverage: "Claude native task/subagent mapper fixture",
  },
  {
    packageName: "opencode-ai",
    version: "1.18.1",
    coverage: "OpenCode native event replay fixture",
  },
  {
    packageName: "@earendil-works/pi-coding-agent",
    version: "0.80.7",
    coverage: "AstraFlow built-in Pi Agent runtime",
  },
] as const
