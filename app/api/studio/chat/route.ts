import { NextResponse } from "next/server"
import { z } from "zod"
import {
  AIMessage,
  HumanMessage,
  type BaseMessage,
  type MessageContent,
} from "@langchain/core/messages"
import { createAgent } from "langchain"

import { getAppAuthState } from "@/lib/app-auth"
import {
  DEFAULT_CHAT_MODEL,
  resolveChatReasoningEffort,
  SUPPORTED_CHAT_MODELS,
  SUPPORTED_CHAT_REASONING_EFFORTS,
} from "@/lib/chat-models"
import { createStudioAgentTools } from "@/lib/exa-tools"
import { createModelverseChatModel } from "@/lib/modelverse-langchain"
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/modelverse-openai"
import { getStudioSession, listStudioMessages } from "@/lib/studio-db"

export const runtime = "nodejs"

const chatRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  model: z.enum(SUPPORTED_CHAT_MODELS).default(DEFAULT_CHAT_MODEL),
  reasoningEffort: z.enum(SUPPORTED_CHAT_REASONING_EFFORTS).optional(),
  retryMessageId: z.string().trim().min(1).optional(),
})

type ChatStreamEvent =
  | {
      type: "content" | "reasoning"
      delta: string
    }
  | {
      type: "tool_call"
      toolCallId: string
      toolName: string
      input: string
    }
  | {
      type: "tool_result"
      toolCallId: string
      toolName: string
      status: "complete" | "error"
      output?: string
      error?: string
    }

function encodeStreamEvent(encoder: TextEncoder, event: ChatStreamEvent) {
  return encoder.encode(`${JSON.stringify(event)}\n`)
}

