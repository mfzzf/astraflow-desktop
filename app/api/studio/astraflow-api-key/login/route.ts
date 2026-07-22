import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import { validateModelverseApiKey } from "@/lib/modelverse-api-keys"
import {
  createManualStudioModelverseApiKeyRecord,
  saveStudioAstraFlowApiKeySession,
  saveStudioModelverseApiKey,
} from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)

  if (originError) {
    return originError
  }

  try {
    const body = (await request.json()) as { apiKey?: unknown }
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : ""

    await validateModelverseApiKey(apiKey)
    saveStudioModelverseApiKey(createManualStudioModelverseApiKeyRecord(apiKey))
    saveStudioAstraFlowApiKeySession()

    return NextResponse.json({
      ok: true,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to validate this CompShare API key.",
      },
      { status: 401 }
    )
  }
}
