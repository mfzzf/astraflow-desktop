export function calculateServerRemainingSeconds({
  expiresAt,
  serverTime,
  clientReceivedAtMs,
  clientNowMs,
}: {
  expiresAt: string
  serverTime: string
  clientReceivedAtMs: number
  clientNowMs: number
}) {
  const expiresAtMs = Date.parse(expiresAt)
  const serverTimeMs = Date.parse(serverTime)
  if (!Number.isFinite(expiresAtMs) || !Number.isFinite(serverTimeMs)) {
    return null
  }

  const elapsedSinceResponse = Math.max(0, clientNowMs - clientReceivedAtMs)
  const estimatedServerNow = serverTimeMs + elapsedSinceResponse
  return Math.max(0, Math.ceil((expiresAtMs - estimatedServerNow) / 1_000))
}
