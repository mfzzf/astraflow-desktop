import type {
  StudioVideoPollingProtocol,
  StudioVideoSubmitProtocol,
} from "@/lib/studio-video-types"

export function readVideoProtocolPath(payload: unknown, path: string[]) {
  let value = payload

  for (const segment of path) {
    if (!value || typeof value !== "object") {
      return undefined
    }

    value = (value as Record<string, unknown>)[segment]
  }

  return value
}

export function readVideoProtocolString(payload: unknown, path: string[]) {
  const value = readVideoProtocolPath(payload, path)

  if (typeof value === "string" && value) {
    return value
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  return null
}

export function videoProtocolStatusMatches(
  status: string | null,
  expected: string[]
) {
  const normalized = status?.toLowerCase()
  return Boolean(
    normalized && expected.some((value) => value.toLowerCase() === normalized)
  )
}

export function getVideoProtocolTaskId(
  payload: unknown,
  protocol: StudioVideoSubmitProtocol
) {
  return readVideoProtocolString(payload, protocol.taskIdPath)
}

export function getVideoProtocolTaskStatus(
  payload: unknown,
  protocol: StudioVideoPollingProtocol
) {
  return readVideoProtocolString(payload, protocol.statusPath)
}

export function isVideoProtocolSuccess(
  status: string | null,
  protocol: StudioVideoPollingProtocol
) {
  return videoProtocolStatusMatches(status, protocol.successStatuses)
}

export function isVideoProtocolFailure(
  status: string | null,
  protocol: StudioVideoPollingProtocol
) {
  return videoProtocolStatusMatches(status, protocol.failureStatuses)
}

export function getVideoProtocolResultUrls(
  payload: unknown,
  protocol: StudioVideoPollingProtocol
) {
  if (!protocol.resultUrlsPath) {
    return []
  }

  const value = readVideoProtocolPath(payload, protocol.resultUrlsPath)

  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.length > 0
      )
    : []
}
