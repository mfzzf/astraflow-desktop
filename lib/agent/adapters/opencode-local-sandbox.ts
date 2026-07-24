import { dirname, join } from "node:path"

import type { AcpCommandSpec } from "@/lib/agent/acp/acp-runtime"
import type { AgentRunInput } from "@/lib/agent/runtime"
import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"

const OPENCODE_BOOTSTRAP_ENDPOINTS = [
  { host: "models.dev", port: 443 },
  { host: "registry.npmjs.org", port: 443 },
]

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
      // OpenCode ACP starts an internal loopback server even though Desktop
      // communicates with it over stdio. External egress remains restricted
      // to the Desktop-managed provider endpoint.
      allowLocalBinding: true,
      // Bun asks trustd to validate TLS certificates on macOS. Grant only the
      // required service instead of enabling broader weak network isolation.
      allowMachLookup: ["com.apple.trustd.agent"],
      // Sandbox Runtime requires credential injection hosts to be present in
      // allowedDomains. Limit that host allowance to Desktop's loopback proxy;
      // all non-loopback egress remains exact-endpoint restricted below.
      allowedNetworkDomains: [providerEndpoint.host],
      // OpenCode resolves its provider catalog and bootstraps its pinned
      // @opencode-ai/plugin package inside the isolated runtime HOME. Without
      // these two read-only upstreams, a fresh session cannot initialize.
      allowedNetworkEndpoints: [
        providerEndpoint,
        ...OPENCODE_BOOTSTRAP_ENDPOINTS,
      ],
      kind: "astraflow-local",
      ...(command.providerProxyToken &&
      command.env?.ASTRAFLOW_MODELVERSE_API_KEY === command.providerProxyToken
        ? {
            // OpenCode reads its provider configuration more than once while
            // creating an ACP session. Give it a repeatable sentinel while
            // Sandbox Runtime substitutes the scoped token only on requests
            // to Desktop's provider proxy.
            maskedEnvironmentVariables: [
              {
                injectHosts: [providerEndpoint.host],
                name: "ASTRAFLOW_MODELVERSE_API_KEY",
              },
            ],
            // Desktop's scoped provider proxy is loopback HTTP. Sentinel
            // substitution works for plain HTTP and avoids requiring a
            // per-session CA inside the dedicated Windows sandbox account.
            terminateMaskedCredentialTls: false,
          }
        : {}),
      runtimeStateRoot,
      sessionId: input.sessionId,
      stateRoot: join(runtimeStateRoot, "state"),
    },
  }
}
