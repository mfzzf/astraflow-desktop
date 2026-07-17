import { NextResponse } from "next/server"

import {
  AstraFlowApiError,
  unwrapAstraFlowApiResult,
} from "@/lib/astraflow-api"
import { marketplaceServiceGetMcpServerManifest } from "@/lib/generated/astraflow-api"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const serverJsonUrl = new URL(request.url).searchParams.get("url")?.trim()
    if (!serverJsonUrl) {
      return NextResponse.json(
        { ok: false, message: "MCP server manifest URL is required." },
        { status: 400 }
      )
    }
    const result = await marketplaceServiceGetMcpServerManifest({
      query: { serverJsonUrl },
    })
    const payload = unwrapAstraFlowApiResult(
      result,
      "Failed to load MCP server manifest."
    )
    const data = JSON.parse(payload.serverJson ?? "{}") as unknown
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error("MCP server manifest must be a JSON object.")
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
            : "Failed to load MCP server manifest.",
      },
      { status }
    )
  }
}
