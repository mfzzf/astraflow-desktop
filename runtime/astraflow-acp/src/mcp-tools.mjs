import { Type } from "@earendil-works/pi-ai"
import { RequestError } from "@agentclientprotocol/sdk"
import { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js"
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js"
import path from "node:path"

import hostToolsManifest from "../host-tools-manifest.json" with {
  type: "json",
}
import {
  ASTRAFLOW_ACP_BUILTIN_TOOL_NAMES,
  ASTRAFLOW_ACP_RUNTIME_VERSION,
  asErrorMessage,
  getRecord,
  stringify,
} from "./constants.mjs"

const MCP_METHODS = {
  connect: "mcp/connect",
  message: "mcp/message",
  disconnect: "mcp/disconnect",
}
const ASTRAFLOW_DESKTOP_HOST_TOOLS_SERVER_ID =
  hostToolsManifest.server.serverId
const ASTRAFLOW_DESKTOP_HOST_TOOLS_SERVER_NAME =
  hostToolsManifest.server.name
const ASTRAFLOW_DESKTOP_HOST_SERVER_IDENTITIES = new Set([
  `${ASTRAFLOW_DESKTOP_HOST_TOOLS_SERVER_ID}\0${ASTRAFLOW_DESKTOP_HOST_TOOLS_SERVER_NAME}`,
  "astraflow:environment\0astraflow_environment",
  "astraflow:skills\0astraflow_skills",
])

function isTrustedDesktopHostToolServer(server) {
  return (
    isAcpMcpServer(server) &&
    ASTRAFLOW_DESKTOP_HOST_SERVER_IDENTITIES.has(
      `${server.serverId}\0${server.name}`
    )
  )
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

function mcpToolEffectCategory(descriptor, trustedDescriptor) {
  if (!trustedDescriptor) {
    return "important_action"
  }

  const record = getRecord(descriptor)
  const astraflow = getRecord(getRecord(record?._meta)?.astraflow)
  const declared = astraflow?.effectCategory

  if (
    declared === "read_only" ||
    declared === "workspace_internal" ||
    declared === "important_action"
  ) {
    return declared
  }

  if (getRecord(record?.annotations)?.readOnlyHint === true) {
    return "read_only"
  }

  // Trusted first-party descriptors still fail closed when their catalog does
  // not classify a tool.
  return "important_action"
}

function mcpToolAllowedInSubagent(descriptor, trustedDescriptor) {
  if (!trustedDescriptor) {
    return false
  }

  const record = getRecord(descriptor)
  const astraflow = getRecord(getRecord(record?._meta)?.astraflow)

  if (typeof astraflow?.allowInSubagent === "boolean") {
    return astraflow.allowInSubagent
  }

  // Only the trusted first-party catalog can opt a tool into subagents.
  return getRecord(record?.annotations)?.readOnlyHint === true
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

function stdioEnvironment(entries) {
  return {
    ...getDefaultEnvironment(),
    ...Object.fromEntries(entries.map((entry) => [entry.name, entry.value])),
  }
}

async function connectStdioMcpServer({ cwd, server, signal }) {
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args,
    env: stdioEnvironment(server.env),
    cwd,
    stderr: "pipe",
  })
  const mcpClient = new McpClient({
    name: "astraflow-acp",
    version: ASTRAFLOW_ACP_RUNTIME_VERSION,
  })
  transport.stderr?.resume()
  const close = async () => {
    await mcpClient.close().catch(() => undefined)
  }

  try {
    await mcpClient.connect(transport, { signal })
    const listed = await mcpClient.listTools(undefined, { signal })

    return {
      connectionId: null,
      server,
      tools: listed.tools,
      request(method, params = {}) {
        if (method === "tools/call") {
          return mcpClient.callTool(params, undefined, { signal })
        }

        throw new Error(`Unsupported stdio MCP request: ${method}`)
      },
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}

function isAcpMcpServer(server) {
  return (
    server?.type === "acp" &&
    typeof server.name === "string" &&
    typeof server.serverId === "string"
  )
}

function isStdioMcpServer(server) {
  return (
    server?.type === undefined &&
    typeof server.name === "string" &&
    typeof server.command === "string" &&
    path.isAbsolute(server.command) &&
    Array.isArray(server.args) &&
    server.args.every((arg) => typeof arg === "string") &&
    Array.isArray(server.env) &&
    server.env.every(
      (entry) =>
        typeof entry?.name === "string" &&
        entry.name.length > 0 &&
        typeof entry.value === "string"
    )
  )
}

export function assertSupportedMcpServers(mcpServers) {
  for (const server of mcpServers) {
    if (isAcpMcpServer(server) || isStdioMcpServer(server)) {
      continue
    }

    const name =
      typeof server?.name === "string" && server.name.trim()
        ? server.name.trim()
        : "unnamed"
    const transport =
      typeof server?.type === "string" ? server.type : "invalid stdio"

    throw RequestError.invalidParams(
      undefined,
      `Unsupported MCP server ${name}: ${transport}. AstraFlow Agent supports stdio and advertised ACP transports.`
    )
  }
}

export function formatMcpConnectionFailures(failures) {
  if (!Array.isArray(failures) || failures.length === 0) {
    return ""
  }

  const names = [
    ...new Set(
      failures
        .map((failure) =>
          typeof failure?.name === "string" ? failure.name.trim() : ""
        )
        .filter(Boolean)
    ),
  ]

  return [
    "\n\n<unavailable_mcp_connectors>",
    "The following configured MCP connectors failed to connect for this turn:",
    ...names.map((name) => `- ${name}`),
    "Do not claim to have used these connectors. If the request depends on one, tell the user it is unavailable and continue with any safe fallback.",
    "</unavailable_mcp_connectors>",
  ].join("\n")
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
  cwd = process.cwd(),
  mcpServers,
  sessionId,
  signal,
}) {
  assertSupportedMcpServers(mcpServers)
  const connections = []
  const failures = []
  const tools = []
  const usedNames = new Set()

  for (const server of mcpServers) {
    try {
      const connection = isAcpMcpServer(server)
        ? await connectAcpMcpServer({ client, server, signal })
        : await connectStdioMcpServer({ cwd, server, signal })

      connections.push(connection)

      for (const descriptor of connection.tools) {
        const record = getRecord(descriptor)
        const trustedDescriptor = isTrustedDesktopHostToolServer(server)

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
          astraflowAllowInSubagent: mcpToolAllowedInSubagent(
            record,
            trustedDescriptor
          ),
          astraflowEffectCategory: mcpToolEffectCategory(
            record,
            trustedDescriptor
          ),
          astraflowHostActionEnforced: isAcpMcpServer(server),
          async execute(_toolCallId, input) {
            const result = await connection.request("tools/call", {
              name: record.name,
              arguments: getRecord(input) || {},
              _meta: { astraflowSessionId: sessionId },
            })

            const isError = getRecord(result)?.isError === true

            return {
              content: [{ type: "text", text: toolResultToText(result) }],
              details: {
                serverName: server.name,
                serverId: server.serverId,
                result,
                mcpIsError: isError,
                structuredContent:
                  getRecord(result)?.structuredContent || null,
                meta: getRecord(result)?._meta || null,
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

      const acpTransport = isAcpMcpServer(server)
      const failure = acpTransport
        ? {
            name: server.name,
            serverId: server.serverId,
            error: asErrorMessage(error),
          }
        : {
            name: server.name,
            command: server.command,
            transport: "stdio",
            error: asErrorMessage(error),
          }

      failures.push(failure)
      console.warn(
        acpTransport
          ? "[astraflow-acp] desktop_mcp_connection_failed"
          : "[astraflow-acp] stdio_mcp_connection_failed",
        failure
      )
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
