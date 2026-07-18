export type AgentContentRole = "assistant" | "user"

export type AgentContentAnnotations = {
  audience?: AgentContentRole[] | null
  lastModified?: string | null
  priority?: number | null
  _meta?: Record<string, unknown> | null
}

type AgentContentBase = {
  annotations?: AgentContentAnnotations | null
  _meta?: Record<string, unknown> | null
}

export type AgentTextContent = AgentContentBase & {
  type: "text"
  text: string
}

export type AgentImageContent = AgentContentBase & {
  type: "image"
  data: string
  mimeType: string
  uri?: string | null
}

export type AgentAudioContent = AgentContentBase & {
  type: "audio"
  data: string
  mimeType: string
}

export type AgentResourceLinkContent = AgentContentBase & {
  type: "resource_link"
  uri: string
  name: string
  title?: string | null
  description?: string | null
  mimeType?: string | null
  size?: number | null
}

export type AgentEmbeddedTextResource = {
  uri: string
  text: string
  mimeType?: string | null
  _meta?: Record<string, unknown> | null
}

export type AgentEmbeddedBlobResource = {
  uri: string
  blob: string
  mimeType?: string | null
  _meta?: Record<string, unknown> | null
}

export type AgentEmbeddedResourceContent = AgentContentBase & {
  type: "resource"
  resource: AgentEmbeddedTextResource | AgentEmbeddedBlobResource
}

/**
 * Protocol-neutral structured content shared by runtime adapters and the
 * persisted Studio message model. It intentionally mirrors the common
 * ACP/MCP content-block shape without coupling the UI to either SDK.
 */
export type AgentContentBlock =
  | AgentTextContent
  | AgentImageContent
  | AgentAudioContent
  | AgentResourceLinkContent
  | AgentEmbeddedResourceContent

export type AgentToolCallLocation = {
  path: string
  line?: number | null
  _meta?: Record<string, unknown> | null
}

export type AgentToolCallContent =
  | {
      type: "content"
      content: AgentContentBlock
      _meta?: Record<string, unknown> | null
    }
  | {
      type: "diff"
      path: string
      oldText?: string | null
      newText: string
      _meta?: Record<string, unknown> | null
    }
  | {
      type: "terminal"
      terminalId: string
      _meta?: Record<string, unknown> | null
    }

export type AgentToolCallStatus =
  "pending" | "in_progress" | "completed" | "failed"

export type AgentPlanVariant = "items" | "markdown" | "file"

export const AGENT_STRUCTURED_TEXT_LIMIT = 256 * 1024
export const AGENT_STRUCTURED_BINARY_LIMIT = 2 * 1024 * 1024
export const AGENT_STRUCTURED_RAW_LIMIT = 128 * 1024
const AGENT_STRUCTURED_COLLECTION_LIMIT = 100
const AGENT_STRUCTURED_DEPTH_LIMIT = 8
const AGENT_STRUCTURED_NODE_LIMIT = 1000
const STRUCTURED_TRUNCATION_MARKER = "\n[truncated]"
const SENSITIVE_FIELD_NAME =
  /^(?:authorization|proxy-authorization|x[-_]?api[-_]?key|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|token|password|passwd|secret|client[-_]?secret|cookie|set-cookie|credential)$/i
const SENSITIVE_QUERY_PARAMETER =
  /([?&](?:x[-_]?api[-_]?key|api[-_]?key|access[-_]?token|auth|authorization|credential|key|password|secret|token)=)[^&#\s]*/gi

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function truncateStructuredText(value: string, limit: number) {
  if (value.length <= limit) {
    return value
  }

  return `${value.slice(
    0,
    Math.max(0, limit - STRUCTURED_TRUNCATION_MARKER.length)
  )}${STRUCTURED_TRUNCATION_MARKER}`
}

function redactStructuredString(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "sk-[REDACTED]")
    .replace(SENSITIVE_QUERY_PARAMETER, "$1[REDACTED]")
    .replace(
      /\b(https?:\/\/)([^\s/:@]+):([^\s/@]+)@/gi,
      "$1[REDACTED]:[REDACTED]@"
    )
}

