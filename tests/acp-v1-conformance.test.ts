// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import type {
  ActiveSession,
  ClientConnection,
  ContentBlock,
} from "@agentclientprotocol/sdk"
import { agent, methods, RequestError } from "@agentclientprotocol/sdk"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  applyLineWindow,
  createAcpClientApp,
  createAcpTraceparent,
  createAcpUtf8ChunkDecoder,
  createAcpMapperReplayState,
  createAcpPreparationBarrier,
  filePathToAcpUri,
  formatAcpErrorMessage,
  getAcpWorkspace,
  getAcpCompactCommand,
  getAcpTransportCookieStoreKey,
  initializeAcpConnection,
  invalidateAcpPreparationRegistryEntries,
  isAcpRuntimeSessionKey,
  mapAcpSessionUpdatesForReplay,
  messageContentToBlocks,
  performAcpLogout,
  sendAcpPrompt,
  shouldFallbackFromAcpSessionRestore,
  startAcpSessionWithAuthentication,
  supportsAcpPromptImage,
  terminateChild,
  trimUtf8BytesFromStart,
  waitForAcpTerminalExit,
} from "@/lib/agent/acp/acp-runtime"
import {
  getAcpSessionInfoPresentation,
  getClaudeRateLimitPresentation,
} from "@/lib/agent/acp/session-presentation"
import {
  getSandboxLocalSettingsError,
  probeCodexAcpCommand,
} from "@/lib/agent/adapters/acp-runtimes"
import { isAcpPermissionModeProcessScoped } from "@/lib/agent/permission-policy"
import { sanitizeAgentStructuredValue } from "@/lib/agent/structured-content"

function fakeConnection(
  response: unknown,
  onRequest?: (params: unknown) => void
) {
  return {
    agent: {
      request: async (_method: string, params: unknown) => {
        onRequest?.(params)
        return response
      },
    },
  } as unknown as ClientConnection
}

