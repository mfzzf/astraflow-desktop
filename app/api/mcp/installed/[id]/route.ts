import { NextResponse } from "next/server"

import { patchInstalledMcpServerSchema } from "@/lib/mcp"
import {
  deleteStudioMcpServer,
  getStudioMcpServer,
  updateStudioMcpServer,
  updateStudioMcpServerEnabled,
} from "@/lib/studio-db"

export const runtime = "nodejs"

type InstalledMcpRouteContext = {
  params: Promise<{
    id: string
  }>
}

function toErrorResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      message:
        error instanceof Error ? error.message : "Failed to manage MCP server.",
    },
    { status: 400 }
  )
}

async function readId(context: InstalledMcpRouteContext) {
  const { id } = await context.params
  const normalizedId = decodeURIComponent(id).trim()

  if (!normalizedId) {
    throw new Error("MCP server id is required.")
  }

  return normalizedId
}

export async function GET(
  _request: Request,
  context: InstalledMcpRouteContext
) {
  try {
    const id = await readId(context)
    const installed = getStudioMcpServer(id)

    if (!installed) {
      return NextResponse.json(
        { ok: false, message: "MCP server was not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: installed,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(
  request: Request,
  context: InstalledMcpRouteContext
) {
  try {
    const id = await readId(context)
    const body = patchInstalledMcpServerSchema.parse(await request.json())
    const installed =
      Object.keys(body).length === 1 && body.enabled !== undefined
        ? updateStudioMcpServerEnabled(id, body.enabled)
        : updateStudioMcpServer(id, {
            name: body.name,
            title: body.title,
            description: body.description,
            enabled: body.enabled,
            config: body.config,
          })

    if (!installed) {
      return NextResponse.json(
        { ok: false, message: "MCP server was not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: installed,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(
  _request: Request,
  context: InstalledMcpRouteContext
) {
  try {
    const id = await readId(context)

    if (!deleteStudioMcpServer(id)) {
      return NextResponse.json(
        { ok: false, message: "MCP server was not found." },
        { status: 404 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
