import { NextResponse } from "next/server"

import { pollCodeBoxGithubDeviceFlow } from "@/lib/codebox-github"
import { syncCodeBoxCredentialsToRunningSandboxes } from "@/lib/codebox-runtime"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{
    flowId: string
  }>
}

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

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { flowId } = await context.params
    const result = await pollCodeBoxGithubDeviceFlow(flowId)

    if (result.status === "complete") {
      await syncCodeBoxCredentialsToRunningSandboxes().catch((error) => {
        console.error("Failed to scrub legacy CodeBox credentials.", error)
      })
    }

    return NextResponse.json({
      ok: true,
      data: result,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
