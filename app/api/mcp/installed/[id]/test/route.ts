import { NextResponse } from "next/server"

import {
  getStudioMcpServer,
  updateStudioMcpServerConnectionError,
  updateStudioMcpServerDiscovery,
} from "@/lib/studio-db"
import { discoverMcpServer } from "@/lib/studio-mcp"

export const runtime = "nodejs"

type InstalledMcpTestRouteContext = {
  params: Promise<{
    id: string
  }>
}

async function readId(context: InstalledMcpTestRouteContext) {
  const { id } = await context.params
  const normalizedId = decodeURIComponent(id).trim()

  if (!normalizedId) {
    throw new Error("MCP server id is required.")
  }

  return normalizedId
}

export async function POST(
  _request: Request,
  context: InstalledMcpTestRouteContext
) {
  let id = ""

  try {
    id = await readId(context)
    const installed = getStudioMcpServer(id, { includeSecrets: true })

    if (!installed) {
      return NextResponse.json(
        { ok: false, message: "MCP server was not found." },
        { status: 404 }
      )
    }

    const discovery = await discoverMcpServer(installed.config)
    const updated = updateStudioMcpServerDiscovery({
      id,
      capabilities: discovery.capabilities,
      tools: discovery.tools,
      resources: discovery.resources,
      prompts: discovery.prompts,
      lastConnectedAt: new Date().toISOString(),
      lastError: null,
    })

    if (!updated) {
      throw new Error("Failed to refresh MCP server discovery.")
    }

    return NextResponse.json({
      ok: true,
      data: updated,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to test MCP server."
    const updated = id ? updateStudioMcpServerConnectionError(id, message) : null

    return NextResponse.json(
      {
        ok: false,
        message,
        ...(updated ? { data: updated } : {}),
      },
      { status: 400 }
    )
  }
}
