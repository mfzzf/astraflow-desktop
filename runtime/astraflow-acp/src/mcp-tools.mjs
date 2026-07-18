import { Type } from "@earendil-works/pi-ai"

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
    !usedNames.has(requested) &&
    !ASTRAFLOW_ACP_BUILTIN_TOOL_NAMES.has(requested)
      ? requested
      : sanitizeToolName(`${serverName}_${requested}`)
  let unique = candidate
  let suffix = 2

  while (
    usedNames.has(unique) ||
    ASTRAFLOW_ACP_BUILTIN_TOOL_NAMES.has(unique)
  ) {
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
  let connectionId = null
  const close = async () => {
    if (!connectionId) {
      return
    }

    await client
      .request(
        MCP_METHODS.disconnect,
        { connectionId },
        { cancellationSignal: AbortSignal.timeout(5_000) }
      )
      .catch(() => undefined)
  }

  try {
    const connected = await client.request(
      MCP_METHODS.connect,
      { serverId: server.serverId },
      { cancellationSignal: signal }
    )

    connectionId = connected?.connectionId

    if (typeof connectionId !== "string" || !connectionId) {
      throw new Error(`MCP server ${server.name} returned no connection id.`)
    }

    const request = (method, params = {}) =>
      client.request(
        MCP_METHODS.message,
        { connectionId, method, params },
        { cancellationSignal: signal }
      )
    const listed = await request("tools/list", {})
    const tools = Array.isArray(listed?.tools) ? listed.tools : []

    return {
      connectionId,
      server,
      tools,
      request,
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}

function isAbortError(error, signal) {
  return (
    signal.aborted ||
    getRecord(error)?.name === "AbortError" ||
    /abort|cancel/i.test(asErrorMessage(error))
  )
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
  const failures = []
  const tools = []
  const usedNames = new Set()

  for (const server of acpServers) {
    try {
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

        const piTool = {
          name,
          label:
            typeof record.title === "string" && record.title.trim()
              ? record.title.trim()
              : name,
          description,
          parameters: Type.Unsafe(schema),
          async execute(_toolCallId, input) {
            const result = await connection.request("tools/call", {
              name: record.name,
              arguments: getRecord(input) || {},
              _meta: { astraflowSessionId: sessionId },
            })

            if (getRecord(result)?.isError === true) {
              throw new Error(toolResultToText(result))
            }

            return {
              content: [{ type: "text", text: toolResultToText(result) }],
              details: {
                serverName: server.name,
                serverId: server.serverId,
                result,
              },
            }
          },
        }

        // Preserve the convenient invocation surface used by runtime embedders
        // while the actual Agent integration uses Pi's execute contract.
        piTool.invoke = async (input) => {
          const result = await piTool.execute("direct-invoke", input)

          return result.content
            .filter((entry) => entry.type === "text")
            .map((entry) => entry.text)
            .join("\n")
        }

        tools.push(piTool)
      }
    } catch (error) {
      if (isAbortError(error, signal)) {
        await Promise.all(connections.map((connection) => connection.close()))
        throw error
      }

      const failure = {
        name: server.name,
        serverId: server.serverId,
        error: asErrorMessage(error),
      }

      failures.push(failure)
      console.warn("[astraflow-acp] desktop_mcp_connection_failed", failure)
    }
  }

  return {
    failures,
    tools,
    async close() {
      await Promise.all(connections.map((connection) => connection.close()))
    },
  }
}
