import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, test } from "node:test"

import { Agent, type AgentEvent as PiAgentEvent } from "@earendil-works/pi-agent-core"
import {
  Type,
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai"
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent"

import {
  mapPiAgentSessionEvent,
  mapPiFileToolResult,
  splitPiUserPromptContent,
} from "@/lib/agent/adapters/astraflow-runtime"
import {
  createPiLocalTools,
  PI_LOCAL_TOOL_NAMES,
} from "@/lib/agent/pi-tools"
import { normalizeAgentToolName } from "@/lib/agent/tool-names"
import {
  createModelversePiPayloadTransform,
  mapAstraFlowReasoningEffortToPi,
  mapModelverseProtocolToPiApi,
} from "@/lib/modelverse-pi"

function mapCoreEvent(event: PiAgentEvent) {
  return mapPiAgentSessionEvent(event as AgentSessionEvent)
}

describe("AstraFlow Pi runtime", () => {
  test("maps ModelVerse protocols and reasoning to Pi", () => {
    assert.equal(mapModelverseProtocolToPiApi("openai-chat"), "openai-completions")
    assert.equal(mapModelverseProtocolToPiApi("openai-responses"), "openai-responses")
    assert.equal(mapModelverseProtocolToPiApi("anthropic-messages"), "anthropic-messages")
    assert.equal(mapAstraFlowReasoningEffortToPi("none"), "off")
    assert.equal(mapAstraFlowReasoningEffortToPi("enabled"), "medium")
    assert.equal(mapAstraFlowReasoningEffortToPi("max"), "max")
  })

  test("preserves ModelVerse DeepSeek's high/max payload contract", () => {
    const high = createModelversePiPayloadTransform(
      "deepseek_reasoning_effort",
      "high"
    )
    const max = createModelversePiPayloadTransform(
      "deepseek_reasoning_effort",
      "max"
    )

    assert.deepEqual(high?.({ enable_thinking: true }), {
      enable_thinking: true,
      reasoning_effort: "high",
    })
    assert.deepEqual(max?.({ enable_thinking: true }), {
      enable_thinking: true,
      reasoning_effort: "max",
    })
    assert.equal(
      createModelversePiPayloadTransform(
        "deepseek_reasoning_effort",
        "none"
      ),
      undefined
    )
  })

  test("runs thinking, a tool, and a final answer through Pi's Faux provider", async () => {
    const faux = fauxProvider({ tokensPerSecond: 0 })
    const toolCallId = "tool:echo"
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxThinking("Inspect the input."),
          fauxToolCall("echo", { value: "hello" }, { id: toolCallId }),
        ],
        { stopReason: "toolUse" }
      ),
      fauxAssistantMessage("Finished with Pi."),
    ])
    let invocations = 0
    const agent = new Agent({
      initialState: {
        systemPrompt: "Test AstraFlow Pi integration.",
        model: faux.getModel(),
        thinkingLevel: "medium",
        tools: [
          {
            name: "echo",
            label: "echo",
            description: "Echo a value.",
            parameters: Type.Object({ value: Type.String() }),
            async execute(_id, params) {
              const { value } = params as { value: string }
              invocations += 1
              return {
                content: [{ type: "text", text: `echo:${value}` }],
                details: undefined,
              }
            },
          },
        ],
      },
      streamFn: (model, context, options) =>
        faux.provider.streamSimple(model, context, options),
    })
    const mapped = [] as ReturnType<typeof mapCoreEvent>[number][]
    agent.subscribe((event) => {
      mapped.push(...mapCoreEvent(event))
    })

    await agent.prompt("Use the echo tool.")

    assert.equal(invocations, 1)
    assert.ok(mapped.some((event) => event.type === "reasoning_delta"))
    assert.ok(
      mapped.some(
        (event) => event.type === "tool_call" && event.id === toolCallId
      )
    )
    assert.ok(
      mapped.some(
        (event) =>
          event.type === "tool_result" &&
          event.id === toolCallId &&
          event.status === "complete" &&
          event.output === "echo:hello"
      )
    )
    assert.equal(
      mapped
        .flatMap((event) => (event.type === "text_delta" ? [event.delta] : []))
        .join(""),
      "Finished with Pi."
    )
    assert.equal(faux.state.callCount, 2)
  })

  test("preserves Pi provider errors in final assistant state", async () => {
    const faux = fauxProvider()
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "synthetic provider failure",
      }),
    ])
    const agent = new Agent({
      initialState: {
        model: faux.getModel(),
        thinkingLevel: "off",
        tools: [],
      },
      streamFn: (model, context, options) =>
        faux.provider.streamSimple(model, context, options),
    })

    await agent.prompt("Fail deterministically.")

    const last = agent.state.messages.at(-1)
    assert.ok(last && "role" in last && last.role === "assistant")
    assert.equal(last.stopReason, "error")
    assert.equal(last.errorMessage, "synthetic provider failure")
    assert.equal(agent.state.errorMessage, "synthetic provider failure")
  })

  test("normalizes Pi built-in tool names for renderer i18n", () => {
    const cases = [
      ["bash", "execute"],
      ["read", "read_file"],
      ["write", "write_file"],
      ["edit", "edit_file"],
      ["find", "glob"],
    ] as const

    for (const [toolName, expected] of cases) {
      const [event] = mapPiAgentSessionEvent({
        type: "tool_execution_start",
        toolCallId: `tool:${toolName}`,
        toolName,
        args: {},
      } as AgentSessionEvent)

      assert.equal(event?.type, "tool_call")
      assert.equal(event?.type === "tool_call" ? event.name : null, expected)
    }

    assert.equal(normalizeAgentToolName("subagent"), "spawn_agent")
  })

  test("activates all seven Pi coding tools, including rg/fd-backed search", () => {
    assert.deepEqual(PI_LOCAL_TOOL_NAMES, [
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
    ])
  })

  test("preserves text and images while enabling Pi prompt expansion", () => {
    assert.deepEqual(
      splitPiUserPromptContent([
        { type: "text", text: "/parallel-review" },
        {
          type: "image",
          data: "aGVsbG8=",
          mimeType: "image/png",
        },
        { type: "text", text: "focus on runtime integration" },
      ]),
      {
        text: "/parallel-review\nfocus on runtime integration",
        images: [
          {
            type: "image",
            data: "aGVsbG8=",
            mimeType: "image/png",
          },
        ],
      }
    )
  })

  test("uses guarded Pi file tools and emits real diffs for writes", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "astraflow-pi-tools-"))
    const controller = new AbortController()
    const tools = createPiLocalTools({
      rootDir,
      sessionId: `test-${Date.now()}`,
      permissionContext: {
        sessionId: `test-${Date.now()}`,
        permissionMode: "full_access",
        projectId: null,
        signal: controller.signal,
        emit: () => undefined,
      },
    })
    const context = {} as never
    const write = tools.find((tool) => tool.name === "write")
    const read = tools.find((tool) => tool.name === "read")
    const edit = tools.find((tool) => tool.name === "edit")
    assert.ok(write && read && edit)

    try {
      const writeResult = await write.execute(
        "write-1",
        { path: "note.txt", content: "hello" },
        controller.signal,
        undefined,
        context
      )
      const createChange = mapPiFileToolResult({
        args: { path: "note.txt", content: "hello" },
        existed: false,
        isError: false,
        name: "write",
        result: writeResult,
        rootDir,
      })
      assert.ok(createChange)
      assert.equal(createChange.kind, "create")
      assert.equal(createChange.path, join(rootDir, "note.txt"))
      assert.match(createChange.diff ?? "", /\+hello/)
      assert.doesNotMatch(createChange.diff ?? "", /Created .*note\.txt/)

      const readResult = await read.execute(
        "read-1",
        { path: "note.txt" },
        controller.signal,
        undefined,
        context
      )
      const firstReadPart = readResult.content[0]
      assert.ok(firstReadPart?.type === "text")
      assert.match(firstReadPart.text, /hello/)

      const editResult = await edit.execute(
        "edit-1",
        {
          path: "note.txt",
          edits: [{ oldText: "hello", newText: "hello from Pi" }],
        },
        controller.signal,
        undefined,
        context
      )
      assert.match(String(editResult.details?.patch), /hello from Pi/)

      const overwriteResult = await write.execute(
        "write-2",
        { path: "note.txt", content: "hello from Pi\nsecond line\n" },
        controller.signal,
        undefined,
        context
      )
      const overwriteChange = mapPiFileToolResult({
        args: {
          path: "note.txt",
          content: "hello from Pi\nsecond line\n",
        },
        existed: true,
        isError: false,
        name: "write",
        result: overwriteResult,
        rootDir,
      })
      assert.ok(overwriteChange)
      assert.equal(overwriteChange.kind, "edit")
      assert.match(overwriteChange.diff ?? "", /-hello from Pi/)
      assert.match(overwriteChange.diff ?? "", /\+second line/)
      assert.equal(
        await readFile(join(rootDir, "note.txt"), "utf8"),
        "hello from Pi\nsecond line\n"
      )
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })

  test("blocks Pi writes in read-only mode", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "astraflow-pi-readonly-"))
    const controller = new AbortController()
    const tools = createPiLocalTools({
      rootDir,
      sessionId: `readonly-${Date.now()}`,
      permissionContext: {
        sessionId: `readonly-${Date.now()}`,
        permissionMode: "readonly",
        projectId: null,
        signal: controller.signal,
        emit: () => undefined,
      },
    })
    const write = tools.find((tool) => tool.name === "write")
    assert.ok(write)

    try {
      await assert.rejects(
        write.execute(
          "write-denied",
          { path: "blocked.txt", content: "no" },
          controller.signal,
          undefined,
          {} as never
        ),
        /read-only mode/
      )
    } finally {
      await rm(rootDir, { recursive: true, force: true })
    }
  })
})
