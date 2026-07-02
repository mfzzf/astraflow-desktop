import { NextResponse } from "next/server"

import { startCodeBoxGithubDeviceFlow } from "@/lib/codebox-github"

export const runtime = "nodejs"

function toErrorResponse(error: unknown) {
  return NextResponse.json(
    {
      ok: false,
      message:
        error instanceof Error ? error.message : "GitHub authorization failed.",
    },
    { status: error instanceof Error ? 400 : 500 }
  )
}

export async function POST() {
  try {
    return NextResponse.json({
      ok: true,
      data: await startCodeBoxGithubDeviceFlow(),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
