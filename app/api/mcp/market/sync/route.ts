import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      message: "MCP market sync is disabled. Use GET /api/mcp/market instead.",
    },
    { status: 410 }
  )
}
