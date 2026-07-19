import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedRequest } from "@/lib/app-auth"
import { getDistributionChannelSlug } from "@/lib/channel-config"
import {
  analyticsServiceCollectEvents,
  type AstraflowV1AnalyticsEvent,
} from "@/lib/generated/astraflow-api"
import { ensureValidStudioOAuthTokens } from "@/lib/ucloud-oauth"

export const runtime = "nodejs"

const eventSchema = z.object({
  eventId: z.string().trim().min(1).max(120),
  sessionId: z.string().trim().min(1).max(120),
  anonymousId: z.string().trim().min(1).max(120),
  eventName: z.string().trim().min(1).max(160),
  eventType: z.literal("click"),
  path: z.string().trim().startsWith("/").max(512),
  targetType: z.string().trim().max(64),
  targetId: z.string().trim().max(160),
  targetLabel: z.string().trim().max(240),
  platform: z.string().trim().max(64),
  locale: z.string().trim().max(32),
  screenWidth: z.number().int().min(0).max(100000),
  screenHeight: z.number().int().min(0).max(100000),
  occurredAt: z.iso.datetime(),
})

const requestSchema = z.object({
  events: z.array(eventSchema).min(1).max(100),
})

let cachedVersion: string | undefined

async function readCurrentVersion() {
  if (cachedVersion) return cachedVersion
  try {
    const packageJson = JSON.parse(
      await readFile(join(process.cwd(), "package.json"), "utf8")
    ) as { version?: string }
    cachedVersion = packageJson.version?.trim() || "0.0.0"
  } catch {
    cachedVersion = process.env.npm_package_version?.trim() || "0.0.0"
  }
  return cachedVersion
}

function analyticsError(status: number, error: unknown) {
  return NextResponse.json({ ok: false, error }, { status })
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)
  if (authError) return authError

  const tokens = await ensureValidStudioOAuthTokens()
  if (!tokens?.accessToken) {
    return analyticsError(401, "UCloud OAuth login is required.")
  }

  let input: unknown
  try {
    input = await request.json()
  } catch {
    return analyticsError(400, "Analytics request must be valid JSON.")
  }
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    return analyticsError(400, parsed.error.flatten())
  }

  const userIdHash = tokens.email
    ? createHash("sha256")
        .update(tokens.email.trim().toLowerCase())
        .digest("hex")
    : ""
  const channelSlug = getDistributionChannelSlug() || "default"
  const clientVersion = await readCurrentVersion()
  const events = parsed.data.events.map(
    (event) =>
      ({
        ...event,
        userIdHash,
        channelSlug,
        clientVersion,
      }) satisfies AstraflowV1AnalyticsEvent
  )

  try {
    const result = await analyticsServiceCollectEvents({
      body: { events },
      headers: {
        Accept: "application/json",
        Authorization: `${tokens.tokenType ?? "Bearer"} ${tokens.accessToken}`,
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (result.data === undefined) {
      return analyticsError(
        result.response?.status ?? 503,
        result.error ?? "Analytics service is unavailable."
      )
    }
    return NextResponse.json({ ok: true, data: result.data })
  } catch {
    return analyticsError(503, "Analytics service is unavailable.")
  }
}
