import { NextResponse, type NextRequest } from "next/server"

import {
  getAcpSessionControlSnapshot,
  runAcpSessionControlAction,
  type AcpSessionControlAction,
} from "@/lib/agent/acp/acp-runtime"
import { getAppAuthState } from "@/lib/app-auth"
import { isPublicAgentRuntimeId } from "@/lib/agent-model-settings-shared"
import { sanitizeAgentStructuredValue } from "@/lib/agent/structured-content"
import {
  continueStudioAcpAgentSession,
  prepareStudioAcpRuntime,
} from "@/lib/studio-chat-runner"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type RouteParams = { params: Promise<{ runtimeId: string }> }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "ACP request failed."
}

async function requireAuthenticatedRequest() {
  const auth = await getAppAuthState()

  return auth.authenticated
    ? null
    : NextResponse.json(
        { ok: false, error: "Login is required." },
        { status: 401 }
      )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const ACP_CONTROL_BODY_BYTE_LIMIT = 256 * 1024
const ACP_CONTROL_META_LIMIT = 32 * 1024
const ACP_CONTROL_HEADER_COUNT_LIMIT = 32

async function readBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"))

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > ACP_CONTROL_BODY_BYTE_LIMIT
  ) {
    throw new Error("ACP control request is too large.")
  }

  if (!request.body) {
    throw new Error("ACP control request body is required.")
  }

  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let json = ""

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      json += decoder.decode()
      break
    }

    total += value.byteLength
    if (total > ACP_CONTROL_BODY_BYTE_LIMIT) {
      await reader.cancel()
      throw new Error("ACP control request is too large.")
    }
    json += decoder.decode(value, { stream: true })
  }

  try {
    return JSON.parse(json) as unknown
  } catch {
    throw new Error("ACP control request must be valid JSON.")
  }
}

function requiredString(
  value: Record<string, unknown>,
  name: string,
  limit = 512
) {
  const candidate = value[name]

  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(`${name} is required.`)
  }

  const normalized = candidate.trim()

  if (normalized.length > limit) {
    throw new Error(`${name} is too long.`)
  }

  return normalized
}

function optionalString(
  value: Record<string, unknown>,
  name: string,
  limit: number
) {
  const candidate = value[name]

  if (candidate === undefined || candidate === null) {
    return undefined
  }
  if (typeof candidate !== "string" || candidate.length > limit) {
    throw new Error(`${name} must be a bounded string.`)
  }

  return candidate
}

function optionalMeta(value: Record<string, unknown>) {
  if (value.meta === undefined || value.meta === null) {
    return undefined
  }
  if (!isRecord(value.meta)) {
    throw new Error("meta must be an object.")
  }

  const meta = sanitizeAgentStructuredValue(value.meta, ACP_CONTROL_META_LIMIT)

  if (!isRecord(meta)) {
    throw new Error("meta must be an object.")
  }

  return meta
}

function optionalHeaders(value: Record<string, unknown>) {
  if (value.headers === undefined) {
    return undefined
  }
  if (!isRecord(value.headers)) {
    throw new Error("headers must be a string map.")
  }

  const entries = Object.entries(value.headers)

  if (entries.length > ACP_CONTROL_HEADER_COUNT_LIMIT) {
    throw new Error("Too many ACP provider headers.")
  }

  return Object.fromEntries(
    entries.map(([name, headerValue]) => {
      if (
        !name.trim() ||
        name.length > 256 ||
        /[\r\n]/.test(name) ||
        typeof headerValue !== "string" ||
        headerValue.length > 8192 ||
        /[\r\n]/.test(headerValue)
      ) {
        throw new Error("headers must be a bounded valid string map.")
      }

      return [name, headerValue]
    })
  )
}

function validatedProviderBaseUrl(value: Record<string, unknown>) {
  const baseUrl = requiredString(value, "baseUrl", 8192)
  let parsed: URL

  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error("baseUrl must be an absolute URL.")
  }

  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(
      "baseUrl must be an HTTP(S) URL without embedded credentials or fragments."
    )
  }
  const sensitiveQueryName =
    /^(?:x[-_]?api[-_]?key|api[-_]?key|access[-_]?token|auth|authorization|credential|key|password|secret|token)$/i

  if (
    [...parsed.searchParams.keys()].some((name) =>
      sensitiveQueryName.test(name)
    )
  ) {
    throw new Error(
      "baseUrl must not contain credentials; pass authentication through headers."
    )
  }

  return baseUrl
}

