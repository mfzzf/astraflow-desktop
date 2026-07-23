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

function boundedToolInput(input) {
  const record = getRecord(input)

  if (!record) {
    return input
  }

  const limitText = (value, limit = 32 * 1024) =>
    typeof value === "string" && value.length > limit
      ? `${value.slice(0, limit)}\n[truncated]`
      : value
  const next = Object.fromEntries(
    Object.entries(record)
      .slice(0, 64)
      .map(([key, value]) => [key, limitText(value)])
  )

  if (Array.isArray(record.edits)) {
    next.edits = record.edits.slice(0, 20).map((edit) => {
      const change = getRecord(edit)

      return change
        ? {
            ...change,
            oldText: limitText(change.oldText, 16 * 1024),
            newText: limitText(change.newText, 16 * 1024),
          }
        : edit
    })
  }

  return next
}

function toolInputText(input, ...keys) {
  const record = getRecord(input)

  for (const key of keys) {
    const value = record?.[key]

    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return ""
}

function toolTargetName(value, fallback) {
  const normalized = value.replace(/[\\/]+$/, "")
  const target = normalized.split(/[\\/]/).at(-1)

  return !target || target === "." ? fallback : target
}

function toolCallSummary(name, input, running) {
  const path = toolInputText(input, "path", "file_path", "filePath")
  const query = toolInputText(input, "query", "pattern")
  const labels = {
    read: ["Reading", "Read", toolTargetName(path, "file")],
    ls: ["Listing", "Listed", toolTargetName(path, "directory")],
    find: ["Finding", "Found", toolTargetName(path, "files")],
    grep: ["Searching", "Searched", query ? `for ${query}` : "files"],
    edit: ["Editing", "Edited", toolTargetName(path, "file")],
    write: ["Writing", "Wrote", toolTargetName(path, "file")],
    web_search: ["Searching", "Searched", query || "the web"],
    web_fetch: ["Fetching", "Fetched", toolInputText(input, "url") || "page"],
    studio_list_image_models: ["Listing", "Listed", "image models"],
    studio_list_video_models: ["Listing", "Listed", "video models"],
    studio_list_media_generation_models: ["Listing", "Listed", "media models"],
    studio_get_media_model_schema: ["Inspecting", "Inspected", "model schema"],
    studio_list_media_generations: ["Listing", "Listed", "media generations"],
    studio_get_media_generation: ["Reading", "Read", "media generation"],
    studio_generate_image: ["Generating", "Generated", "image"],
    studio_generate_video: ["Generating", "Generated", "video"],
  }
  const label = labels[name]

  if (label) {
    return `${running ? label[0] : label[1]} ${label[2]}`
  }

  if (name === "bash") {
    return running ? "Running command" : "Ran command"
  }

  const readableName = String(name || "tool")
    .replace(/[_-]+/g, " ")
    .trim()

  return `${running ? "Using" : "Used"} ${readableName || "tool"}`
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

function fileChangeFromResult(result) {
  const details = getRecord(result?.details)
  const change = getRecord(details?.astraflowFileChange)

  return typeof change?.path === "string" ? change : null
}

function fileChangeDiff(change) {
  if (
    !change ||
    typeof change.path !== "string" ||
    typeof change.newText !== "string"
  ) {
    return []
  }

  return [
    {
      type: "diff",
      path: change.path,
      oldText: typeof change.oldText === "string" ? change.oldText : null,
      newText: change.newText,
      _meta: {
        kind: change.kind,
        revision: change.revision,
        previousRevision: change.previousRevision,
        order: change.order,
        toolCallId: change.toolCallId,
        diffTruncated: change.diffTruncated === true,
      },
    },
  ]
}

function fileChangeMetadata(change) {
  if (!change) {
    return null
  }

  const metadata = { ...change }

  delete metadata.oldText
  delete metadata.newText

  return metadata
}

function structuredToolResultMetadata(result) {
  const details = getRecord(result?.details)
  const structuredContent = getRecord(details?.structuredContent)
  const meta = getRecord(details?.meta)
  const schema = meta?.["astraflow/resultSchema"]

  if (!structuredContent || typeof schema !== "string" || !schema.trim()) {
    return null
  }

  return {
    schema: schema.trim(),
    structuredContent,
  }
}

function toolRawOutput(result) {
  const details = getRecord(result?.details)

  if (!details?.astraflowFileChange) {
    return result
  }

  const providerDetails = { ...details }

  delete providerDetails.astraflowFileChange

  return {
    ...result,
    details:
      Object.keys(providerDetails).length > 0 ? providerDetails : undefined,
  }
}

function toolResultContent(result) {
  return [
    ...resultTextContent(result),
    ...fileChangeDiff(fileChangeFromResult(result)),
  ]
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

function astraflowMeta(
  parentTaskId,
  retry,
  toolInput,
  toolSummary,
  fileChange,
  toolResult
) {
  return {
    astraflow: {
      engine: "pi-agent",
      ...(retry ? { retry } : {}),
      ...(typeof toolInput === "string" ? { toolInput } : {}),
      ...(typeof toolSummary === "string" ? { toolSummary } : {}),
      ...(fileChange ? { fileChange } : {}),
      ...(toolResult ? { toolResult } : {}),
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
  const streamedToolInputs = new Map()
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
            _meta: astraflowMeta(
              parentTaskId,
              null,
              null,
              toolCallSummary(block.name, null, true)
            ),
          })
        }

        return
      }

      if (delta?.type === "toolcall_delta") {
        // `partialJson` is an accumulated snapshot. Forward a bounded preview
        // at no more than ~13 updates/second so a large file write does not
        // become O(n²) protocol or React traffic while still appearing
        // promptly in the UI. The terminal tool update carries the complete
        // bounded input, so skipping an in-between snapshot loses no state.
        const block = delta.partial?.content?.[delta.contentIndex]

        if (
          block?.type === "toolCall" &&
          typeof block.id === "string" &&
          typeof block.partialJson === "string"
        ) {
          const previous = streamedToolInputs.get(block.id)
          const previousLength = previous?.sourceLength ?? -1
          const sourceLength = block.partialJson.length
          const now = Date.now()
          const shouldSend =
            previousLength < 0 ||
            (sourceLength - previousLength >= 2_048 &&
              now - (previous?.sentAt ?? 0) >= 75)

          if (!shouldSend) {
            return
          }

          const inputLimit = 64 * 1024
          const toolInput =
            sourceLength <= inputLimit
              ? block.partialJson
              : `${block.partialJson.slice(0, inputLimit)}\n[tool input truncated]`

          streamedToolInputs.set(block.id, {
            sourceLength,
            toolInput,
            sentAt: now,
          })

          if (previous?.toolInput === toolInput) {
            return
          }

          await notify(client, sessionId, {
            sessionUpdate: "tool_call_update",
            toolCallId: block.id,
            status: "in_progress",
            _meta: astraflowMeta(
              parentTaskId,
              null,
              toolInput,
              toolCallSummary(block.name, null, true)
            ),
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
      streamedToolInputs.delete(event.toolCallId)
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
        rawInput: boundedToolInput(entry.input),
        locations: toolLocations(entry.input),
        _meta: astraflowMeta(
          parentTaskId,
          null,
          null,
          toolCallSummary(entry.name, entry.input, true)
        ),
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
        _meta: astraflowMeta(
          parentTaskId,
          null,
          null,
          toolCallSummary(entry.name, entry.input, true)
        ),
      })
      return
    }

    if (event.type === "tool_execution_end") {
      const entry = toolCalls.get(event.toolCallId) || {
        name: event.toolName || "tool",
        input: {},
      }
      toolCalls.delete(event.toolCallId)
      streamedToolInputs.delete(event.toolCallId)
      const fileChange = fileChangeFromResult(event.result)

      await notify(client, sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: event.toolCallId,
        status: event.isError ? "failed" : "completed",
        rawOutput: toolRawOutput(event.result),
        content: toolResultContent(event.result),
        locations: toolLocations(entry.input),
        _meta: astraflowMeta(
          parentTaskId,
          null,
          null,
          toolCallSummary(entry.name, entry.input, false),
          fileChangeMetadata(fileChange),
          structuredToolResultMetadata(event.result)
        ),
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
