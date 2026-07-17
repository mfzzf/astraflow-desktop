import { NextResponse } from "next/server"

import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import { marketplaceServiceGetMcpDetail } from "@/lib/generated/astraflow-api"
import { toMcpRegistryServer } from "@/lib/marketplace-mappers"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const name = new URL(request.url).searchParams.get("name")?.trim()
    if (!name) {
      return NextResponse.json(
        { ok: false, message: "MCP server name is required." },
        { status: 400 }
      )
    }

    const result = await marketplaceServiceGetMcpDetail({ query: { name } })
    const payload = unwrapAstraFlowApiResult(
      result,
      "Failed to load MCP server detail."
    )
    const serverJson = JSON.parse(payload.serverJson ?? "{}") as unknown
    if (
      typeof serverJson !== "object" ||
      serverJson === null ||
      Array.isArray(serverJson)
    ) {
      throw new Error("MCP server manifest must be a JSON object.")
    }
    const data = toMcpRegistryServer(
      payload.mcp ?? {},
      serverJson as Record<string, unknown>
    )
    if (!data) {
      throw new Error("MCP server detail is missing its name.")
    }

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    const status = error instanceof AstraFlowApiError ? error.status : 400
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Failed to load MCP server detail.",
      },
      { status }
    )
  }
}
