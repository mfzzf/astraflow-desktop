import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  return NextResponse.json(
    {
      ok: false,
      code: "REMOTE_WORKSPACE_CREATION_RETIRED",
      message:
        "Choose an existing Code Sandbox and folder through /api/studio/workspaces.",
    },
    { status: 409 }
  )
}
