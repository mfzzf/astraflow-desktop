import { NextResponse } from "next/server"

import { getAppRuntimeIdleState } from "@/lib/app-runtime-idle"
import { getStudioDatabase } from "@/lib/studio-db"

export const runtime = "nodejs"

export async function GET() {
  return NextResponse.json({
    ok: true,
    data: getAppRuntimeIdleState(getStudioDatabase()),
  })
}
