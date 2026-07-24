type WorkspaceGatewayAgentRuntime = {
  id: string
  available: boolean
  version?: string
}

type WorkspaceGatewayCompatibilityHealth = {
  protocolVersion: number
  capabilities?: string[]
  agentRuntimes?: WorkspaceGatewayAgentRuntime[]
}

const ASTRAFLOW_WORKSPACE_CONFINEMENT_CAPABILITY =
  "agent.astraflow.workspace-confinement.v1"

function requireCompatibleWorkspaceGatewayAgentRuntime({
  health,
  runtimeId,
  expectedProtocolVersion,
  requiredCapabilities = [],
}: {
  health: WorkspaceGatewayCompatibilityHealth
  runtimeId: string
  expectedProtocolVersion: number
  requiredCapabilities?: string[]
}) {
  if (health.protocolVersion !== expectedProtocolVersion) {
    throw new Error(
      `Workspace Gateway protocol ${health.protocolVersion} is incompatible with Desktop protocol ${expectedProtocolVersion}.`
    )
  }

  const runtime = health.agentRuntimes?.find(
    (candidate) => candidate.id === runtimeId
  )

  if (!runtime?.available) {
    throw new Error(
      `This Sandbox template does not provide the ${runtimeId} Agent runtime. Create a Sandbox from the updated astraflow-code template.`
    )
  }

  const advertisedCapabilities = new Set(health.capabilities ?? [])
  const missingCapabilities = requiredCapabilities.filter(
    (capability) => !advertisedCapabilities.has(capability)
  )

  if (missingCapabilities.length > 0) {
    throw new Error(
      `This Sandbox template does not provide required Workspace Gateway capabilities: ${missingCapabilities.join(", ")}. Create a Sandbox from the updated astraflow-code template.`
    )
  }

  // Runtime versions are informational. Compatibility is governed by the
  // Gateway protocol and runtime capabilities so patch/minor releases can
  // interoperate without forcing users to recreate otherwise valid Sandboxes.
  return runtime
}

export {
  ASTRAFLOW_WORKSPACE_CONFINEMENT_CAPABILITY,
  requireCompatibleWorkspaceGatewayAgentRuntime,
}
export type {
  WorkspaceGatewayAgentRuntime,
  WorkspaceGatewayCompatibilityHealth,
}
