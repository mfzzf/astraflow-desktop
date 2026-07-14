export const ASTRAFLOW_ACP_RUNTIME_VERSION = "0.1.0"
export const ASTRAFLOW_ACP_STATE_SCHEMA_VERSION = 1
export const ASTRAFLOW_ACP_MAX_HISTORY_MESSAGES = 400
export const ASTRAFLOW_ACP_MAX_STATE_BYTES = 8 * 1024 * 1024
export const ASTRAFLOW_ACP_RECURSION_LIMIT = 200

export const ASTRAFLOW_ACP_FEATURES = Object.freeze([
  "deepagents",
  "langgraph",
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
  "edit_file",
  "execute",
  "glob",
  "grep",
  "ls",
  "read_file",
  "request_user_input",
  "task",
  "write_file",
  "write_todos",
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
