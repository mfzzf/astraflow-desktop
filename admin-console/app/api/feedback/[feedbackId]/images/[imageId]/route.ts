import { Buffer } from "node:buffer"

import { feedbackServiceGetFeedbackImage } from "@/lib/generated/astraflow-api"
import { getAdminHeaders } from "@/lib/astraflow-api"
import { verifyAdminUIAuthorization } from "@/lib/admin-ui-auth-shared"

function decodeImageContent(content: string, fallbackMimeType?: string) {
  const trimmed = content.trim()
  const dataUrl = /^data:([^;,]+);base64,([\s\S]+)$/.exec(trimmed)
  const encoded = (dataUrl?.[2] ?? trimmed).replace(/\s/g, "")
  const bytes = Buffer.from(encoded, "base64")

  return {
    bytes,
    mimeType: dataUrl?.[1] || fallbackMimeType || "application/octet-stream",
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ feedbackId: string; imageId: string }> }
) {
  const authResult = verifyAdminUIAuthorization(
    request.headers.get("authorization")
  )
  if (authResult !== "authorized") {
    return new Response("Authentication required.", {
      status: authResult === "unconfigured" ? 503 : 401,
      headers:
        authResult === "unauthorized"
          ? { "WWW-Authenticate": 'Basic realm="AstraFlow Control"' }
          : undefined,
    })
  }

  const { feedbackId, imageId } = await context.params
  const result = await feedbackServiceGetFeedbackImage({
    path: { feedbackId, imageId },
    headers: getAdminHeaders(),
    signal: AbortSignal.timeout(15_000),
  })

  if (!result.data?.content) {
    return Response.json(
      { error: result.error ?? "图片加载失败。" },
      { status: result.response?.status ?? 404 }
    )
  }

  const { bytes, mimeType } = decodeImageContent(
    result.data.content,
    result.data.mimeType
  )
  if (bytes.length === 0) {
    return Response.json({ error: "图片内容为空。" }, { status: 422 })
  }

  const fileName = encodeURIComponent(
    result.data.name ?? "feedback-image"
  ).replace(/'/g, "%27")

  return new Response(bytes, {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename*=UTF-8''${fileName}`,
      "Content-Length": String(bytes.length),
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  })
}
