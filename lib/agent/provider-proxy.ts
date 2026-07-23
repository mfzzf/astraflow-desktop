import { createHash, randomBytes } from "node:crypto"

import type { AgentModelDefinition } from "@/lib/agent-model-settings-shared"

const PROVIDER_PROXY_TOKEN_TTL_MS = 12 * 60 * 60 * 1000
const PROVIDER_PROXY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PROVIDER_PROXY_ROUTE_MARKER = "credential"

export type AgentProviderProxyAuthMode = "bearer" | "x-api-key"

type ProviderProxyRecord = {
  token: string
  scopeKey: string
  sessionId: string
  apiKey: string
  authMode: AgentProviderProxyAuthMode
  baseUrl: string
  protocol: AgentModelDefinition["protocol"]
  activeConsumers: number
  expiresAt: number
}

type ProviderProxyRegistry = {
  byScope: Map<string, ProviderProxyRecord>
  byToken: Map<string, ProviderProxyRecord>
}

declare global {
  var __astraflowProviderProxyRegistry: ProviderProxyRegistry | undefined
}

function getRegistry() {
  globalThis.__astraflowProviderProxyRegistry ??= {
    byScope: new Map(),
    byToken: new Map(),
  }

  return globalThis.__astraflowProviderProxyRegistry
}

function pruneRegistry(now: number) {
  const registry = getRegistry()

  for (const [token, record] of registry.byToken) {
    if ((record.activeConsumers ?? 0) > 0 || record.expiresAt > now) {
      continue
    }

    registry.byToken.delete(token)

    if (registry.byScope.get(record.scopeKey)?.token === token) {
      registry.byScope.delete(record.scopeKey)
    }
  }
}

function getInternalOrigin() {
  const configured = process.env.ASTRAFLOW_INTERNAL_ORIGIN?.trim()

  if (!configured) {
    throw new Error(
      "AstraFlow's Desktop provider proxy is unavailable. Local Agent execution is blocked."
    )
  }

  const origin = new URL(configured)

  if (
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/"
  ) {
    throw new Error("AstraFlow's Desktop provider proxy origin is invalid.")
  }

  return origin
}

function getOriginEndpoint(origin: URL) {
  return {
    host: origin.hostname.toLocaleLowerCase("en-US"),
    port: Number(origin.port) || 80,
  }
}

function normalizeProviderBaseUrl(value: string) {
  const url = new URL(value)

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port &&
      !(
        (url.protocol === "https:" && url.port === "443") ||
        (url.protocol === "http:" && url.port === "80")
      ))
  ) {
    throw new Error("The configured Agent provider URL is invalid.")
  }

  return url.toString().replace(/\/+$/, "")
}

export function createAgentProviderProxyCredential(input: {
  sessionId: string
  apiKey: string
  authMode?: AgentProviderProxyAuthMode
  baseUrl: string
  protocol: AgentModelDefinition["protocol"]
  scopeId?: string
}) {
  const internalOrigin = getInternalOrigin()
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl)
  const now = Date.now()
  const scopeKey = createHash("sha256")
    .update(input.sessionId)
    .update("\0")
    .update(input.scopeId ?? "")
    .update("\0")
    .update(input.protocol)
    .update("\0")
    .update(
      input.authMode ??
        (input.protocol === "anthropic-messages" ? "x-api-key" : "bearer")
    )
    .update("\0")
    .update(baseUrl)
    .update("\0")
    .update(input.apiKey)
    .digest("hex")
  const registry = getRegistry()

  pruneRegistry(now)

  const existing = registry.byScope.get(scopeKey)

  if (existing && existing.expiresAt > now) {
    return {
      apiKey: existing.token,
      baseUrl: `${internalOrigin.origin}/api/internal/agent-provider/${PROVIDER_PROXY_ROUTE_MARKER}`,
      providerEndpoint: getOriginEndpoint(internalOrigin),
      providerHostname: internalOrigin.hostname,
    }
  }

  const token = randomBytes(32).toString("base64url")
  const record: ProviderProxyRecord = {
    token,
    scopeKey,
    sessionId: input.sessionId,
    apiKey: input.apiKey,
    authMode:
      input.authMode ??
      (input.protocol === "anthropic-messages" ? "x-api-key" : "bearer"),
    baseUrl,
    protocol: input.protocol,
    activeConsumers: 0,
    expiresAt: now + PROVIDER_PROXY_TOKEN_TTL_MS,
  }

  registry.byScope.set(scopeKey, record)
  registry.byToken.set(token, record)

  return {
    apiKey: token,
    baseUrl: `${internalOrigin.origin}/api/internal/agent-provider/${PROVIDER_PROXY_ROUTE_MARKER}`,
    providerEndpoint: getOriginEndpoint(internalOrigin),
    providerHostname: internalOrigin.hostname,
  }
}

export function resolveAgentProviderProxyCredential(token: string) {
  if (!PROVIDER_PROXY_TOKEN_PATTERN.test(token)) {
    return null
  }

  const now = Date.now()

  pruneRegistry(now)

  const record = getRegistry().byToken.get(token)

  if (
    !record ||
    ((record.activeConsumers ?? 0) === 0 && record.expiresAt <= now)
  ) {
    return null
  }

  record.expiresAt = now + PROVIDER_PROXY_TOKEN_TTL_MS
  return record
}

export function retainAgentProviderProxyCredential(token: string) {
  const record = resolveAgentProviderProxyCredential(token)

  if (!record) {
    return false
  }

  record.activeConsumers = (record.activeConsumers ?? 0) + 1
  return true
}

export function releaseAgentProviderProxyCredential(token: string) {
  const registry = getRegistry()
  const record = registry.byToken.get(token)

  if (!record) {
    return
  }

  record.activeConsumers = Math.max(0, (record.activeConsumers ?? 0) - 1)

  if (record.activeConsumers > 0) {
    return
  }

  registry.byToken.delete(token)

  if (registry.byScope.get(record.scopeKey)?.token === token) {
    registry.byScope.delete(record.scopeKey)
  }
}
