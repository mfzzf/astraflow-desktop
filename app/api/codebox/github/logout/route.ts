import { NextResponse } from "next/server"

import { logoutCodeBoxGithub } from "@/lib/codebox-github"
import { syncCodeBoxCredentialsToRunningSandboxes } from "@/lib/codebox-runtime"
import { getCodeBoxGithubStatus } from "@/lib/studio-db"

export const runtime = "nodejs"

export async function POST() {
  logoutCodeBoxGithub()
  await syncCodeBoxCredentialsToRunningSandboxes().catch((error) => {
    console.error("Failed to scrub legacy CodeBox credentials.", error)
  })

  return NextResponse.json({
    ok: true,
    data: getCodeBoxGithubStatus(),
  })
}
