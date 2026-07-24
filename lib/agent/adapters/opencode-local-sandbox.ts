import { dirname, join } from "node:path"

import type { AcpCommandSpec } from "@/lib/agent/acp/acp-runtime"
import type { AgentRunInput } from "@/lib/agent/runtime"
import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"

export function createOpenCodePermissionConfig(
  mode: AgentRunInput["permissionMode"]
) {
  if (mode === "default" || mode === "full_access") {
    return "allow"
  }

  if (mode === "legacy_readonly") {
    return {
      "*": "deny",
      grep: "allow",
      glob: "allow",
      read: "allow",
      question: "allow",
      skill: "allow",
      webfetch: "allow",
      websearch: "allow",
    }
  }

  return {
    "*": "ask",
    grep: "allow",
    glob: "allow",
    read: "allow",
  }
}

export function applyOpenCodeLocalProcessSandbox({
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
      "OpenCode Local Default requires a stdio command that can be placed inside the OS sandbox."
    )
  }

  if (!providerEndpoint) {
    throw new Error(
      "OpenCode Local Default requires a Desktop-managed Modelverse provider. Select Modelverse in Agent model settings or explicitly use Full Access for local CLI settings."
    )
  }

  const runtimeStateRoot = join(
    ensureLocalSandboxWorkspace(input.sessionId),
    "opencode-runtime"
  )

  return {
    ...command,
    env: {
      ...(command.env ?? {}),
      // Never let a sandboxed OpenCode process reuse the user's host database.
      OPENCODE_DB: join(runtimeStateRoot, "astraflow-opencode.db"),
    },
    sandbox: {
      additionalReadRoots: [dirname(command.command)],
      allowedNetworkDomains: [],
      allowedNetworkEndpoints: [providerEndpoint],
      kind: "astraflow-local",
      runtimeStateRoot,
      sessionId: input.sessionId,
      stateRoot: join(runtimeStateRoot, "state"),
    },
  }
}