describe("ACP v1 client conformance", () => {
  test("keeps remote POSIX workspace roots unchanged", () => {
    expect(
      getAcpWorkspace({
        environment: "remote",
        sessionId: "sandbox-session",
        workspaceRoot: "/workspace/project",
      } as Parameters<typeof getAcpWorkspace>[0])
    ).toBe("/workspace/project")
  })

  test("keeps process-scoped permission posture separate from ACP behavior modes", () => {
    expect(isAcpPermissionModeProcessScoped("astraflow")).toBeTrue()
    expect(isAcpPermissionModeProcessScoped("opencode")).toBeTrue()
    expect(isAcpPermissionModeProcessScoped("codex")).toBeFalse()
    expect(isAcpPermissionModeProcessScoped("claude-code")).toBeFalse()
  })

  test("rejects Mac-local CLI settings before starting a Sandbox agent", () => {
    expect(
      getSandboxLocalSettingsError({
        environment: "remote",
        label: "Claude Code",
        useLocalSettings: true,
      })
    ).toContain("cannot use this Mac's local CLI settings")
    expect(
      getSandboxLocalSettingsError({
        environment: "local",
        label: "Claude Code",
        useLocalSettings: true,
      })
    ).toBeNull()
    expect(
      getSandboxLocalSettingsError({
        environment: "remote",
        label: "Claude Code",
        useLocalSettings: false,
      })
    ).toBeNull()
  })

  test("releases a first prompt that overlaps slow prepared initialization", async () => {
    const barrier = createAcpPreparationBarrier()
    let sessionStarts = 0
    const promptStart = barrier.requestSessionStart()

    await Promise.resolve()
    expect(sessionStarts).toBe(0)

    barrier.resolvePrepared({
      requestSessionStart: async () => {
        sessionStarts += 1
      },
    })

    await promptStart
    expect(sessionStarts).toBe(1)
  })

  test("duplicate prepare callers wait only for prepared-ready", async () => {
    const barrier = createAcpPreparationBarrier()
    let sessionStarts = 0
    const firstPrepare = barrier.ready
    const secondPrepare = barrier.ready

    barrier.resolvePrepared({
      requestSessionStart: async () => {
        sessionStarts += 1
      },
    })

    const [first, second] = await Promise.all([firstPrepare, secondPrepare])
    expect(first).toBe(second)
    expect(sessionStarts).toBe(0)
  })

  test("scopes runtime resets to the previous runtime and studio session", () => {
    const key = [
      "claude-code",
      "studio-session",
      "/workspace",
      "claude-sonnet",
      "plugins",
    ].join("\0")

    expect(
      isAcpRuntimeSessionKey(key, "claude-code", "studio-session")
    ).toBeTrue()
    expect(isAcpRuntimeSessionKey(key, "codex", "studio-session")).toBeFalse()
    expect(
      isAcpRuntimeSessionKey(key, "claude-code", "other-session")
    ).toBeFalse()
  })

  test("disposes a slow stale preparation when context changes from A to B", async () => {
    type Prepared = {
      context: string
      requestSessionStart: () => Promise<void>
    }
    const keyA = "runtime\0session\0workspace\0model-a"
    const keyB = "runtime\0session\0workspace\0model-b"
    const disposed: string[] = []
    const controlTargets = new Map<string, Prepared>()
    const preparationA = createAcpPreparationBarrier<Prepared>({
      onStale: (state) => {
        disposed.push(`prepared:${state.context}`)
        controlTargets.delete(keyA)
      },
    })
    const waitingForA = preparationA.ready
    const preparationB = createAcpPreparationBarrier<Prepared>()
    const coordinators = new Map([
      [keyA, preparationA],
      [keyB, preparationB],
    ])
    let resolveStartupA!: (state: Prepared) => void
    const startupA = new Promise<Prepared>((resolve) => {
      resolveStartupA = resolve
    })
    const startupB = Promise.resolve({
      context: "B",
      requestSessionStart: async () => undefined,
    })
    const startups = new Map([
      [keyA, startupA],
      [keyB, startupB],
    ])
    const stateB = {
      context: "B",
      requestSessionStart: async () => undefined,
    }

    controlTargets.set(keyB, stateB)
    preparationB.resolvePrepared({
      context: "B",
      requestSessionStart: async () => undefined,
    })

    invalidateAcpPreparationRegistryEntries({
      coordinators,
      disposeStartup: (key, state) => {
        disposed.push(`startup:${state.context}`)
        controlTargets.delete(key)
      },
      isStale: (key) => key !== keyB,
      reason: "context B superseded context A",
      startups,
    })

    const lateA = {
      context: "A",
      requestSessionStart: async () => undefined,
    }
    // Mirrors createAcpSession publishing into the control registry immediately
    // before its onPrepared callback fires after a slow initialize.
    controlTargets.set(keyA, lateA)
    preparationA.resolvePrepared(lateA)
    resolveStartupA(lateA)

    await expect(waitingForA).rejects.toThrow("superseded")
    await startupA
    await Promise.resolve()
    expect((await preparationB.ready).context).toBe("B")
    expect(coordinators.has(keyA)).toBeFalse()
    expect(startups.has(keyA)).toBeFalse()
    expect(controlTargets.has(keyA)).toBeFalse()
    expect([...controlTargets.values()].at(-1)?.context).toBe("B")
    expect(disposed).toEqual(["prepared:A", "startup:A"])
  })

  test("rejects an initialize response newer than the client supports", async () => {
    await expect(
      initializeAcpConnection(
        fakeConnection({ protocolVersion: 2, agentCapabilities: {} })
      )
    ).rejects.toThrow("supports versions through 1")
  })

  test("accepts an initialize response negotiated to an older version", async () => {
    await expect(
      initializeAcpConnection(
        fakeConnection({ protocolVersion: 0, agentCapabilities: {} })
      )
    ).resolves.toMatchObject({ protocolVersion: 0 })
  })

  test("advertises only local workspace capabilities on local transports", async () => {
    const requests: Record<string, unknown>[] = []
    const response = { protocolVersion: 1, agentCapabilities: {} }

    await initializeAcpConnection(
      fakeConnection(response, (params) => {
        requests.push(params as Record<string, unknown>)
      })
    )
    await initializeAcpConnection(
      fakeConnection(response, (params) => {
        requests.push(params as Record<string, unknown>)
      }),
      { remoteWorkspace: true }
    )

    const [localRequest, remoteRequest] = requests

    expect(localRequest.clientCapabilities).toMatchObject({
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
    })
    expect(remoteRequest.clientCapabilities).toMatchObject({
      fs: { readTextFile: false, writeTextFile: false },
      terminal: false,
    })
    expect(localRequest.clientInfo).toMatchObject({
      name: "AstraFlow Desktop",
      title: "AstraFlow Desktop",
      version: "1.5.2",
    })
    expect(localRequest.clientCapabilities).toMatchObject({
      elicitation: { form: {} },
    })
    expect(localRequest.clientCapabilities).toMatchObject({
      auth: { terminal: false },
    })
    expect(
      (localRequest.clientCapabilities as Record<string, unknown>).auth
    ).not.toHaveProperty("_meta")
    expect(
      (localRequest.clientCapabilities as Record<string, unknown>).elicitation
    ).not.toHaveProperty("url")
  })

  test("treats omitted prompt media capabilities as unsupported", () => {
    expect(supportsAcpPromptImage()).toBeFalse()
    expect(supportsAcpPromptImage({})).toBeFalse()
    expect(supportsAcpPromptImage({ image: true })).toBeTrue()

    const part = {
      type: "image_url",
      image_url: { url: "data:image/png;base64,aGVsbG8=" },
    }
    const omitted = messageContentToBlocks([part] as never, {})
    const supported = messageContentToBlocks([part] as never, { image: true })

    expect(omitted).toEqual([
      {
        type: "text",
        text: "[image attachment omitted: agent does not advertise image prompt support]",
      },
    ])
    expect(supported).toEqual([
      {
        type: "image",
        mimeType: "image/png",
        data: "aGVsbG8=",
      },
    ])
  })

  test("binds generic JSON-RPC request cancellation to session/prompt", async () => {
    const controller = new AbortController()
    let cancellationSignal: AbortSignal | undefined
    const session = {
      prompt: async (
        _blocks: ContentBlock[],
        options?: { cancellationSignal?: AbortSignal }
      ) => {
        cancellationSignal = options?.cancellationSignal
        return { stopReason: "cancelled" as const }
      },
    } as unknown as ActiveSession

    await sendAcpPrompt(
      session,
      [{ type: "text", text: "cancel me" }],
      controller.signal
    )

    expect(cancellationSignal).toBe(controller.signal)
  })

  test("authenticates and retries session setup after auth_required", async () => {
    let starts = 0
    const authenticationRequests: unknown[] = []
    const activeSession = { sessionId: "acp-session" } as ActiveSession
    const connection = {
      agent: {
        request: async (_method: unknown, params: unknown) => {
          authenticationRequests.push(params)
          return {}
        },
        buildSession: () => ({
          start: async () => {
            starts += 1

            if (starts === 1) {
              throw RequestError.authRequired()
            }

            return activeSession
          },
        }),
      },
    } as unknown as ClientConnection

    const result = await startAcpSessionWithAuthentication({
      additionalDirectories: [],
      connection,
      initializeResponse: {
        protocolVersion: 1,
        agentCapabilities: {},
        authMethods: [{ id: "agent-login", name: "Agent login" }],
      },
      mcpServers: [],
      sessionMeta: null,
      storedSessionRef: null,
      workspace: "/workspace",
    })

    expect(result.activeSession).toBe(activeSession)
    expect(starts).toBe(2)
    expect(authenticationRequests).toEqual([{ methodId: "agent-login" }])
  })

  test("does not replace an explicitly selected agent session on restore failure", () => {
    expect(
      shouldFallbackFromAcpSessionRestore({
        storedSessionRef: "selected-session",
        strict: true,
      })
    ).toBeFalse()
    expect(
      shouldFallbackFromAcpSessionRestore({
        storedSessionRef: "automatic-session",
        strict: false,
      })
    ).toBeTrue()
    expect(
      shouldFallbackFromAcpSessionRestore({
        storedSessionRef: null,
        strict: false,
      })
    ).toBeFalse()
  })

  test("isolates remote transport cookies by session and connection identity", () => {
    const command = {
      transport: "http" as const,
      url: "https://agent.example/acp",
      headers: { Authorization: "Bearer one" },
    }
    const first = getAcpTransportCookieStoreKey(command, "studio-session-one")

    expect(first).toBe(
      getAcpTransportCookieStoreKey(command, "studio-session-one")
    )
    expect(first).not.toBe(
      getAcpTransportCookieStoreKey(command, "studio-session-two")
    )
    expect(first).not.toBe(
      getAcpTransportCookieStoreKey(
        { ...command, url: "https://agent.example/other" },
        "studio-session-one"
      )
    )
    expect(first).not.toBe(
      getAcpTransportCookieStoreKey(
        { ...command, headers: { Authorization: "Bearer two" } },
        "studio-session-one"
      )
    )
  })

  test("logout clears transport credentials and disposes only after agent success", async () => {
    const completed: string[] = []

    await expect(
      performAcpLogout({
        supported: true,
        request: async () => {
          completed.push("request")
          return { loggedOut: true }
        },
        clearCookies: async () => {
          completed.push("cookies")
        },
        dispose: () => {
          completed.push("dispose")
        },
      })
    ).resolves.toEqual({ loggedOut: true })
    expect(completed).toEqual(["request", "cookies", "dispose"])

    completed.length = 0
    await expect(
      performAcpLogout({
        supported: true,
        request: async () => {
          completed.push("request")
          throw new Error("logout failed")
        },
        clearCookies: async () => {
          completed.push("cookies")
        },
        dispose: () => {
          completed.push("dispose")
        },
      })
    ).rejects.toThrow("logout failed")
    expect(completed).toEqual(["request"])

    await expect(
      performAcpLogout({
        supported: false,
        request: async () => ({}),
        clearCookies: async () => undefined,
        dispose: () => undefined,
      })
    ).rejects.toThrow("does not advertise logout")
  })

  test("escalates to SIGKILL when an ACP child ignores SIGTERM", async () => {
    const signals: NodeJS.Signals[] = []
    let killed = false
    const child = {
      exitCode: null,
      signalCode: null,
      get killed() {
        return killed
      },
      kill(signal: NodeJS.Signals) {
        signals.push(signal)
        killed = true
        return true
      },
    } as unknown as ChildProcessWithoutNullStreams

    terminateChild(child, 1)
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(signals).toEqual(["SIGTERM", "SIGKILL"])
  })

  test("preserves standard message IDs and non-text content blocks", () => {
    const resource = {
      type: "resource_link",
      uri: "file:///workspace/spec.md",
      name: "spec.md",
      annotations: { audience: ["user"] },
      _meta: { vendor: { stable: true } },
    } satisfies ContentBlock
    const events = mapAcpSessionUpdatesForReplay(
      [
        {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-1",
          content: { type: "text", text: "one" },
          _meta: { codex: { phase: "commentary" } },
        },
        {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-2",
          content: { type: "text", text: "two" },
          _meta: { codex: { phase: "final_answer" } },
        },
        {
          sessionUpdate: "agent_message_chunk",
          messageId: "message-2",
          content: resource,
          _meta: { codex: { phase: "final_answer" } },
        },
      ],
      createAcpMapperReplayState()
    )
    const messageEvents = events.filter((event) => event.type !== "run_meta")

    expect(messageEvents).toEqual([
      {
        type: "text_delta",
        delta: "one",
        messageId: "message-1",
        phase: "commentary",
      },
      {
        type: "text_delta",
        delta: "two",
        messageId: "message-2",
        phase: "final_answer",
      },
      {
        type: "content_block",
        channel: "message",
        messageId: "message-2",
        phase: "final_answer",
        content: resource,
      },
    ])
  })

  test("normalizes Codex context compaction into one tool lifecycle", () => {
    const events = mapAcpSessionUpdatesForReplay([
      {
        sessionUpdate: "tool_call",
        toolCallId: "codex-compaction",
        kind: "other",
        title: "Context compacting",
        status: "in_progress",
        _meta: { contextCompaction: true },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "codex-compaction",
        title: "Context compacted",
        status: "completed",
        _meta: { contextCompaction: true },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "*Context compacted to fit the model's context window.*\n\n",
        },
      },
    ]).filter((event) => event.type !== "run_meta")

    expect(events.map((event) => event.type)).toEqual([
      "tool_call",
      "tool_update",
      "tool_result",
    ])
    expect(events[0]).toMatchObject({
      type: "tool_call",
      id: "codex-compaction",
      name: "context_compaction",
    })
    expect(events.at(-1)).toMatchObject({
      type: "tool_result",
      id: "codex-compaction",
      name: "context_compaction",
      status: "complete",
    })
  })

  test("promotes Claude compact status text to structured progress", () => {
    const completed = mapAcpSessionUpdatesForReplay([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Compacting..." },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "\n\nCompacting completed." },
      },
    ])

    expect(completed).toEqual([
      expect.objectContaining({
        type: "tool_call",
        id: "acp-context-compaction-1",
        name: "context_compaction",
      }),
      expect.objectContaining({
        type: "tool_result",
        id: "acp-context-compaction-1",
        name: "context_compaction",
        status: "complete",
      }),
    ])

    const failed = mapAcpSessionUpdatesForReplay([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Compacting..." },
      },
      {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: "\n\nCompacting failed: summary model unavailable",
        },
      },
    ])

    expect(failed.at(-1)).toMatchObject({
      type: "tool_result",
      name: "context_compaction",
      status: "error",
      error: "summary model unavailable",
    })
    expect(failed.some((event) => event.type === "text_delta")).toBe(false)
  })

  test("routes ACP compact commands to the runtime, including OpenCode", () => {
    const state = createAcpMapperReplayState()

    state.runtimeId = "opencode"

    const event = mapAcpSessionUpdatesForReplay(
      [
        {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "review", description: "Review changes" },
          ],
        },
      ],
      state
    ).find((candidate) => candidate.type === "available-commands")

    expect(event).toMatchObject({
      type: "available-commands",
      commands: [
        { name: "review", source: "runtime", runtimeId: "opencode" },
        { name: "compact", source: "runtime", runtimeId: "opencode" },
      ],
    })
    expect(
      getAcpCompactCommand([
        { role: "assistant", content: "previous" },
        { role: "user", content: "/compact keep API decisions" },
      ])
    ).toEqual({ instructions: "keep API decisions" })

    const compactingState = createAcpMapperReplayState()

    compactingState.runtimeId = "opencode"
    const compactingEvents = mapAcpSessionUpdatesForReplay(
      [
        {
          sessionUpdate: "tool_call",
          toolCallId: "opencode-compaction",
          title: "Context compaction",
          status: "in_progress",
          _meta: { opencode: { partType: "compaction" } },
        },
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "internal summary text" },
        },
      ],
      compactingState
    )

    expect(
      compactingEvents.some((candidate) => candidate.type === "text_delta")
    ).toBe(false)
  })

  test("attributes provider child tool calls to their parent task", () => {
    const events = mapAcpSessionUpdatesForReplay([
      {
        sessionUpdate: "tool_call",
        toolCallId: "child-tool",
        title: "Read",
        kind: "read",
        status: "pending",
        rawInput: { path: "/workspace/README.md" },
        _meta: {
          claudeCode: {
            toolName: "Read",
            parentToolUseId: "parent-task",
          },
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "child-tool",
        status: "completed",
        rawOutput: { content: [{ type: "text", text: "done" }] },
        _meta: {
          claudeCode: {
            toolName: "Read",
            parentToolUseId: "parent-task",
          },
        },
      },
      {
        sessionUpdate: "tool_call",
        toolCallId: "astraflow-child-tool",
        title: "Bash",
        kind: "execute",
        status: "pending",
        rawInput: { command: "pwd" },
        _meta: {
          astraflow: {
            parentTaskId: "astraflow-parent-task",
            subagent: "task",
          },
        },
      },
    ])

    expect(
      events
        .filter(
          (event) =>
            event.type === "tool_call" ||
            event.type === "tool_update" ||
            event.type === "tool_result"
        )
        .map((event) => event.parentTaskId)
    ).toEqual([
      "parent-task",
      "parent-task",
      "parent-task",
      "astraflow-parent-task",
    ])
  })

  test("maps Synara-style ACP subagent identities and lifecycle updates", () => {
    const events = mapAcpSessionUpdatesForReplay([
      {
        sessionUpdate: "tool_call",
        toolCallId: "spawn-1",
        title: "spawn_agent",
        kind: "other",
        status: "in_progress",
        rawInput: {
          prompt: "Inspect the chat renderer",
          requestedModel: "gpt-5.4-mini",
          receiverAgents: [
            {
              threadId: "child-thread-1",
              agentId: "agent-1",
              agentNickname: "Locke",
              agentRole: "explorer",
              effort: "high",
              background: true,
            },
          ],
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "spawn-1",
        status: "completed",
        rawOutput: {
          agentStates: {
            "child-thread-1": {
              status: "completed",
              summary: "Renderer inspected",
            },
          },
        },
      },
    ])

    expect(events.filter((event) => event.type.startsWith("subagent_"))).toEqual([
      {
        type: "subagent_start",
        taskId: "spawn-1",
        name: "Locke",
        taskInput: "Inspect the chat renderer",
        providerThreadId: "child-thread-1",
        agentId: "agent-1",
        nickname: "Locke",
        role: "explorer",
        model: "gpt-5.4-mini",
        effort: "high",
        background: true,
      },
      {
        type: "subagent_end",
        taskId: "spawn-1",
        name: "Locke",
        status: "complete",
        summary: "Renderer inspected",
        taskInput: "Inspect the chat renderer",
        providerThreadId: "child-thread-1",
        agentId: "agent-1",
        nickname: "Locke",
        role: "explorer",
        model: "gpt-5.4-mini",
        effort: "high",
        background: true,
      },
    ])
  })

  test("correlates ACP subagent updates by agent id across provider items", () => {
    const events = mapAcpSessionUpdatesForReplay([
      {
        sessionUpdate: "tool_call",
        toolCallId: "spawn-by-agent-id",
        title: "spawn_agent",
        kind: "other",
        status: "in_progress",
        rawInput: {
          receiverAgents: [
            {
              threadId: "child-thread-agent-id",
              agentId: "stable-agent-id",
              nickname: "Ada",
            },
          ],
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "provider-status-item",
        status: "completed",
        rawOutput: {
          agentId: "stable-agent-id",
          status: "completed",
          summary: "Finished through an agent-only status item",
        },
      },
    ]).filter(
      (
        event
      ): event is Extract<
        (typeof event),
        { type: "subagent_start" | "subagent_update" | "subagent_end" }
      > => event.type.startsWith("subagent_")
    )

    expect(events.map((event) => [event.type, event.taskId])).toEqual([
      ["subagent_start", "spawn-by-agent-id"],
      ["subagent_end", "spawn-by-agent-id"],
    ])
  })

  test("preserves an actual model over requested hints and maps stopped agents", () => {
    const events = mapAcpSessionUpdatesForReplay([
      {
        sessionUpdate: "tool_call",
        toolCallId: "spawn-stopped",
        title: "spawn_agent",
        kind: "other",
        status: "in_progress",
        rawInput: {
          receiverAgents: [
            {
              threadId: "child-thread-stopped",
              agentId: "agent-stopped",
              model: "actual-model",
            },
          ],
        },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "spawn-stopped",
        status: "in_progress",
        rawOutput: {
          agentStates: {
            "child-thread-stopped": {
              status: "stopped",
              requestedModel: "requested-model",
            },
          },
        },
      },
    ]).filter((event) => event.type.startsWith("subagent_"))

    expect(events.at(-1)).toMatchObject({
      type: "subagent_end",
      taskId: "spawn-stopped",
      status: "cancelled",
      model: "actual-model",
    })
  })

  test("surfaces structured Codex ACP error details", () => {
    const error = RequestError.internalError({
      message: "The upstream request failed.",
      additionalDetails: "Retry after reducing the prompt.",
      codexErrorInfo: {
        httpConnectionFailed: { httpStatusCode: 429 },
      },
    })

    expect(formatAcpErrorMessage(error)).toContain(
      "The upstream request failed."
    )
    expect(formatAcpErrorMessage(error)).toContain(
      "Retry after reducing the prompt."
    )
    expect(formatAcpErrorMessage(error)).toContain(
      "Codex error: httpConnectionFailed (HTTP 429)"
    )
  })

  test("keeps independent plan identities and removal semantics", () => {
    const stablePlan = mapAcpSessionUpdatesForReplay([
      {
        sessionUpdate: "plan",
        entries: [
          {
            content: "Follow the stable plan",
            priority: "high",
            status: "in_progress",
            _meta: { vendorEntry: true },
          },
        ],
        _meta: { vendorPlan: true },
      },
    ]).find((event) => event.type === "plan_update")
    const events = mapAcpSessionUpdatesForReplay([
      {
        sessionUpdate: "plan_update",
        plan: {
          type: "markdown",
          planId: "first",
          content: "# First",
          _meta: { vendor: "plan" },
        },
      },
      {
        sessionUpdate: "plan_update",
        plan: {
          type: "file",
          planId: "second",
          uri: "file:///workspace/PLAN.md",
        },
      },
      { sessionUpdate: "plan_removed", planId: "first" },
    ])

    expect(stablePlan).toMatchObject({
      type: "plan_update",
      planId: "acp:stable-plan",
      meta: { vendorPlan: true },
      todos: [{ meta: { vendorEntry: true } }],
    })
    expect(events[0]).toMatchObject({
      type: "plan_update",
      planId: "first",
      variant: "markdown",
      content: "# First",
      meta: { vendor: "plan" },
    })
    expect(events[1]).toEqual({
      type: "plan_update",
      planId: "second",
      variant: "file",
      uri: "file:///workspace/PLAN.md",
      todos: [],
    })
    expect(events[2]).toEqual({ type: "plan_remove", planId: "first" })
  })

  test("turns Claude Task tools into a persistent structured plan", () => {
    const state = createAcpMapperReplayState()

    state.runtimeId = "claude-code"

    const events = mapAcpSessionUpdatesForReplay(
      [
        {
          sessionUpdate: "tool_call",
          toolCallId: "create-1",
          title: "TaskCreate",
          kind: "other",
          status: "in_progress",
          rawInput: {
            subject: "Inspect the repository",
            description: "Find the relevant Claude integration.",
          },
          _meta: { claudeCode: { toolName: "TaskCreate" } },
        },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "create-1",
          title: "TaskCreate",
          status: "completed",
          rawOutput: {
            task: {
              id: "1",
              subject: "Inspect the repository",
              status: "pending",
            },
          },
          _meta: { claudeCode: { toolName: "TaskCreate" } },
        },
        {
          sessionUpdate: "tool_call",
          toolCallId: "update-1",
          title: "TaskUpdate",
          kind: "other",
          status: "completed",
          rawInput: { taskId: "1", status: "in_progress" },
          _meta: { claudeCode: { toolName: "TaskUpdate" } },
        },
      ],
      state
    ).filter((event) => event.type === "plan_update")

    expect(events).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({
      type: "plan_update",
      planId: "claude:tasks",
      variant: "items",
      todos: [
        {
          text: "Inspect the repository",
          status: "in_progress",
        },
      ],
      meta: { claudeCode: { source: "task-tools" } },
    })
  })

  test("reconciles Claude TaskList snapshots and deletions", () => {
    const state = createAcpMapperReplayState()

    state.runtimeId = "claude-code"

    const events = mapAcpSessionUpdatesForReplay(
      [
        {
          sessionUpdate: "tool_call",
          toolCallId: "list-1",
          title: "TaskList",
          kind: "other",
          status: "completed",
          rawOutput: {
            tasks: [
              { id: "1", subject: "First", status: "completed" },
              { id: "2", subject: "Second", status: "pending" },
            ],
          },
          _meta: { claudeCode: { toolName: "TaskList" } },
        },
        {
          sessionUpdate: "tool_call",
          toolCallId: "delete-2",
          title: "TaskUpdate",
          kind: "other",
          status: "completed",
          rawInput: { taskId: "2", status: "deleted" },
          _meta: { claudeCode: { toolName: "TaskUpdate" } },
        },
      ],
      state
    ).filter((event) => event.type === "plan_update")

    expect(events.at(-1)).toMatchObject({
      todos: [{ text: "First", status: "completed" }],
    })
  })

  test("applies agent-pushed mode and config option snapshots", () => {
    const state = createAcpMapperReplayState()
    const events = mapAcpSessionUpdatesForReplay(
      [
        {
          sessionUpdate: "current_mode_update",
          currentModeId: "plan",
        },
        {
          sessionUpdate: "config_option_update",
          configOptions: [
            {
              id: "fast-mode",
              name: "Fast mode",
              type: "boolean",
              currentValue: true,
            },
          ],
        },
      ],
      state
    )

    expect(state.currentModeId).toBe("plan")
    expect(state.configOptions).toEqual([
      {
        id: "fast-mode",
        name: "Fast mode",
        type: "boolean",
        currentValue: true,
      },
    ])
    expect(events).toEqual([
      {
        type: "run_meta",
        metadata: { acp: { currentModeId: "plan" } },
      },
      {
        type: "run_meta",
        metadata: {
          acp: {
            configOptions: [
              {
                id: "fast-mode",
                name: "Fast mode",
                type: "boolean",
                currentValue: true,
              },
            ],
          },
        },
      },
    ])
  })

  test("merges partial session info and retains Claude rate-limit state", () => {
    const state = createAcpMapperReplayState()

    mapAcpSessionUpdatesForReplay(
      [
        {
          sessionUpdate: "session_info_update",
          title: "Live thread",
          updatedAt: "2026-07-18T12:00:00.000Z",
        },
        {
          sessionUpdate: "session_info_update",
          _meta: { codex: { threadStatus: "active" } },
        },
        {
          sessionUpdate: "session_info_update",
          _meta: {
            codex: {
              archived: true,
              goal: {
                objective: "Finish ACP compliance",
                status: "active",
                tokenBudget: 32000,
                timeUsedSeconds: 42.4,
              },
            },
          },
        },
        {
          sessionUpdate: "usage_update",
          used: 500,
          size: 1000,
          _meta: {
            "_claude/rateLimit": {
              status: "allowed_warning",
              rateLimitType: "five_hour",
              utilization: 0.8,
              resetsAt: 1_752_840_000,
            },
          },
        },
        { sessionUpdate: "usage_update", used: 550, size: 1000 },
      ],
      state
    )

    expect(state.sessionInfo).toMatchObject({
      title: "Live thread",
      updatedAt: "2026-07-18T12:00:00.000Z",
      _meta: {
        codex: {
          threadStatus: "active",
          archived: true,
          goal: { objective: "Finish ACP compliance" },
        },
      },
    })
    expect(state.rateLimitInfo).toMatchObject({
      status: "allowed_warning",
      utilization: 0.8,
    })

    const sessionPresentation = getAcpSessionInfoPresentation(
      state.sessionInfo ?? null
    )
    const ratePresentation = getClaudeRateLimitPresentation(
      state.rateLimitInfo ?? null
    )

    expect(sessionPresentation).toMatchObject({
      title: "Live thread",
      threadStatus: "active",
      archived: true,
      goal: {
        objective: "Finish ACP compliance",
        status: "active",
        tokenBudget: 32000,
        timeUsedSeconds: 42.4,
      },
    })
    expect(ratePresentation).toMatchObject({
      status: "allowed warning",
      rateLimitType: "five hour",
      utilizationPercent: 80,
    })
  })

  test("emits valid W3C session trace context and pins Codex ACP", () => {
    const first = createAcpTraceparent()
    const second = createAcpTraceparent()

    expect(first).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/)
    expect(second).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/)
    expect(first).not.toBe(second)

    const probe = probeCodexAcpCommand()

    expect(probe.available).toBe(true)
    if (probe.available) {
      expect(probe.detail).toContain("pinned @agentclientprotocol/codex-acp")
      expect("command" in probe.command).toBe(true)
      if ("command" in probe.command) {
        expect(
          [probe.command.command, ...(probe.command.args ?? [])].join(" ")
        ).toContain("codex-acp")
        expect(probe.command.args).not.toEqual(["acp"])
      }
    }
  })

  test("honors line limit zero and exact UTF-8 terminal byte limits", () => {
    expect(applyLineWindow("one\ntwo", 1, 0)).toBe("")
    expect(trimUtf8BytesFromStart("A😀B", 5)).toEqual({
      text: "😀B",
      truncated: true,
    })
    expect(
      Buffer.byteLength(trimUtf8BytesFromStart("A😀B", 4).text)
    ).toBeLessThanOrEqual(4)
    expect(trimUtf8BytesFromStart("text", 0)).toEqual({
      text: "",
      truncated: true,
    })

    const decoder = createAcpUtf8ChunkDecoder()
    const emoji = Buffer.from("😀", "utf8")

    expect(decoder.write(emoji.subarray(0, 2))).toBe("")
    expect(decoder.write(emoji.subarray(2))).toBe("😀")
    expect(decoder.end()).toBe("")
  })

  test("accepts filtered Claude SDK extension notifications", async () => {
    const received: unknown[] = []
    const app = createAcpClientApp({
      debugLabel: "claude-sdk-extension-test",
      getSignal: () => new AbortController().signal,
      onClaudeSdkMessage: (notification) => received.push(notification),
      sessionId: "studio-session",
      workspace: process.cwd(),
    })
    const connection = agent({ name: "claude-sdk-extension-agent" }).connect(
      app
    )

    try {
      await connection.client.notify("_claude/sdkMessage", {
        sessionId: "agent-session",
        message: {
          type: "prompt_suggestion",
          suggestion: "Run tests",
        },
      })

      expect(received).toEqual([
        {
          sessionId: "agent-session",
          message: {
            type: "prompt_suggestion",
            suggestion: "Run tests",
          },
        },
      ])
    } finally {
      connection.close()
    }
  })

  test("enforces ACP filesystem scope and read/write semantics", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "astraflow-acp-fs-"))
    const outside = await mkdtemp(join(tmpdir(), "astraflow-acp-outside-"))
    const emitted: unknown[] = []
    const app = createAcpClientApp({
      debugLabel: "filesystem-test",
      emitEvent: (event) => emitted.push(event),
      getAcpSessionId: () => "agent-session",
      getSignal: () => new AbortController().signal,
      sessionId: "studio-session",
      workspace,
    })
    const connection = agent({ name: "filesystem-test-agent" }).connect(app)
    const expectRequestFailure = async (
      promise: Promise<unknown>,
      expected: string
    ) => {
      try {
        await promise
        throw new Error("Expected the ACP request to fail.")
      } catch (error) {
        expect(formatAcpErrorMessage(error)).toContain(expected)
      }
    }

    try {
      const createdPath = join(workspace, "created.txt")

      await connection.client.request(methods.client.fs.writeTextFile, {
        sessionId: "agent-session",
        path: createdPath,
        content: "one\r\ntwo\r\nthree",
      })
      expect(await readFile(createdPath, "utf8")).toBe(
        "one\r\ntwo\r\nthree"
      )
      expect(emitted).toContainEqual(
        expect.objectContaining({
          type: "file_change",
          kind: "create",
          path: "created.txt",
        })
      )

      const response = await connection.client.request(
        methods.client.fs.readTextFile,
        {
          sessionId: "agent-session",
          path: createdPath,
          line: 2,
          limit: 1,
        }
      )

      expect(response.content).toBe("two")
      await expectRequestFailure(
        connection.client.request(methods.client.fs.readTextFile, {
          sessionId: "agent-session",
          path: "created.txt",
        }),
        "absolute"
      )

      const outsidePath = join(outside, "secret.txt")

      await writeFile(outsidePath, "secret", "utf8")
      await expectRequestFailure(
        connection.client.request(methods.client.fs.readTextFile, {
          sessionId: "agent-session",
          path: outsidePath,
        }),
        "limited"
      )
      await expectRequestFailure(
        connection.client.request(methods.client.fs.readTextFile, {
          sessionId: "wrong-session",
          path: createdPath,
        }),
        "different session"
      )
    } finally {
      connection.close()
      await Promise.all([
        rm(workspace, { recursive: true, force: true }),
        rm(outside, { recursive: true, force: true }),
      ])
    }
  })

  test("removes an aborted terminal waiter and emits valid file URIs", async () => {
    const controller = new AbortController()
    const waiters: Array<(status: never) => void> = []
    const terminal = { exitStatus: null, waiters }
    const pending = waitForAcpTerminalExit(terminal as never, controller.signal)

    expect(waiters).toHaveLength(1)
    controller.abort()
    await expect(pending).rejects.toThrow("cancelled")
    expect(waiters).toHaveLength(0)
    expect(filePathToAcpUri("/workspace/a #%.txt")).toBe(
      "file:///workspace/a%20%23%25.txt"
    )
  })

  test("bounds and redacts untrusted structured ACP payloads", () => {
    const state = createAcpMapperReplayState()
    const events = mapAcpSessionUpdatesForReplay(
      [
        {
          sessionUpdate: "agent_message_chunk",
          content: {
            type: "image",
            mimeType: "image/png",
            data: "A".repeat(2 * 1024 * 1024 + 1),
          },
        },
        {
          sessionUpdate: "tool_call",
          toolCallId: "secret-tool",
          title: "Inspect",
          status: "pending",
          rawInput: {
            first: "kept",
            second: "also-kept",
            Authorization: "Bearer super-secret-token-value",
            payload: "x".repeat(200_000),
          },
        },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "secret-tool",
          status: "in_progress",
          rawOutput: {
            content: [
              {
                type: "text",
                text: "Bearer another-super-secret-token-value",
              },
            ],
          },
        },
        {
          sessionUpdate: "session_info_update",
          title: null,
          updatedAt: "2026-07-18T12:00:00.000Z",
          _meta: { vendor: "kept" },
        },
      ],
      state
    )
    const serialized = JSON.stringify(events)
    const toolCall = events.find((event) => event.type === "tool_call")

    expect(events[0]).toMatchObject({
      type: "content_block",
      content: { type: "text" },
    })
    expect(toolCall).toMatchObject({
      type: "tool_call",
      rawInput: {
        first: "kept",
        second: "also-kept",
        Authorization: "[REDACTED]",
      },
    })
    expect(serialized).not.toContain("super-secret-token-value")
    expect(serialized).not.toContain("another-super-secret-token-value")
    expect(serialized.length).toBeLessThan(500_000)
    expect(state.sessionInfo).toMatchObject({
      sessionUpdate: "session_info_update",
      title: null,
      updatedAt: "2026-07-18T12:00:00.000Z",
      _meta: { vendor: "kept" },
    })
  })

  test("redacts credentials embedded in provider URLs and metadata", () => {
    const sanitized = sanitizeAgentStructuredValue({
      baseUrl:
        "https://user:password@provider.example/v1?api_key=query-secret&region=cn",
      headers: {
        "x-api-key": "header-secret",
      },
    })
    const serialized = JSON.stringify(sanitized)

    expect(serialized).not.toContain("password")
    expect(serialized).not.toContain("query-secret")
    expect(serialized).not.toContain("header-secret")
    expect(serialized).toContain("region=cn")
    expect(serialized).toContain("[REDACTED]")
  })
})
