export type SynaraCommandVisualKind =
  | "inspect"
  | "git"
  | "github"
  | "terminal"

export type SynaraReadableCommandDisplay = {
  verb: string
  target: string
  fullCommand: string
}

const READ_TOOLS = new Set(["cat", "nl", "head", "tail", "sed", "less", "more"])
const SEARCH_TOOLS = new Set(["rg", "grep", "ag", "ack"])
const FIND_TOOLS = new Set(["find", "fd"])
const LIST_TOOLS = new Set(["ls"])

function unwrapQuoted(value: string) {
  const trimmed = value.trim()

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function unwrapShellCommand(value: string) {
  const trimmed = value.trim()
  const shellMatch = trimmed.match(
    /^(?:\/[^\s]+\/)?(?:zsh|bash|sh)\s+(?:-[a-zA-Z]*c|-c)\s+([\s\S]+)$/
  )

  return shellMatch ? unwrapQuoted(shellMatch[1] ?? "") : trimmed
}

function firstCommandSegment(value: string) {
  const withoutCd = value.replace(/^\s*cd\s+[^;&|]+\s*(?:&&|;)\s*/, "")

  return withoutCd.split(/\s*(?:&&|\|\||;|\|)\s*/, 1)[0]?.trim() ?? ""
}

function stripEnvironmentPrefix(value: string) {
  return value
    .replace(/^\s*(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)*/, "")
    .trim()
}

function splitToolAndArgs(rawCommand: string) {
  const command = stripEnvironmentPrefix(firstCommandSegment(unwrapShellCommand(rawCommand)))
  const match = command.match(/^(?:\/[^\s]+\/)?([^\s]+)(?:\s+([\s\S]*))?$/)

  return {
    command,
    tool: (match?.[1] ?? "").toLowerCase(),
    args: match?.[2]?.trim() ?? "",
  }
}

function nonOptionArgs(args: string) {
  return args
    .match(/(?:"[^"]*"|'[^']*'|\S+)/g)
    ?.map(unwrapQuoted)
    .filter((entry) => entry && !entry.startsWith("-")) ?? []
}

function lastPath(args: string, fallback: string) {
  const entries = nonOptionArgs(args)
  const target = entries.at(-1)

  if (!target || target === ".") {
    return fallback
  }

  const normalized = target.replace(/[\\/]+$/, "")
  const basename = normalized.split(/[\\/]/).at(-1)

  return basename || fallback
}

function compactCommand(command: string) {
  const collapsed = command.replace(/\s+/g, " ").trim()

  return collapsed.length > 72 ? `${collapsed.slice(0, 69).trimEnd()}...` : collapsed
}

function gitDisplay(args: string, rawCommand: string, running: boolean) {
  const subcommand = nonOptionArgs(args)[0]?.toLowerCase() ?? ""
  const labels: Record<string, [string, string, string]> = {
    status: ["Checking", "Checked", "git status"],
    diff: ["Comparing", "Compared", "changes"],
    log: ["Reviewing", "Reviewed", "git history"],
    show: ["Inspecting", "Inspected", "commit"],
    add: ["Staging", "Staged", "changes"],
    commit: ["Committing", "Committed", "changes"],
    push: ["Pushing", "Pushed", "changes"],
    pull: ["Pulling", "Pulled", "changes"],
  }
  const label = labels[subcommand]

  return {
    verb: label ? (running ? label[0] : label[1]) : running ? "Running" : "Ran",
    target: label?.[2] ?? compactCommand(`git ${args}`),
    fullCommand: rawCommand,
  }
}

export function deriveSynaraReadableCommandDisplay(
  rawCommand: string,
  running = false
): SynaraReadableCommandDisplay {
  const { command, tool, args } = splitToolAndArgs(rawCommand)

  if (READ_TOOLS.has(tool)) {
    return {
      verb: running ? "Reading" : "Read",
      target: lastPath(args, "file"),
      fullCommand: rawCommand,
    }
  }

  if (SEARCH_TOOLS.has(tool)) {
    const query = nonOptionArgs(args)[0]

    return {
      verb: running ? "Searching" : "Searched",
      target: query ? `for ${query}` : "files",
      fullCommand: rawCommand,
    }
  }

  if (LIST_TOOLS.has(tool)) {
    return {
      verb: running ? "Listing" : "Listed",
      target: lastPath(args, "directory"),
      fullCommand: rawCommand,
    }
  }

  if (FIND_TOOLS.has(tool)) {
    return {
      verb: running ? "Finding" : "Found",
      target: lastPath(args, "files"),
      fullCommand: rawCommand,
    }
  }

  if (tool === "git") {
    return gitDisplay(args, rawCommand, running)
  }

  return {
    verb: running ? "Running" : "Ran",
    target: compactCommand(command || rawCommand),
    fullCommand: rawCommand,
  }
}

export function resolveSynaraCommandVisualKind(
  rawCommand: string
): SynaraCommandVisualKind {
  const { tool } = splitToolAndArgs(rawCommand)

  if (
    READ_TOOLS.has(tool) ||
    SEARCH_TOOLS.has(tool) ||
    FIND_TOOLS.has(tool) ||
    LIST_TOOLS.has(tool)
  ) {
    return "inspect"
  }

  if (tool === "git") return "git"
  if (tool === "gh" || tool === "hub") return "github"

  return "terminal"
}
