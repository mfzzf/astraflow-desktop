import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getStudioSession, listStudioMessages } from "@/lib/studio-db"
import { createContentDispositionValue } from "@/lib/studio-file-response"
import {
  createStudioSessionMarkdown,
  createStudioSessionMarkdownFilename,
} from "@/lib/studio-session-markdown"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{ sessionId: string }>
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const { sessionId } = await context.params
  const session = getStudioSession(sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  const markdown = createStudioSessionMarkdown(
    session,
    listStudioMessages(sessionId)
  )

  return new Response(markdown, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": createContentDispositionValue(
        "attachment",
        createStudioSessionMarkdownFilename(session.title)
      ),
      "Content-Type": "text/markdown; charset=utf-8",
    },
  })
}
