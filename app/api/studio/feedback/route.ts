import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  feedbackServiceCreateFeedback,
  type AstraflowV1CreateFeedbackRequest,
} from "@/lib/generated/astraflow-api"
import { parseDataUrl } from "@/lib/studio-file-storage"
import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"

export const runtime = "nodejs"

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
])

const feedbackSchema = z.object({
  sessionId: z.string().trim().min(1).max(120),
  targetMessageId: z.string().trim().min(1).max(120).nullable().default(null),
  entryPoint: z.enum(["message_action", "titlebar"]),
  description: z.string().trim().min(1).max(4000),
  messages: z.array(z.unknown()).min(1),
  images: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(255),
        mimeType: z.string().trim().min(1).max(255),
        dataUrl: z
          .string()
          .trim()
          .regex(/^data:/i),
      })
    )
    .max(3),
  locale: z.enum(["en", "zh"]),
})

async function readCurrentVersion() {
  try {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as { version?: string }

    return packageJson.version?.trim() || "0.0.0"
  } catch {
    return process.env.npm_package_version?.trim() || "0.0.0"
  }
}

function feedbackError(status: number, error: unknown) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const tokens = await ensureValidStudioOAuthTokens()

  if (!tokens?.accessToken) {
    return feedbackError(
      401,
      "UCloud OAuth login is required to send feedback."
    )
  }

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return feedbackError(400, "Feedback request must be valid JSON.")
  }

  const parsed = feedbackSchema.safeParse(body)

  if (!parsed.success) {
    return feedbackError(400, parsed.error.flatten())
  }

  if (
    parsed.data.entryPoint === "message_action" &&
    !parsed.data.targetMessageId
  ) {
    return feedbackError(
      400,
      "targetMessageId is required for message feedback."
    )
  }

  const images: Array<{
    name: string
    mimeType: string
    content: string
  }> = []

  try {
    for (const image of parsed.data.images) {
      const decoded = parseDataUrl(image.dataUrl)
      const mimeType = decoded.mimeType.toLowerCase()

      if (
        !ALLOWED_IMAGE_TYPES.has(mimeType) ||
        mimeType !== image.mimeType.toLowerCase()
      ) {
        return feedbackError(400, "Unsupported feedback image type.")
      }
      if (decoded.buffer.byteLength > MAX_IMAGE_BYTES) {
        return feedbackError(413, "Each feedback image must be at most 5 MiB.")
      }

      images.push({
        name: image.name,
        mimeType,
        content: decoded.buffer.toString("base64"),
      })
    }
  } catch {
    return feedbackError(400, "Feedback image data is invalid.")
  }

  try {
    const feedbackRequest = {
      sessionId: parsed.data.sessionId,
      targetMessageId: parsed.data.targetMessageId ?? "",
      entryPoint: parsed.data.entryPoint,
      description: parsed.data.description,
      messagesJson: JSON.stringify(parsed.data.messages),
      images,
      reporterEmail: tokens.email ?? "",
      clientVersion: await readCurrentVersion(),
      platform: process.platform,
      locale: parsed.data.locale,
    } satisfies AstraflowV1CreateFeedbackRequest

    const result = await feedbackServiceCreateFeedback({
      body: feedbackRequest,
      headers: {
        Accept: "application/json",
        Authorization: `${tokens.tokenType ?? "Bearer"} ${tokens.accessToken}`,
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (result.data === undefined) {
      return feedbackError(
        result.response?.status ?? 503,
        result.error ?? "Feedback service is unavailable."
      )
    }

    return NextResponse.json({ ok: true, data: result.data }, { status: 201 })
  } catch {
    return feedbackError(503, "Feedback service is unavailable.")
  }
}
