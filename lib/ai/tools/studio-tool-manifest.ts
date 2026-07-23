import hostToolsManifest from "@/runtime/astraflow-acp/host-tools-manifest.json" with {
  type: "json",
}

export const ASTRAFLOW_HOST_TOOLS_MANIFEST_SCHEMA_VERSION =
  hostToolsManifest.schemaVersion
export const ASTRAFLOW_HOST_TOOLS_PROTOCOL_VERSION =
  hostToolsManifest.protocolVersion
export const ASTRAFLOW_HOST_TOOLS_SERVER_NAME =
  hostToolsManifest.server.name
export const ASTRAFLOW_HOST_TOOLS_SERVER_ID =
  hostToolsManifest.server.serverId

export type AstraFlowHostToolCapabilities = {
  exa: boolean
  mobile: boolean
  modelverse: boolean
  sandboxService: boolean
  workspace: boolean
}

export function getExpectedAstraFlowHostToolNames(
  capabilities: AstraFlowHostToolCapabilities
) {
  return [
    ...hostToolsManifest.toolGroups.always,
    ...(capabilities.modelverse
      ? hostToolsManifest.toolGroups.modelverse
      : []),
    ...(capabilities.sandboxService
      ? hostToolsManifest.toolGroups.sandboxService
      : []),
    ...(capabilities.workspace
      ? hostToolsManifest.toolGroups.workspace
      : []),
    ...(capabilities.exa ? hostToolsManifest.toolGroups.exa : []),
    ...(capabilities.mobile ? hostToolsManifest.toolGroups.mobile : []),
  ]
}

export function assertAstraFlowHostToolNames(
  names: string[],
  capabilities: AstraFlowHostToolCapabilities
) {
  const expected = getExpectedAstraFlowHostToolNames(capabilities)

  if (
    names.length === expected.length &&
    names.every((name, index) => name === expected[index])
  ) {
    return
  }

  throw new Error(
    [
      "AstraFlow host tools do not match the shared runtime manifest.",
      `Expected: ${expected.join(", ")}`,
      `Received: ${names.join(", ")}`,
    ].join(" ")
  )
}
