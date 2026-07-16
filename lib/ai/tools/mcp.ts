import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { z } from "zod"

import {
  createAstraFlowTool,
  type AstraFlowTool,
} from "@/lib/ai/tools/tool"
import {
  getMcpToolServerName,
  sanitizeMcpToolNameSegment,
  type InstalledMcpServer,
} from "@/lib/mcp"
import { createMcpTransport } from "@/lib/studio-mcp"
import {
  listStudioMcpServers,
  updateStudioMcpServerConnectionError,
} from "@/lib/studio-db"

const MCP_TOOL_TIMEOUT_MS = 60_000

export type StudioMcpToolClient = {
  tools: AstraFlowTool[]
  close: () => Promise<void>
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
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
  return createAstraFlowTool(
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

function createMcpClient() {
  return new Client(
    {
      name: "astraflow-desktop",
      version: "1.1.4",
    },
    {
      capabilities: {},
    }
  )
}

async function connectMcpClient(server: InstalledMcpServer) {
  const config = server.config
  const client = createMcpClient()

  try {
    await client.connect(
      createMcpTransport(config),
      { timeout: MCP_TOOL_TIMEOUT_MS }
    )
    return client
  } catch (primaryError) {
    await client.close().catch(() => undefined)

    if (config.type !== "streamable-http") {
      throw primaryError
    }

    const sseClient = createMcpClient()
    try {
      await sseClient.connect(
        createMcpTransport({ ...config, type: "sse" }),
        { timeout: MCP_TOOL_TIMEOUT_MS }
      )
      return sseClient
    } catch (sseError) {
      await sseClient.close().catch(() => undefined)
      throw new AggregateError(
        [primaryError, sseError],
        `Unable to connect to MCP server ${server.title || server.name}.`
      )
    }
  }
}

async function listMcpTools(client: Client) {
  const tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = []
  let cursor: string | undefined

  do {
    const page = await client.listTools(
      cursor ? { cursor } : undefined,
      { timeout: MCP_TOOL_TIMEOUT_MS }
    )

    tools.push(...page.tools)
    cursor = page.nextCursor
  } while (cursor)

  return tools
}

function selectMcpToolName({
  serverId,
  toolName,
  usedNames,
}: {
  serverId: string
  toolName: string
  usedNames: Set<string>
}) {
  const serverName = getMcpToolServerName(serverId)
  const toolSegment = sanitizeMcpToolNameSegment(toolName)
  const baseName = `${serverName}__${toolSegment}`
  let name = baseName
  let suffix = 2

  while (usedNames.has(name)) {
    name = `${baseName}_${suffix}`
    suffix += 1
  }

  usedNames.add(name)
  return name
}

function createMcpTool({
  client,
  remoteTool,
  server,
  usedNames,
}: {
  client: Client
  remoteTool: Awaited<ReturnType<Client["listTools"]>>["tools"][number]
  server: InstalledMcpServer
  usedNames: Set<string>
}) {
  const name = selectMcpToolName({
    serverId: server.id,
    toolName: remoteTool.name,
    usedNames,
  })

  return createAstraFlowTool(
    async (input, { signal }) => {
      try {
        const result = await client.callTool(
          {
            name: remoteTool.name,
            arguments: input,
          },
          undefined,
          {
            signal,
            timeout: MCP_TOOL_TIMEOUT_MS,
          }
        )

        const resultRecord = getRecord(result)

        if (resultRecord?.isError === true) {
          const content = Array.isArray(resultRecord.content)
            ? resultRecord.content
            : []
          const message = content
            .flatMap((entry) => {
              const item = getRecord(entry)

              return item?.type === "text" && typeof item.text === "string"
                ? [item.text]
                : []
            })
            .join("\n")

          throw new Error(message || `MCP tool ${remoteTool.name} failed.`)
        }

        return result
      } catch (error) {
        updateStudioMcpServerConnectionError(
          server.id,
          toErrorMessage(error)
        )
        throw error
      }
    },
    {
      name,
      description:
        remoteTool.description ||
        `Call ${remoteTool.name} on MCP server ${server.title || server.name}.`,
      schema: z.looseObject({}),
      inputJsonSchema: remoteTool.inputSchema,
    }
  )
}

async function connectMcpServer(
  server: InstalledMcpServer,
  usedNames: Set<string>
) {
  let client: Client | null = null

  try {
    const connectedClient = await connectMcpClient(server)

    client = connectedClient
    const remoteTools = await listMcpTools(connectedClient)

    return {
      client: connectedClient,
      tools: remoteTools.map((remoteTool) =>
        createMcpTool({
          client: connectedClient,
          remoteTool,
          server,
          usedNames,
        })
      ),
    }
  } catch (error) {
    updateStudioMcpServerConnectionError(server.id, toErrorMessage(error))
    await client?.close().catch(() => undefined)
    console.warn(
      `[studio-mcp] failed_to_load_tools server=${server.id}`,
      error
    )
    return null
  }
}

export async function createStudioMcpToolClient(): Promise<StudioMcpToolClient> {
  const enabledServers = listStudioMcpServers({
    enabledOnly: true,
    includeSecrets: true,
  })

  if (!enabledServers.length) {
    return {
      tools: [],
      close: async () => undefined,
    }
  }

  const usedNames = new Set<string>()
  const connections = (
    await Promise.all(
      enabledServers.map((server) => connectMcpServer(server, usedNames))
    )
  ).filter((connection) => connection !== null)

  return {
    tools: connections.flatMap((connection) => connection.tools),
    close: async () => {
      await Promise.allSettled(
        connections.map((connection) => connection.client.close())
      )
    },
  }
}
