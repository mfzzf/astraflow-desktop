export type StudioWorkspaceServiceResult = {
  schemaVersion: 1
  sessionId: string | null
  workspaceId: string | null
  sandboxId: string | null
  serviceId: string | null
  name: string
  status: "starting" | "healthy" | "unhealthy" | "stopped" | "failed"
  port: number | null
  cwd: string
  healthPath: string | null
  logPath: string
  entryPath: string | null
  artifactKey: string | null
  specFingerprint: string
  specRevision: string | null
  publicUrl: string | null
  failure: string | null
}

export type StudioWorkspaceServiceContext = {
  sessionId: string
  workspaceId: string
  sandboxId: string
}

export function isStudioWorkspaceServiceResultForContext(
  service: StudioWorkspaceServiceResult | null | undefined,
  context: StudioWorkspaceServiceContext | null | undefined
) {
  return Boolean(
    service &&
      context &&
      service.sessionId === context.sessionId &&
      service.workspaceId === context.workspaceId &&
      service.sandboxId === context.sandboxId
  )
}

function record(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function validatedPublicUrl(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null
  }

  if (typeof value !== "string") {
    return null
  }

  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()

    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname)
    ) {
      return null
    }

    return url.toString()
  } catch {
    return null
  }
}

function structuredContentCandidates(value: unknown) {
  const root = record(value)
  const details = record(root?.details)
  const result = record(details?.result)
  const astraflow = record(record(root?.astraflow)?.toolResult)

  return [
    record(root?.structuredContent),
    record(details?.structuredContent),
    record(result?.structuredContent),
    record(astraflow?.structuredContent),
  ]
}

export function getStudioWorkspaceServiceResult(
  value: unknown
): StudioWorkspaceServiceResult | null {
  const service = structuredContentCandidates(value)
    .map((candidate) => record(record(candidate?.astraflow)?.service))
    .find(Boolean)

  if (!service) {
    return null
  }

  const status = service.status
  const serviceId = nullableString(service.serviceId)
  const name = nullableString(service.name)
  const cwd = typeof service.cwd === "string" ? service.cwd : ""
  const logPath = typeof service.logPath === "string" ? service.logPath : ""
  const specFingerprint =
    typeof service.specFingerprint === "string"
      ? service.specFingerprint
      : ""
  const port =
    Number.isInteger(service.port) &&
    Number(service.port) >= 1 &&
    Number(service.port) <= 65_535
      ? Number(service.port)
      : null

  if (
    service.schemaVersion !== 1 ||
    !name ||
    !["starting", "healthy", "unhealthy", "stopped", "failed"].includes(
      String(status)
    ) ||
    (status !== "failed" && (!serviceId || !port))
  ) {
    return null
  }

  const publicUrl = validatedPublicUrl(service.publicUrl)

  return {
    schemaVersion: 1,
    sessionId: nullableString(service.sessionId),
    workspaceId: nullableString(service.workspaceId),
    sandboxId: nullableString(service.sandboxId),
    serviceId,
    name,
    status: status as StudioWorkspaceServiceResult["status"],
    port,
    cwd,
    healthPath: nullableString(service.healthPath),
    logPath,
    entryPath: nullableString(service.entryPath),
    artifactKey: nullableString(service.artifactKey),
    specFingerprint,
    specRevision: nullableString(service.specRevision),
    publicUrl: status === "healthy" ? publicUrl : null,
    failure: nullableString(service.failure),
  }
}
