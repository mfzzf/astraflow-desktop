import { methods } from "@agentclientprotocol/sdk"
import { randomUUID } from "node:crypto"

import { getRecord, stringify } from "./constants.mjs"

function toolKind(name) {
  if (["read", "ls"].includes(name)) {
    return "read"
  }

  if (["find", "grep"].includes(name)) {
    return "search"
  }

  if (["edit", "write"].includes(name)) {
    return "edit"
  }

  if (["plan", "task"].includes(name)) {
    return "think"
  }

  if (name === "bash") {
    return "execute"
  }

  return "other"
}

function toolInputPath(input) {
  const record = getRecord(input)
  const value = record?.path ?? record?.file_path ?? record?.filePath

  return typeof value === "string" && value.trim() ? value.trim() : null
}

function toolLocations(input) {
  const filePath = toolInputPath(input)

  return filePath ? [{ path: filePath }] : undefined
}

function resultTextContent(result) {
  const content = Array.isArray(result?.content) ? result.content : []
  const blocks = content.flatMap((entry) => {
    if (entry?.type === "text" && typeof entry.text === "string") {
      return [
        {
          type: "content",
          content: { type: "text", text: entry.text },
        },
      ]
    }

    if (
      entry?.type === "image" &&
      typeof entry.data === "string" &&
      typeof entry.mimeType === "string"
    ) {
      return [
        {
          type: "content",
          content: {
            type: "image",
            data: entry.data,
            mimeType: entry.mimeType,
          },
        },
      ]
    }

    return []
  })

  if (blocks.length > 0) {
    return blocks
  }

  return [
    {
      type: "content",
      content: { type: "text", text: stringify(result) },
    },
  ]
}

function editDiffs(name, input) {
  const record = getRecord(input)
  const filePath = toolInputPath(input)

  if (!record || !filePath) {
    return []
  }

  if (name === "write") {
    return [
      {
        type: "diff",
        path: filePath,
        oldText: null,
        newText: typeof record.content === "string" ? record.content : "",
      },
    ]
  }

  if (name !== "edit" || !Array.isArray(record.edits)) {
    return []
  }

  return record.edits.flatMap((edit) => {
    const change = getRecord(edit)

    if (
      typeof change?.oldText !== "string" ||
      typeof change?.newText !== "string"
    ) {
      return []
    }

    return [
      {
        type: "diff",
        path: filePath,
        oldText: change.oldText,
        newText: change.newText,
      },
    ]
  })
}

function toolResultContent(name, input, result) {
  return [...resultTextContent(result), ...editDiffs(name, input)]
}

function planEntries(input) {
  const todos = getRecord(input)?.todos

  if (!Array.isArray(todos)) {
    return null
  }

  return todos.flatMap((todo) => {
    const record = getRecord(todo)
    const content = record?.content

    if (typeof content !== "string" || !content.trim()) {
      return []
    }

    const status = ["pending", "in_progress", "completed"].includes(
      record.status
    )
      ? record.status
      : "pending"
    const priority = ["high", "medium", "low"].includes(record.priority)
      ? record.priority
      : "medium"

    return [{ content: content.trim(), status, priority }]
  })
}

async function notify(client, sessionId, update) {
  await client.notify(methods.client.session.update, { sessionId, update })
}

function astraflowMeta(parentTaskId, retry, toolInput) {
  return {
    astraflow: {
      engine: "pi-agent",
      ...(retry ? { retry } : {}),
      ...(typeof toolInput === "string" ? { toolInput } : {}),
      ...(parentTaskId
        ? {
            parentTaskId,
            subagent: "task",
            taskId: parentTaskId,
          }
        : {}),
    },
  }
}

/**
 * Turn Pi Agent lifecycle events into ACP session updates. The returned
 * listener is safe to attach to both the primary Agent and task subagents.
 */
