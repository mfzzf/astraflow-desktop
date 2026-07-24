import { dirname, join } from "node:path"

import type { AcpCommandSpec } from "@/lib/agent/acp/acp-runtime"
import type { AgentRunInput } from "@/lib/agent/runtime"
import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"

export function applyClaudeCodeLocalProcessSandbox({
  command,
  input,
  providerEndpoint,
}: {
  command: AcpCommandSpec
  input: AgentRunInput
  providerEndpoint: { host: string; port: number } | null
}): AcpCommandSpec {
  const needsLocalProcessSandbox =
    input.environment !== "remote" && input.permissionMode !== "full_access"

  if (!needsLocalProcessSandbox) {
    return command
  }

  if (command.transport === "http" || command.transport === "websocket") {
    throw new Error(
      "Claude Code Local Default requires a stdio command that can be placed inside the OS sandbox."
    )
  }

  if (!providerEndpoint) {
    throw new Error(
      "Claude Code Local Default requires a Desktop-managed Modelverse provider. Select Modelverse in Agent model settings or explicitly use Full Access for local CLI settings."
    )
  }

  const runtimeStateRoot = join(
    ensureLocalSandboxWorkspace(input.sessionId),
    "claude-code-runtime"
  )
  const nativeExecutable = command.env?.CLAUDE_CODE_EXECUTABLE?.trim()

  return {
    ...command,
    sandbox: {
      additionalReadRoots: [
        dirname(command.command),
        ...(nativeExecutable ? [dirname(nativeExecutable)] : []),
      ],
      allowedNetworkDomains: [],
      allowedNetworkEndpoints: [providerEndpoint],
      kind: "astraflow-local",
      runtimeStateRoot,
      sessionId: input.sessionId,
    },
  }
}
