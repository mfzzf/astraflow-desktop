import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getStudioSession } from "@/lib/studio-db"
import { resolveStudioFileMutationRoute } from "@/lib/studio-file-mutation-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ sessionId: string; blobId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const params = await context.params
  const sessionId = decodeURIComponent(params.sessionId)
  const searchParams = new URL(request.url).searchParams
  const result = resolveStudioFileMutationRoute({
    sessionId,
    blobId: decodeURIComponent(params.blobId),
    path: searchParams.get("path"),
    revision: searchParams.get("revision"),
    sessionExists: (candidateSessionId) =>
      Boolean(getStudioSession(candidateSessionId)),
  })

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.status }
    )
  }

  const mutation = result.mutation

  return NextResponse.json(
    {
      ok: true,
      data: {
        id: mutation.id,
        path: mutation.path,
        revision: mutation.revision,
        previousRevision: mutation.previousRevision,
        diff: mutation.diff,
        expiresAt: new Date(mutation.expiresAt).toISOString(),
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-store",
      },
    }
  )
}