export function sanitizeAgentText(value: string, limit: number) {
  return truncateStructuredText(redactStructuredString(value), limit)
}

export function sanitizeAgentStructuredValue(
  value: unknown,
  maxCharacters = AGENT_STRUCTURED_RAW_LIMIT
): unknown {
  const state = {
    remaining: Math.max(0, maxCharacters),
    remainingNodes: AGENT_STRUCTURED_NODE_LIMIT,
    seen: new WeakSet<object>(),
  }

  const visit = (candidate: unknown, depth: number, key = ""): unknown => {
    if (SENSITIVE_FIELD_NAME.test(key)) {
      return "[REDACTED]"
    }
    if (state.remainingNodes <= 0) {
      return "[truncated]"
    }

    state.remainingNodes -= 1

    if (candidate === null || typeof candidate === "boolean") {
      return candidate
    }
    if (typeof candidate === "number") {
      return Number.isFinite(candidate) ? candidate : String(candidate)
    }
    if (typeof candidate === "string") {
      const redacted = redactStructuredString(candidate)
      const allowed = Math.min(state.remaining, AGENT_STRUCTURED_TEXT_LIMIT)
      const retainedLength = Math.min(redacted.length, allowed)

      state.remaining = Math.max(0, state.remaining - retainedLength)
      return truncateStructuredText(redacted, allowed)
    }
    if (candidate === undefined) {
      return null
    }
    if (typeof candidate !== "object") {
      return String(candidate)
    }
    if (depth >= AGENT_STRUCTURED_DEPTH_LIMIT || state.remaining <= 0) {
      return "[truncated]"
    }
    if (state.seen.has(candidate)) {
      return "[circular]"
    }

    state.seen.add(candidate)

    if (Array.isArray(candidate)) {
      const items = candidate
        .slice(0, AGENT_STRUCTURED_COLLECTION_LIMIT)
        .map((item) => visit(item, depth + 1))

      if (candidate.length > items.length) {
        items.push("[truncated]")
      }
      return items
    }

    const result: Record<string, unknown> = {}
    const entries = Object.entries(candidate).slice(
      0,
      AGENT_STRUCTURED_COLLECTION_LIMIT
    )

    for (const [entryKey, entryValue] of entries) {
      if (state.remaining <= 0) {
        result._truncated = true
        break
      }

      state.remaining = Math.max(0, state.remaining - entryKey.length)
      result[entryKey] = visit(entryValue, depth + 1, entryKey)
    }
    if (Object.keys(candidate).length > entries.length) {
      result._truncated = true
    }

    return result
  }

  return visit(value, 0)
}

function sanitizeStructuredRecord(
  value: Record<string, unknown> | null | undefined
) {
  if (!value) {
    return value
  }

  const sanitized = sanitizeAgentStructuredValue(value)

  return isRecord(sanitized) ? sanitized : { _truncated: true }
}

function sanitizeContentBase(content: AgentContentBlock) {
  const annotations = content.annotations
    ? {
        ...content.annotations,
        ...(content.annotations.lastModified
          ? {
              lastModified: truncateStructuredText(
                content.annotations.lastModified,
                2048
              ),
            }
          : {}),
        ...(content.annotations._meta
          ? { _meta: sanitizeStructuredRecord(content.annotations._meta) }
          : {}),
      }
    : content.annotations

  return {
    ...(annotations !== undefined ? { annotations } : {}),
    ...(content._meta !== undefined
      ? { _meta: sanitizeStructuredRecord(content._meta) }
      : {}),
  }
}

