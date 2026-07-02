import { NextResponse } from "next/server"

import { logoutCodeBoxGithub } from "@/lib/codebox-github"
import { getCodeBoxGithubStatus } from "@/lib/studio-db"

export const runtime = "nodejs"

export async function GET() {
  return NextResponse.json({
    ok: true,
    data: getCodeBoxGithubStatus(),
  })
}

export async function DELETE() {
  logoutCodeBoxGithub()

  return NextResponse.json({
    ok: true,
    data: getCodeBoxGithubStatus(),
  })
}
