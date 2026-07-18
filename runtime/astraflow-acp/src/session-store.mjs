import { createHash } from "node:crypto"
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import {
  ASTRAFLOW_ACP_MAX_HISTORY_MESSAGES,
  ASTRAFLOW_ACP_MAX_STATE_BYTES,
  ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
  asErrorMessage,
  getRecord,
} from "./constants.mjs"

function sessionFileName(sessionId) {
  return `${createHash("sha256").update(sessionId).digest("hex")}.json`
}

function isTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value)
}

function isStringArray(value) {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  )
}

function isTextContent(value) {
  const content = getRecord(value)
  return content?.type === "text" && typeof content.text === "string"
}

function isImageContent(value) {
  const content = getRecord(value)
  return (
    content?.type === "image" &&
    typeof content.data === "string" &&
    typeof content.mimeType === "string"
  )
}

function isThinkingContent(value) {
  const content = getRecord(value)
  return content?.type === "thinking" && typeof content.thinking === "string"
}

function isToolCall(value) {
  const content = getRecord(value)
  return (
    content?.type === "toolCall" &&
    typeof content.id === "string" &&
    typeof content.name === "string" &&
    getRecord(content.arguments) !== null
  )
}

function isUsage(value) {
  const usage = getRecord(value)
  const cost = getRecord(usage?.cost)

  return (
    usage !== null &&
    cost !== null &&
    ["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every(
      (key) => typeof usage[key] === "number" && Number.isFinite(usage[key])
    ) &&
    ["input", "output", "cacheRead", "cacheWrite", "total"].every(
      (key) => typeof cost[key] === "number" && Number.isFinite(cost[key])
    )
  )
}

function normalizeHistoryMessage(value) {
  const message = getRecord(value)

  if (!message) {
    return null
  }

  if (
    message.role === "user" &&
    isTimestamp(message.timestamp) &&
    (typeof message.content === "string" ||
      (Array.isArray(message.content) &&
        message.content.every(
          (content) => isTextContent(content) || isImageContent(content)
        )))
  ) {
    return {
      ...message,
    }
  }

  if (
    message.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.every(
      (content) =>
        isTextContent(content) ||
        isThinkingContent(content) ||
        isToolCall(content)
    ) &&
    typeof message.api === "string" &&
    typeof message.provider === "string" &&
    typeof message.model === "string" &&
    isUsage(message.usage) &&
    ["stop", "length", "toolUse", "error", "aborted"].includes(
      message.stopReason
    ) &&
    isTimestamp(message.timestamp)
  ) {
    return {
      ...message,
    }
  }

  if (
    message.role === "toolResult" &&
    typeof message.toolCallId === "string" &&
    typeof message.toolName === "string" &&
    Array.isArray(message.content) &&
    message.content.every(
      (content) => isTextContent(content) || isImageContent(content)
    ) &&
    typeof message.isError === "boolean" &&
    isTimestamp(message.timestamp)
  ) {
    return {
      ...message,
    }
  }

  if (
    message.role === "compactionSummary" &&
    typeof message.summary === "string" &&
    message.summary.trim() &&
    typeof message.tokensBefore === "number" &&
    Number.isFinite(message.tokensBefore) &&
    isTimestamp(message.timestamp)
  ) {
    return {
      role: "compactionSummary",
      summary: message.summary,
      tokensBefore: message.tokensBefore,
      timestamp: message.timestamp,
    }
  }

  return null
}

export function boundedPiHistory(messages) {
  let start = Math.max(0, messages.length - ASTRAFLOW_ACP_MAX_HISTORY_MESSAGES)

  while (start > 0 && messages[start]?.role === "toolResult") {
    start -= 1
  }

  return messages.slice(start)
}

function normalizeSessionRecord(value) {
  const record = getRecord(value)

  if (
    !record ||
    record.schemaVersion !== ASTRAFLOW_ACP_STATE_SCHEMA_VERSION ||
    typeof record.sessionId !== "string" ||
    typeof record.cwd !== "string" ||
    !Array.isArray(record.history)
  ) {
    return null
  }

  const createdAt =
    typeof record.createdAt === "string"
      ? record.createdAt
      : new Date().toISOString()
  const history = record.history.map((message) =>
    normalizeHistoryMessage(message)
  )

  if (history.some((message) => message === null)) {
    return null
  }

  return {
    schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
    sessionId: record.sessionId,
    cwd: record.cwd,
    history: boundedPiHistory(history),
    createdAt,
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date().toISOString(),
    ...(isStringArray(record.additionalDirectories)
      ? { additionalDirectories: [...record.additionalDirectories] }
      : {}),
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.modeId === "string" ? { modeId: record.modeId } : {}),
    ...(typeof record.thinkingLevel === "string"
      ? { thinkingLevel: record.thinkingLevel }
      : {}),
  }
}

export class AstraflowSessionStore {
  constructor({ root }) {
    this.root = path.resolve(root)
  }

  async ensureReady() {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
  }

  filePath(sessionId) {
    return path.join(this.root, sessionFileName(sessionId))
  }

  async load(sessionId) {
    const file = this.filePath(sessionId)
    let content

    try {
      content = await readFile(file)
    } catch (error) {
      if (getRecord(error)?.code === "ENOENT") {
        return null
      }

      throw error
    }

    if (content.byteLength > ASTRAFLOW_ACP_MAX_STATE_BYTES) {
      throw new Error(
        `AstraFlow ACP session ${sessionId} exceeds the state limit.`
      )
    }

    try {
      const record = normalizeSessionRecord(
        JSON.parse(content.toString("utf8"))
      )

      if (!record || record.sessionId !== sessionId) {
        throw new Error("Session checkpoint is invalid.")
      }

      return record
    } catch (error) {
      throw new Error(
        `Could not load AstraFlow ACP session ${sessionId}: ${asErrorMessage(error)}`
      )
    }
  }

  async save(record) {
    await this.ensureReady()
    const normalized = normalizeSessionRecord(record)

    if (!normalized) {
      throw new Error("Refusing to save an invalid AstraFlow ACP session.")
    }

    const content = JSON.stringify(normalized)

    if (Buffer.byteLength(content, "utf8") > ASTRAFLOW_ACP_MAX_STATE_BYTES) {
      throw new Error(
        `AstraFlow ACP session ${normalized.sessionId} exceeds the state limit.`
      )
    }

    const target = this.filePath(normalized.sessionId)
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`

    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 })
    await rename(temporary, target)
  }

  async delete(sessionId) {
    await rm(this.filePath(sessionId), { force: true })
  }

  async list() {
    await this.ensureReady()
    const names = await readdir(this.root)
    const sessions = []

    for (const name of names.filter((entry) => entry.endsWith(".json"))) {
      try {
        const content = await readFile(path.join(this.root, name), "utf8")
        const record = normalizeSessionRecord(JSON.parse(content))

        if (record) {
          sessions.push(record)
        }
      } catch {
        // Ignore a damaged checkpoint in list results. A direct load still
        // reports a precise error for the requested session.
      }
    }

    return sessions.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt)
    )
  }
}
