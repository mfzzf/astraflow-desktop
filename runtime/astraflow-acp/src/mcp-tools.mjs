import { tool } from "@langchain/core/tools"

import {
  ASTRAFLOW_ACP_BUILTIN_TOOL_NAMES,
  asErrorMessage,
  getRecord,
  stringify,
} from "./constants.mjs"

const MCP_METHODS = {
  connect: "mcp/connect",
  message: "mcp/message",
  disconnect: "mcp/disconnect",
}

function sanitizeToolName(value) {
  const normalized = value
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")

  return (normalized || "tool").slice(0, 96)
}

function selectToolName(serverName, toolName, usedNames) {
  const requested = sanitizeToolName(toolName)
  const candidate =
    !usedNames.has(requested) && !ASTRAFLOW_ACP_BUILTIN_TOOL_NAMES.has(requested)
      ? requested
      : sanitizeToolName(`${serverName}_${requested}`)
  let unique = candidate
  let suffix = 2

  while (usedNames.has(unique) || ASTRAFLOW_ACP_BUILTIN_TOOL_NAMES.has(unique)) {
    unique = `${candidate.slice(0, 88)}_${suffix}`
    suffix += 1
  }

  usedNames.add(unique)
  return unique
}

function toolResultToText(result) {
  const record = getRecord(result)
  const content = Array.isArray(record?.content) ? record.content : []
  const text = content
    .map((entry) => {
      const item = getRecord(entry)

      if (item?.type === "text" && typeof item.text === "string") {
        return item.text
      }

      return stringify(entry)
    })
    .filter(Boolean)
    .join("\n")

  return text || stringify(result)
}

async function connectAcpMcpServer({ client, server, signal }) {
  const connected = await client.request(
    MCP_METHODS.connect,
    { serverId: server.serverId },
    { signal }
  )
  const connectionId = connected?.connectionId

  if (typeof connectionId !== "string" || !connectionId) {
    throw new Error(`MCP server ${server.name} returned no connection id.`)
  }

  const request = (method, params = {}) =>
    client.request(
      MCP_METHODS.message,
      { connectionId, method, params },
      { signal }
    )
  const listed = await request("tools/list", {})
  const tools = Array.isArray(listed?.tools) ? listed.tools : []

  return {
    connectionId,
    server,
    tools,
    request,
    async close() {
      await client
        .request(
          MCP_METHODS.disconnect,
          { connectionId },
          { signal: AbortSignal.timeout(5_000) }
        )
        .catch(() => undefined)
    },
  }
}

export async function createAcpMcpTools({
  client,
  mcpServers,
  sessionId,
  signal,
}) {
  const acpServers = mcpServers.filter(
    (server) =>
      server?.type === "acp" &&
      typeof server.name === "string" &&
      typeof server.serverId === "string"
  )
  const connections = []
  const tools = []
  const usedNames = new Set()

  try {
    for (const server of acpServers) {
      const connection = await connectAcpMcpServer({
        client,
        server,
        signal,
      })

      connections.push(connection)

      for (const descriptor of connection.tools) {
        const record = getRecord(descriptor)

        if (typeof record?.name !== "string" || !record.name.trim()) {
          continue
        }

        const name = selectToolName(server.name, record.name, usedNames)
        const description =
          typeof record.description === "string" && record.description.trim()
            ? record.description.trim()
            : `Call ${record.name} from the ${server.name} MCP server.`
        const schema = getRecord(record.inputSchema) || {
          type: "object",
          properties: {},
          additionalProperties: true,
        }

        tools.push(
          tool(
            async (input) => {
              const result = await connection.request("tools/call", {
                name: record.name,
                arguments: getRecord(input) || {},
                _meta: { astraflowSessionId: sessionId },
              })

              if (getRecord(result)?.isError === true) {
                throw new Error(toolResultToText(result))
              }

              return toolResultToText(result)
            },
            { name, description, schema }
          )
        )
      }
    }
  } catch (error) {
    await Promise.all(connections.map((connection) => connection.close()))
    throw new Error(`Could not connect Desktop MCP tools: ${asErrorMessage(error)}`)
  }

  return {
    tools,
    async close() {
      await Promise.all(connections.map((connection) => connection.close()))
    },
  }
}