export function sanitizeAgentContentBlock(
  content: AgentContentBlock
): AgentContentBlock {
  const base = sanitizeContentBase(content)

  if (content.type === "text") {
    return {
      ...base,
      type: "text",
      text: sanitizeAgentText(content.text, AGENT_STRUCTURED_TEXT_LIMIT),
    }
  }

  if (content.type === "image") {
    if (content.data.length > AGENT_STRUCTURED_BINARY_LIMIT) {
      if (content.uri) {
        return {
          ...base,
          type: "resource_link",
          uri: truncateStructuredText(content.uri, 8192),
          name: "image",
          mimeType: truncateStructuredText(content.mimeType, 256),
          description:
            "Inline image omitted because it exceeded the client limit.",
        }
      }

      return {
        ...base,
        type: "text",
        text: `[image omitted: ${content.mimeType} exceeded the client limit]`,
      }
    }

    return {
      ...content,
      ...base,
      mimeType: truncateStructuredText(content.mimeType, 256),
      ...(content.uri
        ? { uri: truncateStructuredText(content.uri, 8192) }
        : {}),
    }
  }

  if (content.type === "audio") {
    if (content.data.length > AGENT_STRUCTURED_BINARY_LIMIT) {
      return {
        ...base,
        type: "text",
        text: `[audio omitted: ${content.mimeType} exceeded the client limit]`,
      }
    }

    return {
      ...content,
      ...base,
      mimeType: truncateStructuredText(content.mimeType, 256),
    }
  }

  if (content.type === "resource_link") {
    return {
      ...content,
      ...base,
      uri: truncateStructuredText(content.uri, 8192),
      name: truncateStructuredText(content.name, 2048),
      ...(content.title
        ? { title: truncateStructuredText(content.title, 2048) }
        : {}),
      ...(content.description
        ? {
            description: sanitizeAgentText(
              content.description,
              AGENT_STRUCTURED_TEXT_LIMIT
            ),
          }
        : {}),
      ...(content.mimeType
        ? { mimeType: truncateStructuredText(content.mimeType, 256) }
        : {}),
    }
  }

  const resource = content.resource
  const commonResource = {
    uri: truncateStructuredText(resource.uri, 8192),
    ...(resource.mimeType
      ? { mimeType: truncateStructuredText(resource.mimeType, 256) }
      : {}),
    ...(resource._meta
      ? { _meta: sanitizeStructuredRecord(resource._meta) }
      : {}),
  }

  if ("text" in resource) {
    return {
      ...base,
      type: "resource",
      resource: {
        ...commonResource,
        text: truncateStructuredText(
          resource.text,
          AGENT_STRUCTURED_TEXT_LIMIT
        ),
      },
    }
  }

  if (resource.blob.length > AGENT_STRUCTURED_BINARY_LIMIT) {
    return {
      ...base,
      type: "resource",
      resource: {
        ...commonResource,
        text: "[binary resource omitted because it exceeded the client limit]",
      },
    }
  }

  return {
    ...base,
    type: "resource",
    resource: { ...commonResource, blob: resource.blob },
  }
}

export function sanitizeAgentToolCallContent(
  content: AgentToolCallContent
): AgentToolCallContent {
  const meta =
    content._meta !== undefined
      ? { _meta: sanitizeStructuredRecord(content._meta) }
      : {}

  if (content.type === "content") {
    return {
      ...meta,
      type: "content",
      content: sanitizeAgentContentBlock(content.content),
    }
  }

  if (content.type === "diff") {
    return {
      ...meta,
      type: "diff",
      path: truncateStructuredText(content.path, 8192),
      newText: sanitizeAgentText(content.newText, AGENT_STRUCTURED_TEXT_LIMIT),
      ...(content.oldText !== undefined
        ? {
            oldText:
              content.oldText === null
                ? null
                : sanitizeAgentText(
                    content.oldText,
                    AGENT_STRUCTURED_TEXT_LIMIT
                  ),
          }
        : {}),
    }
  }

  return {
    ...meta,
    type: "terminal",
    terminalId: truncateStructuredText(content.terminalId, 2048),
  }
}