function stringifyToolPayload(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isVisibleToolName(
  name: unknown
): name is "web_search" | "web_fetch" | "run_code" {
  return name === "web_search" || name === "web_fetch" || name === "run_code"
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function getRawEventData(event: unknown) {
  const record = getRecord(event)
  const params = getRecord(record?.params)

  return {
    method: record?.method,
    data: getRecord(params?.data),
  }
}

function getContentBlock(data: Record<string, unknown>) {
  return getRecord(data.contentBlock) ?? getRecord(data.content_block)
}

function getToolCallInput(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }

  return value
}

function toLangChainMessages(
  sessionId: string,
  retryMessageId?: string
): BaseMessage[] {
  const history = listStudioMessages(sessionId)
  const retryMessageIndex = retryMessageId
    ? history.findIndex((message) => message.id === retryMessageId)
    : -1
  const effectiveHistory =
    retryMessageIndex >= 0 ? history.slice(0, retryMessageIndex) : history

  const messages = effectiveHistory.map((message) => {
    if (message.role === "user" && message.attachments.length > 0) {
      const parts: MessageContent = []

      if (message.content) {
        parts.push({ type: "text", text: message.content })
      }

      for (const attachment of message.attachments) {
        parts.push({
          type: "image_url",
          image_url: { url: attachment.dataUrl },
        })
      }

      return new HumanMessage({ content: parts })
    }

    if (message.role === "user") {
      return new HumanMessage(message.content)
    }

    return new AIMessage(message.content)
  })

  return messages
}

function getAgentSystemPrompt({
  hasWebFetch,
  hasWebSearch,
  hasRunCode,
}: {
  hasWebFetch: boolean
  hasWebSearch: boolean
  hasRunCode: boolean
}) {
  if (!hasWebFetch && !hasWebSearch && !hasRunCode) {
    return DEFAULT_SYSTEM_PROMPT
  }

  const toolInstructions: string[] = []

  if (hasWebFetch) {
    toolInstructions.push(
      "You have access to a web_fetch tool. Use it when the user gives a URL or asks to read, summarize, extract, or answer questions from a specific page."
    )
  }

  if (hasWebSearch) {
    toolInstructions.push(
      "You have access to a web_search tool backed by Exa. Use it when the user asks for web search, latest/current information, source-backed facts, or details that may have changed recently. When using web_search, cite source URLs in the final answer."
    )
  }

  if (hasRunCode) {
    toolInstructions.push(
      "You have access to a run_code tool backed by an E2B code-interpreter-v1 sandbox. Use it for calculations, data processing, code execution, or quick scripts in python, javascript, typescript, bash, r, or java. The auto_pause field is required: choose true only when later tool calls may need the same sandbox state or files, and choose false for one-shot execution so the sandbox is killed after the code finishes. If you need to continue from a previous run_code result, pass its Sandbox ID as sandbox_id."
    )
  }

  return `${DEFAULT_SYSTEM_PROMPT}

${toolInstructions.join("\n")}`
}

export async function POST(request: Request) {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  const parsed = chatRequestSchema.safeParse(await request.json())

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const session = getStudioSession(parsed.data.sessionId)

  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Session not found" },
      { status: 404 }
    )
  }

  try {
    const reasoningEffort = resolveChatReasoningEffort(
      parsed.data.model,
      parsed.data.reasoningEffort
    )
    const model = createModelverseChatModel(parsed.data.model, reasoningEffort)
    const tools = createStudioAgentTools()
    const hasWebFetch = tools.some((agentTool) => agentTool.name === "web_fetch")
    const hasWebSearch = tools.some(
      (agentTool) => agentTool.name === "web_search"
    )
    const hasRunCode = tools.some((agentTool) => agentTool.name === "run_code")
    const agent = createAgent({
      model,
      tools,
      systemPrompt: getAgentSystemPrompt({
        hasWebFetch,
        hasWebSearch,
        hasRunCode,
      }),
    })
    const run = await agent.streamEvents(
      {
        messages: toLangChainMessages(
          parsed.data.sessionId,
          parsed.data.retryMessageId
        ),
      },
      {
        version: "v3",
        signal: request.signal,
        recursionLimit: tools.length > 0 ? 8 : 2,
      }
    )

    const encoder = new TextEncoder()

    return new Response(
      new ReadableStream({
        async start(controller) {
          try {
            const enqueue = (event: ChatStreamEvent) => {
              controller.enqueue(encodeStreamEvent(encoder, event))
            }

            const seenToolCalls = new Map<string, string>()

            const enqueueToolCall = ({
              toolCallId,
              toolName,
              input,
            }: {
              toolCallId: string
              toolName: string
              input: unknown
            }) => {
              if (seenToolCalls.has(toolCallId)) {
                return
              }

              seenToolCalls.set(toolCallId, toolName)
              enqueue({
                type: "tool_call",
                toolCallId,
                toolName,
                input: stringifyToolPayload(getToolCallInput(input)),
              })
            }

            for await (const rawEvent of run) {
              const { method, data } = getRawEventData(rawEvent)

              if (!data) {
                continue
              }

              if (method === "messages") {
                if (data.event === "content-block-delta") {
                  const delta = getRecord(data.delta)

                  if (delta?.type === "reasoning-delta") {
                    enqueue({
                      type: "reasoning",
                      delta:
                        typeof delta.reasoning === "string"
                          ? delta.reasoning
                          : "",
                    })
                  }

                  if (delta?.type === "text-delta") {
                    enqueue({
                      type: "content",
                      delta:
                        typeof delta.text === "string" ? delta.text : "",
                    })
                  }
                }

                if (data.event === "content-block-finish") {
                  const contentBlock = getContentBlock(data)

                  if (
                    contentBlock?.type === "tool_call" &&
                    isVisibleToolName(contentBlock.name)
                  ) {
                    enqueueToolCall({
                      toolCallId:
                        typeof contentBlock.id === "string"
                          ? contentBlock.id
                          : crypto.randomUUID(),
                      toolName: contentBlock.name,
                      input: contentBlock.args ?? contentBlock.input ?? "",
                    })
                  }
                }
              }

              if (method === "tools") {
                const toolName = data.tool_name
                const toolCallId =
                  typeof data.tool_call_id === "string"
                    ? data.tool_call_id
                    : crypto.randomUUID()

                if (!isVisibleToolName(toolName)) {
                  continue
                }

                if (data.event === "tool-started") {
                  enqueueToolCall({
                    toolCallId,
                    toolName,
                    input: data.input ?? "",
                  })
                }

                if (data.event === "tool-finished") {
                  enqueue({
                    type: "tool_result",
                    toolCallId,
                    toolName,
                    status: "complete",
                    output: stringifyToolPayload(data.output),
                  })
                }

                if (data.event === "tool-error") {
                  enqueue({
                    type: "tool_result",
                    toolCallId,
                    toolName,
                    status: "error",
                    error: stringifyToolPayload(data.message ?? data.error),
                  })
                }
              }
            }

            await run.output
          } catch (error) {
            controller.error(error)
            return
          }

          controller.close()
        },
      }),
      {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
        },
      }
    )
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Chat request failed.",
      },
      { status: 500 }
    )
  }
}
