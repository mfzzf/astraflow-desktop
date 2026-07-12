const MOBILE_CHANNEL_SETTING_KEYS = [
  "replyGranularity",
  "agentRuntimeId",
  "chatModel",
  "reasoningEffort",
  "permissionMode",
] as const

export function mergeMobileChannelRuntimeMetadata(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
) {
  const next = { ...current, ...patch }

  for (const key of MOBILE_CHANNEL_SETTING_KEYS) {
    if (Object.hasOwn(current, key)) {
      next[key] = current[key]
    } else {
      delete next[key]
    }
  }

  return next
}
