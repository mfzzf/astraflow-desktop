import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { validateModelverseApiKey } from "@/lib/modelverse-api-keys"
import {
  createManualStudioModelverseApiKeyRecord,
  getStudioAstraFlowApiKeyStatus,
  saveStudioAstraFlowApiKeySession,
  saveStudioModelverseApiKey,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function GET(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  return NextResponse.json({
    ok: true,
    data: getStudioAstraFlowApiKeyStatus(),
  })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const body = (await request.json()) as { apiKey?: unknown }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : ""

    await validateModelverseApiKey(apiKey)
    saveStudioModelverseApiKey(createManualStudioModelverseApiKeyRecord(apiKey))
    saveStudioAstraFlowApiKeySession()

    return NextResponse.json({
      ok: true,
      data: getStudioAstraFlowApiKeyStatus(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to validate this CompShare API Key.",
      },
      { status: 400 }
    )
  }
}
