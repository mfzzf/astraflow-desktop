import { Buffer } from "node:buffer"

import { feedbackServiceGetFeedbackImage } from "@/lib/generated/astraflow-api"
import { getAdminHeaders } from "@/lib/astraflow-api"
import { verifyAdminUIAuthorization } from "@/lib/admin-ui-auth-shared"

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

  return new Response(Buffer.from(result.data.content, "base64"), {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="${encodeURIComponent(result.data.name ?? "feedback-image")}"`,
      "Content-Type": result.data.mimeType ?? "application/octet-stream",
    },
  })
}
