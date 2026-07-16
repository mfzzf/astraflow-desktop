import { z } from "zod"

import type {
  AcpMcpBridgeConnectionHandler,
  AcpMcpBridgeServer,
} from "@/lib/agent/acp/mcp-bridge"
import {
  ASTRAFLOW_HOST_TOOLS_MANIFEST_SCHEMA_VERSION,
  ASTRAFLOW_HOST_TOOLS_PROTOCOL_VERSION,
  ASTRAFLOW_HOST_TOOLS_SERVER_ID,
  ASTRAFLOW_HOST_TOOLS_SERVER_NAME,
} from "@/lib/ai/tools/studio-tool-manifest"
import type { AstraFlowTool } from "@/lib/ai/tools/tool"

export const ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_NAME =
  ASTRAFLOW_HOST_TOOLS_SERVER_NAME
export const ASTRAFLOW_STUDIO_TOOLS_MCP_SERVER_ID =
  ASTRAFLOW_HOST_TOOLS_SERVER_ID

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
  }))
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

function createHostToolConnection(
  tools: AstraFlowTool[]
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
        return {
          tools: listAstraFlowToolDescriptors(tools),
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
        throw new Error(`Unknown AstraFlow product tool: ${name}`)
      }

      const args = getRecord(request?.arguments) ?? {}

      try {
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
    createConnection() {
      return createHostToolConnection(tools)
    },
  }
}
