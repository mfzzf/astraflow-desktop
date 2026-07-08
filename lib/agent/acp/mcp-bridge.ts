import {
  type ClientContext,
  type ConnectMcpRequest,
  type ConnectMcpResponse,
  type DisconnectMcpRequest,
  type MessageMcpNotification,
  type MessageMcpRequest,
  type MessageMcpResponse,
  type McpServer,
} from "@agentclientprotocol/sdk"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { randomUUID } from "node:crypto"
import { z } from "zod"

import type { McpTransportConfig } from "@/lib/mcp"
import { createMcpTransport } from "@/lib/studio-mcp"

export const ACP_MCP_METHODS = {
  connect: "mcp/connect",
  message: "mcp/message",
  disconnect: "mcp/disconnect",
} as const

const ACP_MCP_CONNECTION_TIMEOUT_MS = 15_000
const ACP_MCP_REQUEST_TIMEOUT_MS = 60_000

export type AcpMcpBridgeServer = {
  name: string
  serverId: string
  config: McpTransportConfig
  _meta?: Record<string, unknown> | null
}

type AcpMcpBridgeConnection = {
  client: Client
  connectionId: string
  serverId: string
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getStringRecord(value: unknown) {
  const record = getRecord(value)

  if (!record) {
    return null
  }

  return record
}

function getMeta(value: unknown) {
  return getRecord(value)
}

function assertRecord(value: unknown, method: string) {
  const record = getRecord(value)

  if (!record) {
    throw new Error(`${method} params must be an object.`)
  }

  return record
}

export const connectMcpRequestParser = {
  parse(value: unknown): ConnectMcpRequest {
    const record = assertRecord(value, ACP_MCP_METHODS.connect)
    const serverId = record.serverId

    if (typeof serverId !== "string" || !serverId.trim()) {
      throw new Error("mcp/connect requires a serverId.")
    }

    const meta = getMeta(record._meta)

    return {
      serverId,
      ...(meta ? { _meta: meta } : {}),
    }
  },
}

export const messageMcpRequestParser = {
  parse(value: unknown): MessageMcpRequest {
    const record = assertRecord(value, ACP_MCP_METHODS.message)
    const connectionId = record.connectionId
    const method = record.method

    if (typeof connectionId !== "string" || !connectionId.trim()) {
      throw new Error("mcp/message requires a connectionId.")
    }

    if (typeof method !== "string" || !method.trim()) {
      throw new Error("mcp/message requires an inner MCP method.")
    }

    const meta = getMeta(record._meta)

    return {
      connectionId,
      method,
      params: getStringRecord(record.params),
      ...(meta ? { _meta: meta } : {}),
    }
  },
}

export const disconnectMcpRequestParser = {
  parse(value: unknown): DisconnectMcpRequest {
    const record = assertRecord(value, ACP_MCP_METHODS.disconnect)
    const connectionId = record.connectionId

    if (typeof connectionId !== "string" || !connectionId.trim()) {
      throw new Error("mcp/disconnect requires a connectionId.")
    }

    const meta = getMeta(record._meta)

    return {
      connectionId,
      ...(meta ? { _meta: meta } : {}),
    }
  },
}

function normalizeMcpParams(params: unknown) {
  if (params === undefined || params === null) {
    return null
  }

  return getRecord(params) ?? { value: params }
}

function createMcpClient() {
  return new Client(
    {
      name: "astraflow-desktop-acp-bridge",
      version: "1.0.0",
    },
    {
      capabilities: {},
    }
  )
}

export class AcpMcpBridge {
  private readonly servers = new Map<string, AcpMcpBridgeServer>()
  private readonly connections = new Map<string, AcpMcpBridgeConnection>()

  constructor(servers: AcpMcpBridgeServer[]) {
    for (const server of servers) {
      this.servers.set(server.serverId, server)
    }
  }

  get size() {
    return this.servers.size
  }

  toAcpMcpServers(): McpServer[] {
    return Array.from(this.servers.values()).map((server) => ({
      type: "acp" as const,
      name: server.name,
      serverId: server.serverId,
      ...(server._meta ? { _meta: server._meta } : {}),
    }))
  }

  async connect(
    params: ConnectMcpRequest,
    agent: ClientContext
  ): Promise<ConnectMcpResponse> {
    const server = this.servers.get(params.serverId)

    if (!server) {
      throw new Error(`Unknown ACP MCP server: ${params.serverId}`)
    }

    const connectionId = randomUUID()
    const client = createMcpClient()

    client.fallbackNotificationHandler = async (notification) => {
      await agent.notify<MessageMcpNotification>(ACP_MCP_METHODS.message, {
        connectionId,
        method: notification.method,
        params: normalizeMcpParams(notification.params),
      })
    }
    client.fallbackRequestHandler = async (request) => {
      const response = await agent.request<MessageMcpResponse, MessageMcpRequest>(
        ACP_MCP_METHODS.message,
        {
          connectionId,
          method: request.method,
          params: normalizeMcpParams(request.params),
        }
      )

      return (getRecord(response) ?? {}) as never
    }
    client.onclose = () => {
      this.connections.delete(connectionId)
    }

    const transport = createMcpTransport(server.config)

    await client.connect(transport, { timeout: ACP_MCP_CONNECTION_TIMEOUT_MS })

    this.connections.set(connectionId, {
      client,
      connectionId,
      serverId: params.serverId,
    })

    return { connectionId }
  }

  async request(params: MessageMcpRequest): Promise<MessageMcpResponse> {
    const connection = this.connections.get(params.connectionId)

    if (!connection) {
      throw new Error(`Unknown ACP MCP connection: ${params.connectionId}`)
    }

    return connection.client.request(
      {
        method: params.method,
        ...(params.params ? { params: params.params } : {}),
      },
      z.unknown(),
      { timeout: ACP_MCP_REQUEST_TIMEOUT_MS }
    )
  }

  async notify(params: MessageMcpRequest): Promise<void> {
    const connection = this.connections.get(params.connectionId)

    if (!connection) {
      throw new Error(`Unknown ACP MCP connection: ${params.connectionId}`)
    }

    await connection.client.notification({
      method: params.method,
      ...(params.params ? { params: params.params } : {}),
    })
  }

  async disconnect(params: DisconnectMcpRequest): Promise<void> {
    const connection = this.connections.get(params.connectionId)

    if (!connection) {
      return
    }

    this.connections.delete(params.connectionId)
    await connection.client.close().catch(() => undefined)
  }

  async closeAll() {
    const connections = [...this.connections.values()]

    this.connections.clear()

    await Promise.all(
      connections.map((connection) =>
        connection.client.close().catch(() => undefined)
      )
    )
  }
}