export function sanitizeAgentToolCallLocation(
  location: AgentToolCallLocation
): AgentToolCallLocation {
  return {
    path: truncateStructuredText(location.path, 8192),
    ...(location.line !== undefined ? { line: location.line } : {}),
    ...(location._meta !== undefined
      ? { _meta: sanitizeStructuredRecord(location._meta) }
      : {}),
  }
}

function isOptionalRecord(value: unknown) {
  return value === undefined || value === null || isRecord(value)
}

function hasValidContentBase(value: Record<string, unknown>) {
  if (!isOptionalRecord(value._meta)) {
    return false
  }

  if (value.annotations === undefined || value.annotations === null) {
    return true
  }

  if (!isRecord(value.annotations)) {
    return false
  }

  const annotations = value.annotations

  return (
    (annotations.audience === undefined ||
      annotations.audience === null ||
      (Array.isArray(annotations.audience) &&
        annotations.audience.every(
          (role) => role === "assistant" || role === "user"
        ))) &&
    (annotations.lastModified === undefined ||
      annotations.lastModified === null ||
      typeof annotations.lastModified === "string") &&
    (annotations.priority === undefined ||
      annotations.priority === null ||
      typeof annotations.priority === "number") &&
    isOptionalRecord(annotations._meta)
  )
}

export function isAgentContentBlock(
  value: unknown
): value is AgentContentBlock {
  if (!isRecord(value) || !hasValidContentBase(value)) {
    return false
  }

  if (value.type === "text") {
    return typeof value.text === "string"
  }

  if (value.type === "image") {
    return (
      typeof value.data === "string" &&
      typeof value.mimeType === "string" &&
      (value.uri === undefined ||
        value.uri === null ||
        typeof value.uri === "string")
    )
  }

  if (value.type === "audio") {
    return typeof value.data === "string" && typeof value.mimeType === "string"
  }

  if (value.type === "resource_link") {
    return (
      typeof value.uri === "string" &&
      typeof value.name === "string" &&
      (value.title === undefined ||
        value.title === null ||
        typeof value.title === "string") &&
      (value.description === undefined ||
        value.description === null ||
        typeof value.description === "string") &&
      (value.mimeType === undefined ||
        value.mimeType === null ||
        typeof value.mimeType === "string") &&
      (value.size === undefined ||
        value.size === null ||
        typeof value.size === "number")
    )
  }

  if (value.type !== "resource" || !isRecord(value.resource)) {
    return false
  }

  const resource = value.resource

  return (
    typeof resource.uri === "string" &&
    (resource.mimeType === undefined ||
      resource.mimeType === null ||
      typeof resource.mimeType === "string") &&
    isOptionalRecord(resource._meta) &&
    ((typeof resource.text === "string" && resource.blob === undefined) ||
      (typeof resource.blob === "string" && resource.text === undefined))
  )
}

export function isAgentToolCallLocation(
  value: unknown
): value is AgentToolCallLocation {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    (value.line === undefined ||
      value.line === null ||
      typeof value.line === "number") &&
    isOptionalRecord(value._meta)
  )
}

export function isAgentToolCallContent(
  value: unknown
): value is AgentToolCallContent {
  if (!isRecord(value) || !isOptionalRecord(value._meta)) {
    return false
  }

  if (value.type === "content") {
    return isAgentContentBlock(value.content)
  }

  if (value.type === "diff") {
    return (
      typeof value.path === "string" &&
      typeof value.newText === "string" &&
      (value.oldText === undefined ||
        value.oldText === null ||
        typeof value.oldText === "string")
    )
  }

  return value.type === "terminal" && typeof value.terminalId === "string"
}

export function agentContentBlockText(content: AgentContentBlock) {
  if (content.type === "text") {
    return content.text
  }

  if (content.type === "resource" && "text" in content.resource) {
    return content.resource.text
  }

  return ""
}
