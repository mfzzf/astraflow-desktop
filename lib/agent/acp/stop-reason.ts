export type AcpStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled"

export function getAcpStopReasonErrorMessage({
  displayName,
  signalAborted,
  stopReason,
}: {
  displayName: string
  signalAborted: boolean
  stopReason: AcpStopReason
}) {
  if (stopReason === "max_tokens") {
    return `${displayName} reached the model output limit before completing the request. Continue the session to keep working.`
  }

  if (stopReason === "max_turn_requests") {
    return `${displayName} reached its turn limit before completing the request. Continue the session to keep working.`
  }

  if (stopReason === "cancelled" && !signalAborted) {
    return `${displayName} stopped unexpectedly before completing the request. Retry or continue the session.`
  }

  return null
}
