export function formatClaudeHookTitle(hookEvent: string, hookName: string) {
  const event = hookEvent.trim() || "hook"
  const name = hookName.trim() || "Hook"
  const normalizedEvent = event.toLowerCase()
  const normalizedName = name.toLowerCase()

  if (normalizedName === normalizedEvent) {
    return event
  }

  if (normalizedName.startsWith(`${normalizedEvent}:`)) {
    return `${event}: ${name.slice(event.length + 1).trim()}`
  }

  return `${event}: ${name}`
}

export function getClaudeHookTarget(hookEvent: string, hookName: string) {
  const event = hookEvent.trim()
  const name = hookName.trim()

  if (!event || !name) {
    return name
  }

  const prefix = `${event}:`

  return name.toLowerCase().startsWith(prefix.toLowerCase())
    ? name.slice(prefix.length).trim()
    : name
}
