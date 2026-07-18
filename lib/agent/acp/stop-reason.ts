import type { StopReason } from "@agentclientprotocol/sdk"

export function getAcpStopReasonErrorMessage({
  displayName,
  signalAborted,
  stopReason,
}: {
  displayName: string
  signalAborted: boolean
  stopReason: StopReason
}) {
  if (stopReason === "max_tokens") {
    return `${displayName} reached the model output limit before completing the request. Continue the session to keep working.`
  }

  if (stopReason === "max_turn_requests") {
    return `${displayName} reached its turn limit before completing the request. Continue the session to keep working.`
  }

  if (stopReason === "refusal") {
    return `${displayName} declined to complete this request. Revise the request or choose a different agent.`
  }

  if (stopReason === "cancelled" && !signalAborted) {
    return `${displayName} stopped unexpectedly before completing the request. Retry or continue the session.`
  }

  return null
}
