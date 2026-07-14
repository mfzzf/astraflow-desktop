import { methods } from "@agentclientprotocol/sdk"
import { randomUUID } from "node:crypto"

import { asErrorMessage, getRecord, stringify } from "./constants.mjs"

function toolKind(name) {
  if (["read_file", "ls"].includes(name)) {
    return "read"
  }

  if (["glob", "grep"].includes(name)) {
    return "search"
  }

  if (["write_file", "edit_file"].includes(name)) {
    return "edit"
  }

  if (name === "task" || name === "write_todos") {
    return "think"
  }

  if (name === "execute") {
    return "execute"
  }

  return "other"
}

function contentDelta(rawEvent) {
  const event = getRecord(rawEvent)

  return event?.event === "content-block-delta"
    ? getRecord(event.delta)
    : null
}

function toolInputPath(input) {
  const record = getRecord(input)
  const value = record?.path ?? record?.file_path ?? record?.filePath

  return typeof value === "string" && value.trim() ? value.trim() : null
}

function toolLocations(input) {
  const path = toolInputPath(input)

  return path ? [{ path }] : undefined
}

function toolResultContent(name, input, output) {
  const content = [
    {
      type: "content",
      content: { type: "text", text: stringify(output) },
    },
  ]
  const record = getRecord(input)
  const path = toolInputPath(input)

  if (path && name === "write_file") {
    content.push({
      type: "diff",
      path,
      oldText: null,
      newText: typeof record?.content === "string" ? record.content : "",
    })
  } else if (path && name === "edit_file") {
    content.push({
      type: "diff",
      path,
      oldText:
        typeof record?.old_string === "string"
          ? record.old_string
          : typeof record?.oldString === "string"
            ? record.oldString
            : null,
      newText:
        typeof record?.new_string === "string"
          ? record.new_string
          : typeof record?.newString === "string"
            ? record.newString
            : null,
    })
  }

  return content
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

    return [{ content: content.trim(), status, priority: "medium" }]
  })
}

async function notify(client, sessionId, update) {
  await client.notify(methods.client.session.update, { sessionId, update })
}

async function pumpMessages(messages, client, sessionId, meta = null) {
  if (!messages) {
    return
  }

  for await (const message of messages) {
    const messageId = randomUUID()

    for await (const rawEvent of message) {
      const delta = contentDelta(rawEvent)

      if (delta?.type === "text-delta" && typeof delta.text === "string") {
        await notify(client, sessionId, {
          sessionUpdate: meta ? "agent_thought_chunk" : "agent_message_chunk",
          messageId,
          content: { type: "text", text: delta.text },
          ...(meta ? { _meta: { astraflow: meta } } : {}),
        })
      } else if (
        delta?.type === "reasoning-delta" &&
        typeof delta.reasoning === "string"
      ) {
        await notify(client, sessionId, {
          sessionUpdate: "agent_thought_chunk",
          messageId,
          content: { type: "text", text: delta.reasoning },
          ...(meta ? { _meta: { astraflow: meta } } : {}),
        })
      }
    }
  }
}

async function pumpToolCall(call, client, sessionId, parentTaskId = null) {
  const toolCallId = call.callId || randomUUID()
  const name = typeof call.name === "string" ? call.name : "tool"
  const entries = name === "write_todos" ? planEntries(call.input) : null

  if (entries) {
    await notify(client, sessionId, {
      sessionUpdate: "plan",
      entries,
      _meta: parentTaskId
        ? { astraflow: { parentTaskId } }
        : { astraflow: { engine: "deepagents" } },
    })
  }

  await notify(client, sessionId, {
    sessionUpdate: "tool_call",
    toolCallId,
    title: name,
    kind: toolKind(name),
    status: "in_progress",
    rawInput: call.input,
    locations: toolLocations(call.input),
    _meta: {
      astraflow: {
        engine: "deepagents",
        ...(parentTaskId ? { parentTaskId } : {}),
      },
    },
  })

  const status = await call.status.catch(() => "error")

  if (status === "error") {
    const error = await call.error.catch(asErrorMessage)

    await notify(client, sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId,
      status: "failed",
      rawOutput: { error: error || "Tool call failed." },
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: error || "Tool call failed.",
          },
        },
      ],
    })
    return
  }

  const output = await call.output.catch((error) => ({
    error: asErrorMessage(error),
  }))

  await notify(client, sessionId, {
    sessionUpdate: "tool_call_update",
    toolCallId,
    status: "completed",
    rawOutput: output,
    content: toolResultContent(name, call.input, output),
    locations: toolLocations(call.input),
  })
}

async function pumpToolCalls(toolCalls, client, sessionId, parentTaskId = null) {
  if (!toolCalls) {
    return
  }

  const pending = []

  for await (const call of toolCalls) {
    pending.push(pumpToolCall(call, client, sessionId, parentTaskId))
  }

  await Promise.all(pending)
}

function subagentTaskId(subagent) {
  const cause = getRecord(subagent?.cause)

  return cause?.type === "toolCall" && typeof cause.tool_call_id === "string"
    ? cause.tool_call_id
    : `${subagent?.name || "subagent"}:${randomUUID()}`
}

async function pumpSubagent(subagent, client, sessionId, parentTaskId = null) {
  const taskId = subagentTaskId(subagent)
  const meta = {
    engine: "deepagents",
    subagent: subagent?.name || "subagent",
    taskId,
    ...(parentTaskId ? { parentTaskId } : {}),
  }
  const nested = pumpSubagents(
    subagent?.subagents,
    client,
    sessionId,
    taskId
  )
  const toolCalls = pumpToolCalls(
    subagent?.toolCalls,
    client,
    sessionId,
    taskId
  )
  const messages = pumpMessages(subagent?.messages, client, sessionId, meta)
  const values = (async () => {
    if (!subagent?.values) {
      return
    }

    for await (const value of subagent.values) {
      // Consuming this stream is required for DeepAgents backpressure. Plans
      // and visible tool state are emitted through the dedicated streams.
      void value
    }
  })()

  await Promise.allSettled([nested, toolCalls, messages, values])
  await subagent?.output?.catch(() => undefined)
}

async function pumpSubagents(
  subagents,
  client,
  sessionId,
  parentTaskId = null
) {
  if (!subagents) {
    return
  }

  const pending = []

  for await (const subagent of subagents) {
    pending.push(
      pumpSubagent(subagent, client, sessionId, parentTaskId)
    )
  }

  await Promise.all(pending)
}

export async function pumpDeepAgentRun({ client, run, sessionId, signal }) {
  const output = run.output
  const pumps = Promise.all([
    pumpMessages(run.messages, client, sessionId),
    pumpToolCalls(run.toolCalls, client, sessionId),
    pumpSubagents(run.subagents, client, sessionId),
  ])
  const abort = () => run.abort(signal.reason)

  if (signal.aborted) {
    abort()
  } else {
    signal.addEventListener("abort", abort, { once: true })
  }

  try {
    const [result] = await Promise.all([output, pumps])
    return result
  } finally {
    signal.removeEventListener("abort", abort)
  }
}
