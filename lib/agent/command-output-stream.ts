import type { AgentEvent } from "@/lib/agent/events"

// Bridges live command stdout/stderr from legacy sandbox backends (which only
// know the sessionId + command string) to the agent event queue (which owns the
// toolCallId). This module correlates both sides by session + command and
// relays throttled output snapshots. Pi tools stream through their own update
// callback and do not need this bridge.
//
// Commands are serialized per session (withStudioSessionLock), so at most one
// command runs at a time; correlation stays a small, race-tolerant handshake
// that works regardless of which side arrives first.

const STREAM_INTERVAL_MS = 150
const MAX_STREAM_OUTPUT_CHARS = 256 * 1024
const COMMAND_STREAM_TOOL_NAMES = new Set(["execute", "run_command"])

export function isCommandStreamToolName(name: string) {
  return COMMAND_STREAM_TOOL_NAMES.has(name)
}

type CommandStreamEmit = (event: AgentEvent) => void

export type ActiveCommandRun = {
  sessionId: string
  command: string
  toolCallId: string | null
  output: string
  truncated: boolean
  streamTimer: ReturnType<typeof setTimeout> | null
  settled: boolean
}

type SessionCommandStreamState = {
  emit: CommandStreamEmit
  activeRun: ActiveCommandRun | null
  pendingBindings: Array<{ toolCallId: string; command: string }>
}

// Survive module duplication (HMR / multiple bundles) like the ACP runtime.
const COMMAND_STREAM_KEY = Symbol.for("astraflow.commandOutputStream")
const globalRef = globalThis as typeof globalThis &
  Record<symbol, Map<string, SessionCommandStreamState> | undefined>
const sessions =
  globalRef[COMMAND_STREAM_KEY] ??
  (globalRef[COMMAND_STREAM_KEY] = new Map<
    string,
    SessionCommandStreamState
  >())

function clearRunTimer(run: ActiveCommandRun) {
  if (run.streamTimer) {
    clearTimeout(run.streamTimer)
    run.streamTimer = null
  }
}

function flushCommandOutput(
  state: SessionCommandStreamState,
  run: ActiveCommandRun
) {
  if (run.toolCallId === null || run.settled) {
    return
  }

  state.emit({
    type: "tool_output",
    id: run.toolCallId,
    name: "execute",
    output: run.output,
  })
}

function scheduleCommandOutputFlush(run: ActiveCommandRun) {
  const state = sessions.get(run.sessionId)

  if (!state || run.toolCallId === null || run.streamTimer || run.settled) {
    return
  }

  run.streamTimer = setTimeout(() => {
    run.streamTimer = null
    flushCommandOutput(state, run)
  }, STREAM_INTERVAL_MS)
  run.streamTimer.unref?.()
}

// Registers the event sink for a session's assistant run. Returns an
// unregister function to call when the run ends.
export function registerSessionCommandSink(
  sessionId: string,
  emit: CommandStreamEmit
) {
  const state: SessionCommandStreamState = {
    emit,
    activeRun: null,
    pendingBindings: [],
  }

  sessions.set(sessionId, state)

  return () => {
    const current = sessions.get(sessionId)

    if (current === state) {
      if (current.activeRun) {
        clearRunTimer(current.activeRun)
      }

      sessions.delete(sessionId)
    }
  }
}

// Called from the tool-call pump when a command tool call appears, before its
// output settles. Binds the toolCallId to the matching in-flight run (flushing
// any buffered output), or parks it until the run starts.
export function bindCommandToolCall(
  sessionId: string,
  toolCallId: string,
  command: string
) {
  const state = sessions.get(sessionId)

  if (!state) {
    return
  }

  const run = state.activeRun

  if (run && run.toolCallId === null && run.command === command) {
    run.toolCallId = toolCallId
    flushCommandOutput(state, run)
    return
  }

  state.pendingBindings.push({ toolCallId, command })
}

// Called after a command tool call settles (tool_result emitted). Drops any
// parked binding and stops streaming, since the final output is authoritative.
export function unbindCommandToolCall(sessionId: string, toolCallId: string) {
  const state = sessions.get(sessionId)

  if (!state) {
    return
  }

  state.pendingBindings = state.pendingBindings.filter(
    (binding) => binding.toolCallId !== toolCallId
  )

  if (state.activeRun && state.activeRun.toolCallId === toolCallId) {
    clearRunTimer(state.activeRun)
  }
}

// Called by the backend when it starts executing a command. Returns a run
// handle to feed output into, or null when no sink is registered (in which
// case the backend runs without streaming callbacks).
export function beginCommandRun(
  sessionId: string,
  command: string
): ActiveCommandRun | null {
  const state = sessions.get(sessionId)

  if (!state) {
    return null
  }

  const run: ActiveCommandRun = {
    sessionId,
    command,
    toolCallId: null,
    output: "",
    truncated: false,
    streamTimer: null,
    settled: false,
  }

  const bindingIndex = state.pendingBindings.findIndex(
    (binding) => binding.command === command
  )

  if (bindingIndex >= 0) {
    run.toolCallId = state.pendingBindings[bindingIndex].toolCallId
    state.pendingBindings.splice(bindingIndex, 1)
  }

  state.activeRun = run

  return run
}

export function appendCommandOutput(run: ActiveCommandRun, chunk: string) {
  if (!chunk || run.settled) {
    return
  }

  const next = run.output + chunk

  if (next.length > MAX_STREAM_OUTPUT_CHARS) {
    run.output = next.slice(next.length - MAX_STREAM_OUTPUT_CHARS)
    run.truncated = true
  } else {
    run.output = next
  }

  scheduleCommandOutputFlush(run)
}

export function endCommandRun(sessionId: string, run: ActiveCommandRun) {
  run.settled = true
  clearRunTimer(run)

  const state = sessions.get(sessionId)

  if (state && state.activeRun === run) {
    state.activeRun = null
  }
}