export function createPiEventForwarder({
  client,
  sessionId,
  parentTaskId = null,
}) {
  const toolCalls = new Map()
  const announcedToolCalls = new Set()
  let messageId = null
  let lastAssistantMessageId = null

  return async (event) => {
    if (event.type === "message_start" && event.message?.role === "assistant") {
      messageId = randomUUID()
      return
    }

    if (event.type === "message_end" && event.message?.role === "assistant") {
      lastAssistantMessageId = messageId
      messageId = null
      return
    }

    if (event.type === "auto_retry_start" || event.type === "auto_retry_end") {
      const retry =
        event.type === "auto_retry_start"
          ? {
              phase: "start",
              attempt: event.attempt,
              maxAttempts: event.maxAttempts,
              delayMs: event.delayMs,
              errorMessage: event.errorMessage,
            }
          : {
              phase: "end",
              attempt: event.attempt,
              success: event.success,
              ...(event.finalError ? { errorMessage: event.finalError } : {}),
            }
      const retryMessageId =
        event.type === "auto_retry_start"
          ? lastAssistantMessageId || messageId
          : messageId || lastAssistantMessageId

      await notify(client, sessionId, {
        sessionUpdate: parentTaskId
          ? "agent_thought_chunk"
          : "agent_message_chunk",
        messageId: retryMessageId || randomUUID(),
        content: { type: "text", text: "" },
        _meta: astraflowMeta(parentTaskId, retry),
      })
      return
    }

    if (event.type === "message_update") {
      const delta = event.assistantMessageEvent

      if (delta?.type === "toolcall_start") {
        // The model just started generating a tool call. Surface it right
        // away so long argument generations (e.g. writing a big file) show
        // up immediately instead of looking stuck.
        const block = delta.partial?.content?.[delta.contentIndex]

        if (block?.type === "toolCall" && typeof block.id === "string") {
          announcedToolCalls.add(block.id)
          await notify(client, sessionId, {
            sessionUpdate: "tool_call",
            toolCallId: block.id,
            title: block.name || "tool",
            kind: toolKind(block.name),
            status: "in_progress",
            _meta: astraflowMeta(parentTaskId),
          })
        }

        return
      }

      if (delta?.type === "toolcall_delta") {
        // Stream the raw argument JSON as it is generated. `partialJson` is
        // the accumulated argument text so far (snapshot semantics).
        const block = delta.partial?.content?.[delta.contentIndex]

        if (
          block?.type === "toolCall" &&
          typeof block.id === "string" &&
          typeof block.partialJson === "string"
        ) {
          await notify(client, sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: block.id,
            status: "in_progress",
            _meta: astraflowMeta(parentTaskId, null, block.partialJson),
          })
        }

        return
      }

      if (delta?.type === "text_delta" && typeof delta.delta === "string") {
        await notify(client, sessionId, {
          sessionUpdate: parentTaskId
            ? "agent_thought_chunk"
            : "agent_message_chunk",
          messageId: messageId || randomUUID(),
          content: { type: "text", text: delta.delta },
          _meta: astraflowMeta(parentTaskId),
        })
      } else if (
        delta?.type === "thinking_delta" &&
        typeof delta.delta === "string"
      ) {
        await notify(client, sessionId, {
          sessionUpdate: "agent_thought_chunk",
          messageId: messageId || randomUUID(),
          content: { type: "text", text: delta.delta },
          _meta: astraflowMeta(parentTaskId),
        })
      }

      return
    }

    if (event.type === "tool_execution_start") {
      const entry = {
        name: event.toolName || "tool",
        input: event.args || {},
      }
      const wasAnnounced = announcedToolCalls.has(event.toolCallId)

      announcedToolCalls.add(event.toolCallId)
      toolCalls.set(event.toolCallId, entry)
      const entries = entry.name === "plan" ? planEntries(entry.input) : null

      if (entries) {
        await notify(client, sessionId, {
          sessionUpdate: "plan",
          entries,
          _meta: astraflowMeta(parentTaskId),
        })
      }

      await notify(client, sessionId, {
        sessionUpdate: wasAnnounced ? "tool_call_update" : "tool_call",
        toolCallId: event.toolCallId,
        title: entry.name,
        kind: toolKind(entry.name),
        status: "in_progress",
        rawInput: entry.input,
        locations: toolLocations(entry.input),
        _meta: astraflowMeta(parentTaskId),
      })
      return
    }

    if (event.type === "tool_execution_update") {
      const entry = toolCalls.get(event.toolCallId) || {
        name: event.toolName || "tool",
        input: event.args || {},
      }

      await notify(client, sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: "in_progress",
        rawOutput: event.partialResult,
        content: resultTextContent(event.partialResult),
        locations: toolLocations(entry.input),
        _meta: astraflowMeta(parentTaskId),
      })
      return
    }

    if (event.type === "tool_execution_end") {
      const entry = toolCalls.get(event.toolCallId) || {
        name: event.toolName || "tool",
        input: {},
      }
      toolCalls.delete(event.toolCallId)

      await notify(client, sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: event.isError ? "failed" : "completed",
        rawOutput: event.result,
        content: toolResultContent(entry.name, entry.input, event.result),
        locations: toolLocations(entry.input),
        _meta: astraflowMeta(parentTaskId),
      })
    }
  }
}

/**
 * Preserve pi-agent-core's awaited event delivery while also forwarding the
 * AgentSession-only retry lifecycle. AgentSession listeners are synchronous,
 * so all events share an explicit promise chain and callers flush it before
 * completing the ACP request.
 */
export function subscribePiSessionEventForwarder({
  agent,
  agentSession,
  client,
  sessionId,
  parentTaskId = null,
}) {
  const forward = createPiEventForwarder({
    client,
    sessionId,
    parentTaskId,
  })
  let pending = Promise.resolve()
  let firstError = null

  const enqueue = (event) => {
    const operation = pending.then(() => forward(event))
    pending = operation.catch((error) => {
      firstError ||= error
    })
    return operation
  }
  const unsubscribeAgent = agent.subscribe(enqueue)
  const unsubscribeSession = agentSession.subscribe((event) => {
    if (event.type === "auto_retry_start" || event.type === "auto_retry_end") {
      void enqueue(event).catch(() => undefined)
    }
  })

  return {
    async flush() {
      await pending

      if (firstError) {
        throw firstError
      }
    },
    unsubscribe() {
      unsubscribeSession()
      unsubscribeAgent()
    },
  }
}
