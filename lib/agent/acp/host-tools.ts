import { z } from "zod"

import type {
  AcpMcpBridgeConnectionHandler,
  AcpMcpBridgeHostContext,
  AcpMcpBridgeServer,
} from "@/lib/agent/acp/mcp-bridge"
import type { PermissionOption } from "@/lib/agent/permission-broker"
import { requestToolPermission } from "@/lib/agent/permission-gateway"
import {
  ASTRAFLOW_HOST_TOOLS_MANIFEST_SCHEMA_VERSION,
  ASTRAFLOW_HOST_TOOLS_PROTOCOL_VERSION,
  ASTRAFLOW_HOST_TOOLS_SERVER_ID,
  ASTRAFLOW_HOST_TOOLS_SERVER_NAME,
} from "@/lib/ai/tools/studio-tool-manifest"
import {
  isAstraFlowStructuredToolResult,
  type AstraFlowTool,
} from "@/lib/ai/tools/tool"

export const ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_NAME =
  ASTRAFLOW_HOST_TOOLS_SERVER_NAME
export const ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_ID =
  ASTRAFLOW_HOST_TOOLS_SERVER_ID

const HOST_ACTION_PERMISSION_OPTIONS: PermissionOption[] = [
  {
    optionId: "allow_once",
    name: "Allow once",
    kind: "allow_once",
  },
  {
    optionId: "reject_once",
    name: "Reject",
    kind: "reject_once",
  },
]

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return (
    Boolean(signal?.aborted) ||
    (error instanceof Error && error.name === "AbortError")
  )
}

function toolInputJsonSchema(tool: AstraFlowTool) {
  return (
    tool.inputJsonSchema ??
    (z.toJSONSchema(tool.schema, {
      target: "draft-7",
      unrepresentable: "any",
    }) as Record<string, unknown>)
  )
}

/**
 * Stable MCP descriptors for AstraFlow product tools. Tests and runtime
 * adapters use this same conversion so the MCP surface cannot silently drift
 * from the underlying AstraFlowTool definitions.
 */
export function listAstraFlowToolDescriptors(tools: AstraFlowTool[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: toolInputJsonSchema(tool),
    annotations: {
      readOnlyHint: tool.effectCategory === "read_only",
    },
    _meta: {
      astraflow: {
        allowInSubagent: tool.allowInSubagent,
        effectCategory: tool.effectCategory,
      },
    },
  }))
}

async function isToolAvailable(tool: AstraFlowTool) {
  try {
    return tool.isAvailable ? await tool.isAvailable() : true
  } catch {
    return false
  }
}

function serializeToolOutput(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item
    )
  } catch {
    return String(value)
  }
}

function createToolCallResult(value: unknown) {
  if (isAstraFlowStructuredToolResult(value)) {
    return value
  }

  return {
    content: [
      {
        type: "text" as const,
        text: serializeToolOutput(value),
      },
    ],
  }
}

function createToolErrorResult(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: errorMessage(error),
      },
    ],
    isError: true,
  }
}

export async function enforceDesktopHostActionGateway({
  args,
  hostContext,
  signal,
  toolName,
}: {
  args: Record<string, unknown>
  hostContext?: AcpMcpBridgeHostContext
  signal?: AbortSignal
  toolName: string
}) {
  if (!hostContext) {
    throw new Error(
      `Desktop HostActionGateway blocked ${toolName}: trusted host context is unavailable.`
    )
  }

  const { permissionMode, projectId } = hostContext.getPermissionContext()
  const permission = await requestToolPermission({
    context: {
      sessionId: hostContext.sessionId,
      permissionMode,
      projectId,
      emit: hostContext.emitEvent,
      signal: signal ?? new AbortController().signal,
    },
    forcePrompt: true,
    input: args,
    options: HOST_ACTION_PERMISSION_OPTIONS,
    toolName,
  })

  if (!permission.allowed) {
    throw new Error(permission.message)
  }
}

function createHostToolConnection(
  tools: AstraFlowTool[],
  hostContext?: AcpMcpBridgeHostContext
): AcpMcpBridgeConnectionHandler {
  const toolsByName = new Map<string, AstraFlowTool>()

  for (const tool of tools) {
    if (toolsByName.has(tool.name)) {
      throw new Error(`Duplicate AstraFlow product tool name: ${tool.name}`)
    }

    toolsByName.set(tool.name, tool)
  }

  return {
    async request(method, params, { signal }) {
      if (method === "tools/list") {
        const availableTools = (
          await Promise.all(
            tools.map(async (tool) => ({
              available: await isToolAvailable(tool),
              tool,
            }))
          )
        )
          .filter((entry) => entry.available)
          .map((entry) => entry.tool)

        return {
          tools: listAstraFlowToolDescriptors(availableTools),
        }
      }

      if (method !== "tools/call") {
        throw new Error(`Unsupported AstraFlow host MCP method: ${method}`)
      }

      const request = getRecord(params)
      const name = request?.name

      if (typeof name !== "string" || !name.trim()) {
        throw new Error("tools/call requires a tool name.")
      }

      const tool = toolsByName.get(name)

      if (!tool) {
        throw new Error(
          `Desktop HostActionGateway blocked unknown AstraFlow product tool ${name}; unknown tools are classified as important_action.`
        )
      }

      if (!(await isToolAvailable(tool))) {
        throw new Error(
          tool.unavailableMessage ??
            `AstraFlow product tool is unavailable in this workspace: ${name}`
        )
      }

      const args = getRecord(request?.arguments) ?? {}

      try {
        signal?.throwIfAborted()
        if (tool.effectCategory === "important_action") {
          await enforceDesktopHostActionGateway({
            args,
            hostContext,
            signal,
            toolName: tool.name,
          })
        }
        signal?.throwIfAborted()
        const result = await tool.invoke(args, { signal })

        return createToolCallResult(result)
      } catch (error) {
        if (isAbortError(error, signal)) {
          throw error
        }

        return createToolErrorResult(error)
      }
    },
  }
}

export function createAstraFlowToolMcpBridgeServer({
  tools,
  name = ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_NAME,
  serverId = ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_ID,
}: {
  tools: AstraFlowTool[]
  name?: string
  serverId?: string
}): AcpMcpBridgeServer {
  return {
    name,
    serverId,
    _meta: {
      astraflow: {
        manifestSchemaVersion:
          ASTRAFLOW_HOST_TOOLS_MANIFEST_SCHEMA_VERSION,
        protocolVersion: ASTRAFLOW_HOST_TOOLS_PROTOCOL_VERSION,
        source: "desktop",
        transport: "host",
        tools: tools.map((tool) => tool.name),
      },
    },
    hostActionPolicy: "trusted_catalog",
    createConnection({ hostContext }) {
      return createHostToolConnection(tools, hostContext)
    },
  }
}