function parseControlAction(value: unknown): AcpSessionControlAction {
  if (!isRecord(value) || typeof value.action !== "string") {
    throw new Error("A typed ACP control action is required.")
  }

  const meta = optionalMeta(value)

  switch (value.action) {
    case "cancel":
      if (meta) {
        throw new Error("ACP session cancellation does not accept meta.")
      }
      return { action: "cancel" }
    case "close":
      return { action: "close", ...(meta ? { meta } : {}) }
    case "authenticate":
      return {
        action: "authenticate",
        methodId: requiredString(value, "methodId"),
        ...(meta ? { meta } : {}),
      }
    case "delete_session":
      return {
        action: "delete_session",
        sessionId: requiredString(value, "sessionId", 2048),
        ...(meta ? { meta } : {}),
      }
    case "disable_provider":
      return {
        action: "disable_provider",
        providerId: requiredString(value, "providerId"),
        ...(meta ? { meta } : {}),
      }
    case "list_providers":
    case "logout":
      return { action: value.action, ...(meta ? { meta } : {}) }
    case "list_sessions": {
      const cursor = optionalString(value, "cursor", 4096)
      const cwd = optionalString(value, "cwd", 8192)

      return {
        action: "list_sessions",
        ...(cursor !== undefined ? { cursor } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
        ...(meta ? { meta } : {}),
      }
    }
    case "set_config_option": {
      const configValue = value.value

      if (
        typeof configValue !== "boolean" &&
        (typeof configValue !== "string" || configValue.length > 2048)
      ) {
        throw new Error("value must be a bounded string or boolean.")
      }

      return {
        action: "set_config_option",
        configId: requiredString(value, "configId"),
        value: configValue,
        ...(meta ? { meta } : {}),
      }
    }
    case "set_mode":
      return {
        action: "set_mode",
        modeId: requiredString(value, "modeId"),
        ...(meta ? { meta } : {}),
      }
    case "set_provider": {
      const headers = optionalHeaders(value)

      return {
        action: "set_provider",
        providerId: requiredString(value, "providerId"),
        apiType: requiredString(value, "apiType", 128),
        baseUrl: validatedProviderBaseUrl(value),
        ...(headers ? { headers } : {}),
        ...(meta ? { meta } : {}),
      }
    }
    default:
      throw new Error(`Unsupported ACP control action: ${value.action}`)
  }
}

async function resolveRuntimeId({ params }: RouteParams) {
  const { runtimeId } = await params

  if (!isPublicAgentRuntimeId(runtimeId)) {
    throw new Error(`Runtime ${runtimeId} is not an ACP client runtime.`)
  }

  return runtimeId
}

export async function GET(request: NextRequest, context: RouteParams) {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  try {
    const runtimeId = await resolveRuntimeId(context)
    const studioSessionId = request.nextUrl.searchParams
      .get("sessionId")
      ?.trim()

    if (!studioSessionId) {
      return NextResponse.json(
        { ok: false, error: "sessionId is required." },
        { status: 400 }
      )
    }
    if (studioSessionId.length > 2048) {
      throw new Error("sessionId is too long.")
    }

    return NextResponse.json({
      ok: true,
      data: getAcpSessionControlSnapshot(studioSessionId, runtimeId),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 400 }
    )
  }
}

export async function POST(request: Request, context: RouteParams) {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  try {
    const runtimeId = await resolveRuntimeId(context)
    const body = await readBoundedJson(request)

    if (!isRecord(body)) {
      throw new Error("sessionId is required.")
    }
    const studioSessionId = requiredString(body, "sessionId", 2048)
    const control = isRecord(body.control) ? body.control : null

    if (control?.action === "prepare") {
      await prepareStudioAcpRuntime(studioSessionId, runtimeId)
      return NextResponse.json({
        ok: true,
        data: getAcpSessionControlSnapshot(studioSessionId, runtimeId),
      })
    }

    if (control?.action === "continue_session") {
      const agentSessionId = requiredString(control, "agentSessionId", 2048)
      const cwd = requiredString(control, "cwd", 8192)
      const title = optionalString(control, "title", 8192)
      const updatedAt = optionalString(control, "updatedAt", 128)
      const result = await continueStudioAcpAgentSession({
        runtimeId,
        sourceStudioSessionId: studioSessionId,
        agentSession: {
          sessionId: agentSessionId,
          cwd,
          ...(title !== undefined ? { title } : {}),
          ...(updatedAt !== undefined ? { updatedAt } : {}),
        },
      })

      return NextResponse.json({
        ok: true,
        data: {
          agentSessionId,
          reused: result.reused,
          sessionPath: `/studio/chat/${encodeURIComponent(result.session.id)}`,
        },
      })
    }

    const data = await runAcpSessionControlAction({
      runtimeId,
      studioSessionId,
      action: parseControlAction(control),
    })

    return NextResponse.json({
      ok: true,
      data: sanitizeAgentStructuredValue(data, ACP_CONTROL_BODY_BYTE_LIMIT),
    })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 400 }
    )
  }
}
