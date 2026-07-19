import { NextResponse } from "next/server"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  getCodeBoxSandboxReadableFileInfo,
  materializeCodeBoxSandboxReadableFile,
} from "@/lib/codebox-runtime"
import {
  fetchStudioWorkspaceGateway,
  getStudioWorkspaceGatewayErrorStatus,
  requireStudioSandboxWorkspace,
  toStudioGatewayRelativePath,
} from "@/lib/studio-workspace-gateway"
import { createContentDispositionValue } from "@/lib/studio-file-response"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteContext = {
  params: Promise<{ workspaceId: string }>
}

const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "cache-control",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
] as const

async function proxyFile(request: Request, context: RouteContext) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const requestUrl = new URL(request.url)
  const requestedPath = requestUrl.searchParams.get("path")
  const download = requestUrl.searchParams.get("download") === "1"

  if (!requestedPath) {
    return NextResponse.json(
      { ok: false, message: "Query parameter path is required." },
      { status: 400 }
    )
  }

  try {
    const { workspaceId } = await context.params
    const workspace = requireStudioSandboxWorkspace(
      decodeURIComponent(workspaceId)
    )
    let gatewayFilePath = requestedPath
    let gatewayRelativePath: string

    try {
      gatewayRelativePath = toStudioGatewayRelativePath(
        workspace,
        gatewayFilePath
      )
    } catch {
      const externalFile = await getCodeBoxSandboxReadableFileInfo({
        sandboxId: workspace.sandboxId,
        gatewayRoot: workspace.gatewayRoot,
        path: requestedPath,
      })

      if (request.method === "HEAD") {
        const responseHeaders = new Headers({
          "accept-ranges": "bytes",
          "cache-control": "no-store",
          "content-length": String(externalFile.size),
          "content-type": "application/octet-stream",
        })

        if (externalFile.modifiedAt > 0) {
          responseHeaders.set(
            "last-modified",
            new Date(externalFile.modifiedAt).toUTCString()
          )
        }
        if (download) {
          const filename =
            requestedPath.split("/").filter(Boolean).at(-1) ?? "download"
          responseHeaders.set(
            "content-disposition",
            createContentDispositionValue("attachment", filename)
          )
        }

        return new Response(null, { status: 200, headers: responseHeaders })
      }

      gatewayFilePath = await materializeCodeBoxSandboxReadableFile({
        sandboxId: workspace.sandboxId,
        gatewayRoot: workspace.gatewayRoot,
        path: requestedPath,
      })
      gatewayRelativePath = toStudioGatewayRelativePath(
        workspace,
        gatewayFilePath
      )
    }
    const search = new URLSearchParams({
      path: gatewayRelativePath,
    })
    const headers = new Headers()
    const range = request.headers.get("range")

    if (range) {
      headers.set("range", range)
    }

    const upstream = await fetchStudioWorkspaceGateway({
      workspace,
      path: `/v1/fs/file?${search}`,
      init: { method: request.method, headers },
    })
    const responseHeaders = new Headers()

    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name)

      if (value !== null) {
        responseHeaders.set(name, value)
      }
    }

    if (download && upstream.ok) {
      const filename =
        requestedPath.split("/").filter(Boolean).at(-1) ?? "download"

      responseHeaders.set(
        "content-disposition",
        createContentDispositionValue("attachment", filename)
      )
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
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

export const GET = proxyFile
export const HEAD = proxyFile
