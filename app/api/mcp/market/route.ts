import { NextResponse } from "next/server"

import {
  mcpTransportTypes,
  normalizeMcpRegistryServerEntry,
  type McpRegistryServer,
  type McpTransportType,
} from "@/lib/mcp"

export const runtime = "nodejs"

const MCP_REGISTRY_SERVERS_URL =
  "https://registry.modelcontextprotocol.io/v0.1/servers"
const DEFAULT_LIMIT = 24
const MAX_LIMIT = 100

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readInt(value: string | null, fallback: number, max: number) {
  const parsed = Number.parseInt(value ?? "", 10)

  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, 0), max)
}

function readTransport(value: string) {
  return (mcpTransportTypes as readonly string[]).includes(value)
    ? (value as McpTransportType)
    : ""
}

function readRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

function filterRegistryServers({
  servers,
  status,
  transport,
}: {
  servers: McpRegistryServer[]
  status: string
  transport: McpTransportType | ""
}) {
  const normalizedStatus = status.trim().toLowerCase()

  return servers.filter((server) => {
    if (transport && !server.transports.includes(transport)) {
      return false
    }

    if (normalizedStatus && server.status.toLowerCase() !== normalizedStatus) {
      return false
    }

    return true
  })
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    const keyword = readString(searchParams.get("keyword"))
    const status = readString(searchParams.get("status"))
    const transport = readTransport(readString(searchParams.get("transport")))
    const cursor = readString(searchParams.get("cursor"))
    const version = readString(searchParams.get("version")) || "latest"
    const limit = readInt(searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT)
    const registryUrl = new URL(MCP_REGISTRY_SERVERS_URL)

    registryUrl.searchParams.set("limit", String(limit))
    registryUrl.searchParams.set("version", version)

    if (cursor) {
      registryUrl.searchParams.set("cursor", cursor)
    }

    if (keyword) {
      registryUrl.searchParams.set("search", keyword)
    }

    const response = await fetch(registryUrl, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    })

    if (!response.ok) {
      throw new Error(`MCP registry request failed with HTTP ${response.status}.`)
    }

    const payload = readRecord(await response.json())
    const metadata = readRecord(payload.metadata)
    const servers = Array.isArray(payload.servers)
      ? payload.servers
          .map((entry) => normalizeMcpRegistryServerEntry(entry))
          .filter((entry) => entry !== null)
      : []
    const filtered = filterRegistryServers({
      servers,
      status,
      transport,
    })

    return NextResponse.json({
      ok: true,
      data: filtered,
      totalCount: filtered.length,
      nextCursor: readString(metadata.nextCursor) || null,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error ? error.message : "Failed to load MCP market.",
      },
      { status: 400 }
    )
  }
}
