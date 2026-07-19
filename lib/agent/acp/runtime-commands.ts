import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"
import { getCodexAcpRuntimeCommands } from "@/lib/agent/acp/codex-features"

export const COMMAND_CAPABLE_ACP_RUNTIME_IDS = new Set([
  "codex",
  "claude-code",
  "opencode",
])

const ACP_COMPACT_RUNTIME_IDS = new Set(["claude-code", "opencode"])

export function mergeAcpRuntimeCommands(
  commands: SlashCommandDescriptor[]
): SlashCommandDescriptor[] {
  const seen = new Set<string>()
  const merged: SlashCommandDescriptor[] = []

  for (const command of commands) {
    const name = command.name.trim().replace(/^\/+/, "")
    const key = name.toLowerCase()

    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push({ ...command, name })
  }

  return merged
}

export function getStaticAcpRuntimeCommands(
  runtimeId: string
): SlashCommandDescriptor[] {
  if (runtimeId === "codex") {
    return getCodexAcpRuntimeCommands()
  }

  return ACP_COMPACT_RUNTIME_IDS.has(runtimeId)
    ? [
        {
          name: "compact",
          description: "Compact conversation context",
          source: "runtime",
          runtimeId,
        },
      ]
    : []
}

export async function materializeAcpRuntimeCommands({
  activate,
  announcedCommands,
  prepare,
  runtimeId,
  sessionId,
}: {
  activate: () => Promise<
    | {
        phase: "initialized" | "session"
        session: { availableCommands: SlashCommandDescriptor[] }
      }
    | null
  >
  announcedCommands: SlashCommandDescriptor[]
  prepare: () => Promise<unknown>
  runtimeId: string
  sessionId: string
}) {
  if (
    !sessionId ||
    !COMMAND_CAPABLE_ACP_RUNTIME_IDS.has(runtimeId) ||
    announcedCommands.length > 0
  ) {
    return announcedCommands
  }

  try {
    await prepare()
    const snapshot = await activate()

    return snapshot?.phase === "session"
      ? snapshot.session.availableCommands
      : announcedCommands
  } catch {
    // Static recovery commands remain available while authentication, runtime
    // installation, or the remote workspace is temporarily unavailable.
    return announcedCommands
  }
}
