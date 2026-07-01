import {
  MultiServerMCPClient,
  type Connection,
} from "@langchain/mcp-adapters"
import { tool } from "langchain"
import { z } from "zod"

import {
  getMcpToolServerName,
  keyValuesToRecord,
  type InstalledMcpServer,
} from "@/lib/mcp"
import {
  listStudioMcpServers,
  updateStudioMcpServerConnectionError,
} from "@/lib/studio-db"

const MCP_TOOL_TIMEOUT_MS = 60_000

export type StudioMcpToolClient = {
  tools: Awaited<ReturnType<MultiServerMCPClient["getTools"]>>
  close: () => Promise<void>
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function formatInstalledMcpServersForModel() {
  const servers = listStudioMcpServers()

  if (!servers.length) {
    return "No MCP servers are currently installed."
  }

  return servers
    .map((server) => {
      const enabled = server.enabled ? "enabled" : "disabled"
      const discoveredTools =
        server.tools.length > 0
          ? server.tools.map((item) => item.name).join(", ")
          : "none discovered"
      const resources =
        server.resources.length > 0
          ? server.resources.map((item) => item.name || item.uri).join(", ")
          : "none discovered"
      const prompts =
        server.prompts.length > 0
          ? server.prompts.map((item) => item.name).join(", ")
          : "none discovered"
      const connection =
        server.lastError
          ? `last error: ${server.lastError}`
          : server.lastConnectedAt
            ? `last connected at ${server.lastConnectedAt}`
            : "not tested or not connected yet"

      return [
        `- ${server.id} | ${server.title || server.name}`,
        `name: ${server.name}`,
        `status: ${enabled}`,
        `transport: ${server.transport}`,
        `source: ${server.source}`,
        `connection: ${connection}`,
        `tools: ${discoveredTools}`,
        `resources: ${resources}`,
        `prompts: ${prompts}`,
      ].join(" | ")
    })
    .join("\n")
}

export function createListInstalledMcpServersTool() {
  return tool(
    async () => {
      return formatInstalledMcpServersForModel()
    },
    {
      name: "list_installed_mcp_servers",
      description:
        "List installed AstraFlow MCP servers with enabled state, transport, connection status, and discovered tools/resources/prompts. Use this when the user asks what MCP servers/plugins are installed or available.",
      schema: z.object({}),
    }
  )
}

function toLangChainMcpConnection(server: InstalledMcpServer): Connection {
  const config = server.config

  if (config.type === "stdio") {
    return {
      transport: "stdio",
      command: config.command,
      args: config.args ?? [],
      env: keyValuesToRecord(config.env),
      ...(config.cwd ? { cwd: config.cwd } : {}),
      stderr: "pipe",
      defaultToolTimeout: MCP_TOOL_TIMEOUT_MS,
    }
  }

  return {
    transport: config.type === "sse" ? "sse" : "http",
    url: config.url,
    headers: keyValuesToRecord(config.headers),
    automaticSSEFallback: config.type === "streamable-http",
    defaultToolTimeout: MCP_TOOL_TIMEOUT_MS,
  }
}

export async function createStudioMcpToolClient(): Promise<StudioMcpToolClient> {
  const enabledServers = listStudioMcpServers({
    enabledOnly: true,
    includeSecrets: true,
  })
  const mcpServers: Record<string, Connection> = {}
  const serverNameToId = new Map<string, string>()

  for (const server of enabledServers) {
    const serverName = getMcpToolServerName(server.id)

    serverNameToId.set(serverName, server.id)
    mcpServers[serverName] = toLangChainMcpConnection(server)
  }

  if (Object.keys(mcpServers).length === 0) {
    return {
      tools: [],
      close: async () => undefined,
    }
  }

  const client = new MultiServerMCPClient({
    mcpServers,
    throwOnLoadError: false,
    prefixToolNameWithServerName: true,
    additionalToolNamePrefix: "",
    useStandardContentBlocks: false,
    onConnectionError: ({ serverName, error }) => {
      const serverId = serverNameToId.get(serverName)

      if (serverId) {
        updateStudioMcpServerConnectionError(serverId, toErrorMessage(error))
      }
    },
    defaultToolTimeout: MCP_TOOL_TIMEOUT_MS,
  })

  try {
    const tools = await client.getTools()

    return {
      tools,
      close: () => client.close(),
    }
  } catch (error) {
    console.warn("[studio-mcp] failed_to_load_tools", error)
    await client.close().catch(() => undefined)

    return {
      tools: [],
      close: async () => undefined,
    }
  }
}
