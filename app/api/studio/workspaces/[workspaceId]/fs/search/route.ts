import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  getCodeBoxSandboxReadableFileInfo,
  searchCodeBoxSandboxFiles,
} from "@/lib/codebox-runtime"
import {
  fetchStudioWorkspaceGateway,
  getStudioWorkspaceGatewayErrorStatus,
  requireStudioSandboxWorkspace,
  toStudioGatewayRelativePath,
  toStudioGatewayAbsolutePath,
} from "@/lib/studio-workspace-gateway"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ workspaceId: string }>
}

type GatewaySearchPayload = {
  ok?: boolean
  data?: { path: string | null; candidates: string[] }
  error?: { code?: string; message?: string }
}

export async function GET(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  try {
    const { workspaceId } = await context.params
    const workspace = requireStudioSandboxWorkspace(
      decodeURIComponent(workspaceId)
    )
    const reference = new URL(request.url).searchParams.get("reference")?.trim()

    if (!reference) {
      return NextResponse.json(
        { ok: false, message: "File reference is required." },
        { status: 400 }
      )
    }

    if (reference.startsWith("/")) {
      try {
        toStudioGatewayRelativePath(workspace, reference)
      } catch {
        try {
          await getCodeBoxSandboxReadableFileInfo({
            sandboxId: workspace.sandboxId,
            gatewayRoot: workspace.gatewayRoot,
            path: reference,
          })

          return NextResponse.json({
            ok: true,
            data: { path: reference, candidates: [reference] },
          })
        } catch {
          // The stale external path may still be repairable by basename below.
        }
      }
    }

    const search = new URLSearchParams({ reference })
    let upstream: Response | null = null
    let payload: GatewaySearchPayload | null = null

    try {
      upstream = await fetchStudioWorkspaceGateway({
        workspace,
        path: `/v1/fs/search?${search}`,
        init: {
          signal: AbortSignal.any([
            request.signal,
            AbortSignal.timeout(30_000),
          ]),
        },
      })
      payload = (await upstream.json().catch(() => null)) as
        | GatewaySearchPayload
        | null
    } catch (error) {
      if (request.signal.aborted) {
        throw error
      }

      // A timed-out or unavailable native search still has the owned Sandbox
      // command fallback below.
    }

    if (
      upstream?.ok &&
      payload?.ok &&
      payload.data &&
      (payload.data.path || payload.data.candidates.length > 0)
    ) {
      return NextResponse.json({
        ok: true,
        data: {
          path: payload.data.path
            ? toStudioGatewayAbsolutePath(workspace, payload.data.path)
            : null,
          candidates: payload.data.candidates.map((path) =>
            toStudioGatewayAbsolutePath(workspace, path)
          ),
        },
      })
    }

    // Older Gateway runtimes do not expose fs.search/includeHidden. Use the
    // owned Sandbox command channel as a compatibility index so hidden files,
    // deep generated outputs, and conventional external output roots remain
    // discoverable without requiring the Sandbox to be recreated.
    const fallback = await searchCodeBoxSandboxFiles({
      sandboxId: workspace.sandboxId,
      gatewayRoot: workspace.gatewayRoot,
      reference,
    })

    return NextResponse.json({
      ok: true,
      data: fallback,
    })
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Sandbox workspace is unavailable.",
      },
      { status: getStudioWorkspaceGatewayErrorStatus(error) }
    )
  }
}
