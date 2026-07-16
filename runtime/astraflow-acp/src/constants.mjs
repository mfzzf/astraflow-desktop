export const ASTRAFLOW_ACP_RUNTIME_VERSION = "0.1.0"
export const ASTRAFLOW_ACP_STATE_SCHEMA_VERSION = 2
export const ASTRAFLOW_ACP_MAX_HISTORY_MESSAGES = 400
export const ASTRAFLOW_ACP_MAX_STATE_BYTES = 8 * 1024 * 1024
export const ASTRAFLOW_ACP_RECURSION_LIMIT = 200

export const ASTRAFLOW_ACP_FEATURES = Object.freeze([
  "pi-agent",
  "pi-coding-tools",
  "planning",
  "subagents",
  "filesystem",
  "terminal",
  "permissions",
  "elicitation",
  "mcp-over-acp",
  "session-checkpoint",
  "session-resume",
])

export const ASTRAFLOW_ACP_BUILTIN_TOOL_NAMES = new Set([
  "bash",
  "edit",
  "find",
  "grep",
  "ls",
  "plan",
  "read",
  "request_user_input",
  "task",
  "write",
])

export function asErrorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

export function getRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null
}

export function stringify(value) {
  if (typeof value === "string") {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
