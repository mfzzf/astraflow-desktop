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

import type { AgentEvent } from "@/lib/agent/events"
import { enforceDesktopHostActionGateway } from "@/lib/agent/acp/host-tools"
import type { McpTransportConfig } from "@/lib/mcp"
import { createMcpTransport } from "@/lib/studio-mcp"
import type { StudioPermissionMode } from "@/lib/studio-types"

export const ACP_MCP_METHODS = {
  connect: "mcp/connect",
  message: "mcp/message",
  disconnect: "mcp/disconnect",
} as const

const ACP_MCP_CONNECTION_TIMEOUT_MS = 15_000
const ACP_MCP_REQUEST_TIMEOUT_MS = 60_000

type AcpMcpBridgeServerBase = {
  name: string
  serverId: string
  _meta?: Record<string, unknown> | null
  hostActionPolicy?: "generic" | "trusted_catalog" | "trusted_read_only"
}

export type AcpMcpBridgeHostContext = {
  emitEvent: (event: AgentEvent) => void
  getPermissionContext: () => {
    permissionMode: StudioPermissionMode
    projectId: string | null
  }
  sessionId: string
}

export type AcpMcpBridgeConnectionHandler = {
  request: (
    method: string,
    params: Record<string, unknown> | null,
    options: { signal?: AbortSignal }
  ) => Promise<unknown>
  notify?: (
    method: string,
    params: Record<string, unknown> | null,
    options: { signal?: AbortSignal }
  ) => Promise<void>
  close?: () => Promise<void>
}

export type AcpMcpBridgeServer =
  | (AcpMcpBridgeServerBase & {
      config: McpTransportConfig
      createConnection?: never
    })
  | (AcpMcpBridgeServerBase & {
      config?: never
      createConnection: (options: {
        agent: ClientContext
        hostContext?: AcpMcpBridgeHostContext
      }) => AcpMcpBridgeConnectionHandler | Promise<AcpMcpBridgeConnectionHandler>
    })

type AcpMcpBridgeConnection = {
  connectionId: string
  handler: AcpMcpBridgeConnectionHandler
  hostActionPolicy: "generic" | "trusted_catalog" | "trusted_read_only"
  hostContext?: AcpMcpBridgeHostContext
  serverId: string
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
    agent: ClientContext,
    hostContext?: AcpMcpBridgeHostContext
  ): Promise<ConnectMcpResponse> {
    const server = this.servers.get(params.serverId)

    if (!server) {
      throw new Error(`Unknown ACP MCP server: ${params.serverId}`)
    }

    const connectionId = randomUUID()

    if (server.createConnection) {
      const handler = await server.createConnection({ agent, hostContext })

      this.connections.set(connectionId, {
        connectionId,
        handler,
        hostActionPolicy: server.hostActionPolicy ?? "generic",
        hostContext,
        serverId: params.serverId,
      })

      return { connectionId }
    }

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

    try {
      await client.connect(transport, {
        timeout: ACP_MCP_CONNECTION_TIMEOUT_MS,
      })
    } catch (error) {
      console.warn("[studio-mcp] acp_bridge_connection_failed", {
        error: errorMessage(error),
        name: server.name,
        serverId: server.serverId,
      })
      await client.close().catch(() => undefined)
      throw error
    }

    this.connections.set(connectionId, {
      connectionId,
      handler: {
        request(method, requestParams, { signal }) {
          return client.request(
            {
              method,
              ...(requestParams ? { params: requestParams } : {}),
            },
            z.unknown(),
            {
              signal,
              timeout: ACP_MCP_REQUEST_TIMEOUT_MS,
            }
          )
        },
        async notify(method, requestParams) {
          await client.notification({
            method,
            ...(requestParams ? { params: requestParams } : {}),
          })
        },
        async close() {
          await client.close().catch(() => undefined)
        },
      },
      hostActionPolicy: server.hostActionPolicy ?? "generic",
      hostContext,
      serverId: params.serverId,
    })

    return { connectionId }
  }

  async request(
    params: MessageMcpRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<MessageMcpResponse> {
    const connection = this.connections.get(params.connectionId)

    if (!connection) {
      throw new Error(`Unknown ACP MCP connection: ${params.connectionId}`)
    }

    await this.enforceHostActionGateway(connection, params, options.signal)

    return connection.handler.request(params.method, params.params ?? null, {
      signal: options.signal,
    }) as Promise<MessageMcpResponse>
  }

  async notify(
    params: MessageMcpRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<void> {
    const connection = this.connections.get(params.connectionId)

    if (!connection) {
      throw new Error(`Unknown ACP MCP connection: ${params.connectionId}`)
    }

    await this.enforceHostActionGateway(connection, params, options.signal)

    await connection.handler.notify?.(params.method, params.params ?? null, {
      signal: options.signal,
    })
  }

  async disconnect(params: DisconnectMcpRequest): Promise<void> {
    const connection = this.connections.get(params.connectionId)

    if (!connection) {
      return
    }

    this.connections.delete(params.connectionId)
    await connection.handler.close?.().catch(() => undefined)
  }

  private async enforceHostActionGateway(
    connection: AcpMcpBridgeConnection,
    params: MessageMcpRequest,
    signal?: AbortSignal
  ) {
    if (
      params.method !== "tools/call" ||
      connection.hostActionPolicy !== "generic"
    ) {
      return
    }

    const request = getRecord(params.params)
    const name =
      typeof request?.name === "string" && request.name.trim()
        ? request.name.trim()
        : null

    if (!name) {
      throw new Error(
        "Desktop HostActionGateway blocked generic MCP tools/call without a tool name."
      )
    }

    await enforceDesktopHostActionGateway({
      args: {
        serverId: connection.serverId,
        arguments: getRecord(request?.arguments) ?? {},
      },
      hostContext: connection.hostContext,
      signal,
      toolName: name,
    })
  }

  async closeAll() {
    const connections = [...this.connections.values()]

    this.connections.clear()

    await Promise.all(
      connections.map((connection) =>
        connection.handler.close?.().catch(() => undefined)
      )
    )
  }
}
