const CANONICAL_TOOL_NAMES = new Map<string, string>([
  ["agent", "spawn_agent"],
  ["bash", "execute"],
  ["edit", "edit_file"],
  ["edit_file", "edit_file"],
  ["execute", "execute"],
  ["find", "glob"],
  ["glob", "glob"],
  ["grep", "grep"],
  ["list_files", "ls"],
  ["ls", "ls"],
  ["multiedit", "edit_file"],
  ["notebookedit", "edit_file"],
  ["read", "read_file"],
  ["read_file", "read_file"],
  ["run_command", "run_command"],
  ["shell", "shell"],
  ["spawnagent", "spawn_agent"],
  ["subagent", "spawn_agent"],
  ["task", "spawn_agent"],
  ["taskcreate", "update_plan"],
  ["taskget", "update_plan"],
  ["tasklist", "update_plan"],
  ["taskupdate", "update_plan"],
  ["plan", "update_plan"],
  ["todowrite", "update_plan"],
  ["update_plan", "update_plan"],
  ["write_todos", "update_plan"],
  ["webfetch", "web_fetch"],
  ["web_fetch", "web_fetch"],
  ["websearch", "web_search"],
  ["web_search", "web_search"],
  ["write", "write_file"],
  ["write_file", "write_file"],
])

function getLookupKey(toolName: string) {
  return toolName.trim().replace(/[\s-]+/g, "_").toLowerCase()
}

/**
 * Converts provider-specific built-in tool names to AstraFlow's small,
 * renderer-facing vocabulary. MCP and unknown names remain lossless so their
 * server/tool identity is still available to permission and activity UIs.
 */
export function normalizeAgentToolName(toolName: string) {
  const trimmed = toolName.trim()

  if (!trimmed || trimmed.toLowerCase().startsWith("mcp__")) {
    return trimmed || "tool"
  }

  const lookupKey = getLookupKey(trimmed)

  return (
    CANONICAL_TOOL_NAMES.get(lookupKey) ??
    CANONICAL_TOOL_NAMES.get(lookupKey.replaceAll("_", "")) ??
    trimmed
  )
}
