import { NextResponse } from "next/server"

import { installedMcpServerSchema } from "@/lib/mcp"
import {
  listStudioMcpServers,
  upsertStudioMcpServer,
} from "@/lib/studio-db"

export const runtime = "nodejs"

function toErrorResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to manage installed MCP servers.",
    },
    { status: 400 }
  )
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    data: listStudioMcpServers(),
  })
}

export async function POST(request: Request) {
  try {
    const body = installedMcpServerSchema.parse(await request.json())
    const installed = upsertStudioMcpServer({
      id: body.id,
      name: body.name,
      title: body.title,
      description: body.description,
      source: body.source,
      registryName: body.registryName,
      registryVersion: body.registryVersion,
      enabled: body.enabled,
      config: body.config,
    })

    if (!installed) {
      throw new Error("Failed to save MCP server.")
    }

    return NextResponse.json({
      ok: true,
      data: installed,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
