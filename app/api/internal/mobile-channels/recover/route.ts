import { timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { recoverMobileChannels } from "@/lib/mobile-channels/runtime"

export const runtime = "nodejs"

function validRecoveryToken(request: Request) {
  const expected = process.env.ASTRAFLOW_INTERNAL_RECOVERY_TOKEN
  const actual = request.headers.get("x-astraflow-recovery-token")

  if (!expected || !actual) {
    return false
  }

  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)

  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  )
}

export async function POST(request: Request) {
  if (!validRecoveryToken(request)) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as {
    reason?: unknown
  } | null
  const reason =
    typeof body?.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 80)
      : "electron-resume"
  void recoverMobileChannels({ forceReconnect: true, reason }).catch(
    (error) => {
      console.error("[mobile-channels] electron_recovery_failed", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  )

  return NextResponse.json(
    { ok: true, data: { accepted: true, reason } },
    { status: 202 }
  )
}
