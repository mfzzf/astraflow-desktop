type WorkspaceGatewayAgentRuntime = {
  id: string
  available: boolean
  version?: string
}

type WorkspaceGatewayCompatibilityHealth = {
  protocolVersion: number
  agentRuntimes?: WorkspaceGatewayAgentRuntime[]
}

function requireCompatibleWorkspaceGatewayAgentRuntime({
  health,
  runtimeId,
  expectedProtocolVersion,
}: {
  health: WorkspaceGatewayCompatibilityHealth
  runtimeId: string
  expectedProtocolVersion: number
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

  // Runtime versions are informational. Compatibility is governed by the
  // Gateway protocol and runtime capabilities so patch/minor releases can
  // interoperate without forcing users to recreate otherwise valid Sandboxes.
  return runtime
}

export { requireCompatibleWorkspaceGatewayAgentRuntime }
export type {
  WorkspaceGatewayAgentRuntime,
  WorkspaceGatewayCompatibilityHealth,
}
