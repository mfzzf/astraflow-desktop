export const CLIENT_ANALYTICS_EVENT = "astraflow:analytics"

export type ClientAnalyticsEventType = "agent" | "session"

export type ClientAnalyticsEventInput = {
  eventId?: string
  eventName: string
  eventType: ClientAnalyticsEventType
  targetId?: string
  targetLabel?: string
}

export function trackClientAnalyticsEvent(input: ClientAnalyticsEventInput) {
  if (typeof window === "undefined") return

  window.dispatchEvent(
    new CustomEvent<ClientAnalyticsEventInput>(CLIENT_ANALYTICS_EVENT, {
      detail: input,
    })
  )
}
