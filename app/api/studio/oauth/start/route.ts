import { NextResponse } from "next/server"

import { startUCloudOAuthFlow } from "@/lib/ucloud-oauth"

export const runtime = "nodejs"

export async function POST() {
  try {
    return NextResponse.json({
      ok: true,
      data: await startUCloudOAuthFlow(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to start UCloud OAuth.",
      },
      { status: 500 }
    )
  }
}
