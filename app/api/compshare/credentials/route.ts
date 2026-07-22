import { NextResponse } from "next/server"

import { requireSameOriginRequest } from "@/lib/app-auth"
import { isCompShareChannel } from "@/lib/compshare/config"
import {
  callCompShareAction,
  CompShareApiError,
} from "@/lib/compshare/control-plane"
import {
  getCompShareCredentialStatus,
  saveCompShareCredentials,
} from "@/lib/studio-db"

export const runtime = "nodejs"

type ListOpenAPIPlansValidationResponse = {
  RetCode: number
}

function unavailableResponse() {
  return NextResponse.json(
    {
      ok: false,
      message: "CompShare credentials are unavailable on this channel.",
    },
    { status: 404 }
  )
}

export async function GET() {
  if (!isCompShareChannel()) {
    return unavailableResponse()
  }

  return NextResponse.json({
    ok: true,
    data: getCompShareCredentialStatus(),
  })
}

export async function POST(request: Request) {
  const originError = requireSameOriginRequest(request)
  if (originError) {
    return originError
  }
  if (!isCompShareChannel()) {
    return unavailableResponse()
  }

  try {
    const body = (await request.json()) as unknown
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new CompShareApiError("PublicKey and PrivateKey are required.", {
        status: 400,
      })
    }

    const input = body as Record<string, unknown>
    const unsupportedFields = Object.keys(input).filter(
      (key) => key !== "publicKey" && key !== "privateKey"
    )
    if (unsupportedFields.length > 0) {
      throw new CompShareApiError(
        "Only PublicKey and PrivateKey may be configured.",
        { status: 400 }
      )
    }
    const publicKey =
      typeof input.publicKey === "string" ? input.publicKey.trim() : ""
    const privateKey =
      typeof input.privateKey === "string" ? input.privateKey.trim() : ""
    if (!publicKey || !privateKey) {
      throw new CompShareApiError("PublicKey and PrivateKey are required.", {
        status: 400,
      })
    }

    await callCompShareAction<ListOpenAPIPlansValidationResponse>({
      credentials: { publicKey, privateKey },
      params: { Action: "ListOpenAPIPlans" },
    })
    const status = saveCompShareCredentials({ publicKey, privateKey })

    return NextResponse.json({ ok: true, data: status })
  } catch (error) {
    const message =
      error instanceof CompShareApiError
        ? error.message
        : "Unable to validate CompShare credentials."
    const status =
      error instanceof CompShareApiError && error.status >= 400
        ? Math.min(error.status, 599)
        : 400

    return NextResponse.json({ ok: false, message }, { status })
  }
}
