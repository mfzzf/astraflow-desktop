import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
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

const ENCRYPTED_STATE_FORMAT = "astraflow-acp-aes-256-gcm"
const ENCRYPTED_STATE_VERSION = 1
const ENCRYPTED_STATE_OVERHEAD_BYTES = 2_048
const ENCRYPTED_STATE_MAX_BYTES =
  Math.ceil((ASTRAFLOW_ACP_MAX_STATE_BYTES * 4) / 3) +
  ENCRYPTED_STATE_OVERHEAD_BYTES
export const ASTRAFLOW_ACP_STATE_BROKER_METHODS = Object.freeze({
  delete: "_astraflow/state/delete",
  list: "_astraflow/state/list",
  load: "_astraflow/state/load",
  save: "_astraflow/state/save",
})

function sessionFileName(sessionId) {
  return `${createHash("sha256").update(sessionId).digest("hex")}.json`
}

function normalizePlaintextMigrationFiles(values) {
  if (values === undefined || values === null) {
    return new Set()
  }

  if (
    !Array.isArray(values) ||
    !values.every(
      (value) =>
        typeof value === "string" && /^[0-9a-f]{64}\.json$/i.test(value)
    )
  ) {
    throw new Error(
      "AstraFlow ACP plaintext migration files must be checkpoint file names."
    )
  }

  return new Set(values)
}

function normalizeEncryptionKey(value) {
  if (value === undefined || value === null) {
    return null
  }

  if (Buffer.isBuffer(value) && value.byteLength === 32) {
    return Buffer.from(value)
  }

  if (typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)) {
    return Buffer.from(value, "hex")
  }

  throw new Error(
    "AstraFlow ACP state encryption key must be exactly 32 bytes."
  )
}

function stateAdditionalData(fileName) {
  return Buffer.from(
    `astraflow-acp-state:${ENCRYPTED_STATE_VERSION}:${fileName}`,
    "utf8"
  )
}

function isBase64(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

function encryptedEnvelope(value) {
  const envelope = getRecord(value)

  if (
    !envelope ||
    envelope.format !== ENCRYPTED_STATE_FORMAT ||
    envelope.version !== ENCRYPTED_STATE_VERSION ||
    !isBase64(envelope.iv) ||
    !isBase64(envelope.tag) ||
    !isBase64(envelope.ciphertext)
  ) {
    return null
  }

  const iv = Buffer.from(envelope.iv, "base64")
  const tag = Buffer.from(envelope.tag, "base64")
  const ciphertext = Buffer.from(envelope.ciphertext, "base64")

  if (iv.byteLength !== 12 || tag.byteLength !== 16) {
    return null
  }

  return { ciphertext, iv, tag }
}

function encryptState(content, key, fileName) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)

  cipher.setAAD(stateAdditionalData(fileName))
  const ciphertext = Buffer.concat([
    cipher.update(content, "utf8"),
    cipher.final(),
  ])

  return JSON.stringify({
    format: ENCRYPTED_STATE_FORMAT,
    version: ENCRYPTED_STATE_VERSION,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  })
}

function decodeState(content, key, fileName) {
  let parsed

  try {
    parsed = JSON.parse(content.toString("utf8"))
  } catch (error) {
    throw new Error(`Checkpoint JSON is invalid: ${asErrorMessage(error)}`)
  }

  const envelope = encryptedEnvelope(parsed)

  if (!envelope) {
    if (getRecord(parsed)?.format === ENCRYPTED_STATE_FORMAT) {
      throw new Error("Encrypted checkpoint envelope is invalid.")
    }

    return { encrypted: false, value: parsed }
  }

  if (!key) {
    throw new Error(
      "Encrypted checkpoint cannot be opened without the state encryption key."
    )
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, envelope.iv)

    decipher.setAAD(stateAdditionalData(fileName))
    decipher.setAuthTag(envelope.tag)
    const plaintext = Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ])

    if (plaintext.byteLength > ASTRAFLOW_ACP_MAX_STATE_BYTES) {
      throw new Error("Decrypted checkpoint exceeds the state limit.")
    }

    return {
      encrypted: true,
      value: JSON.parse(plaintext.toString("utf8")),
    }
  } catch (error) {
    throw new Error(
      `Encrypted checkpoint authentication failed: ${asErrorMessage(error)}`
    )
  }
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

function brokerContext(value) {
  const context = getRecord(value)
  const desktopSessionId = context?.desktopSessionId
  const client = context?.client

  if (
    typeof desktopSessionId !== "string" ||
    !desktopSessionId.trim() ||
    desktopSessionId.length > 2_048 ||
    typeof client?.request !== "function"
  ) {
    throw new Error(
      "AstraFlow ACP checkpoint broker requires a scoped Desktop client."
    )
  }

  return { client, desktopSessionId }
}

/**
 * Local Desktop mode delegates durable state to its parent over the existing
 * ACP channel. This store has no filesystem path or encryption key and cannot
 * fall back to child-owned persistence when the broker is unavailable.
 */
export class AstraflowBrokerSessionStore {
  async load(sessionId, contextValue) {
    const { client, desktopSessionId } = brokerContext(contextValue)
    const response = await client.request(
      ASTRAFLOW_ACP_STATE_BROKER_METHODS.load,
      { desktopSessionId, sessionId }
    )
    const responseRecord = getRecord(response)

    if (!responseRecord || !("record" in responseRecord)) {
      throw new Error("AstraFlow ACP checkpoint broker returned an invalid load.")
    }
    if (responseRecord.record === null) {
      return null
    }

    const record = normalizeSessionRecord(responseRecord.record)

    if (!record || record.sessionId !== sessionId) {
      throw new Error("AstraFlow ACP checkpoint broker returned another session.")
    }

    return record
  }

  async save(value, contextValue) {
    const { client, desktopSessionId } = brokerContext(contextValue)
    const record = normalizeSessionRecord(value)

    if (!record) {
      throw new Error("Refusing to save an invalid AstraFlow ACP session.")
    }

    const plaintext = JSON.stringify(record)

    if (Buffer.byteLength(plaintext, "utf8") > ASTRAFLOW_ACP_MAX_STATE_BYTES) {
      throw new Error(
        `AstraFlow ACP session ${record.sessionId} exceeds the state limit.`
      )
    }

    await client.request(ASTRAFLOW_ACP_STATE_BROKER_METHODS.save, {
      desktopSessionId,
      sessionId: record.sessionId,
      record,
    })
  }

  async delete(sessionId, contextValue) {
    const { client, desktopSessionId } = brokerContext(contextValue)

    await client.request(ASTRAFLOW_ACP_STATE_BROKER_METHODS.delete, {
      desktopSessionId,
      sessionId,
    })
  }

  async list(contextValue) {
    const { client, desktopSessionId } = brokerContext(contextValue)
    const response = await client.request(
      ASTRAFLOW_ACP_STATE_BROKER_METHODS.list,
      { desktopSessionId }
    )
    const records = getRecord(response)?.records

    if (!Array.isArray(records)) {
      throw new Error("AstraFlow ACP checkpoint broker returned an invalid list.")
    }

    return records.map((value) => {
      const record = normalizeSessionRecord(value)

      if (!record) {
        throw new Error(
          "AstraFlow ACP checkpoint broker returned an invalid session."
        )
      }

      return record
    })
  }
}

export class AstraflowSessionStore {
  constructor({ encryptionKey, plaintextMigrationFiles, root }) {
    this.root = path.resolve(root)
    this.encryptionKey = normalizeEncryptionKey(encryptionKey)
    this.plaintextMigrationFiles = normalizePlaintextMigrationFiles(
      plaintextMigrationFiles
    )
    this.readyPromise = null
  }

  async ensureReady() {
    if (!this.readyPromise) {
      this.readyPromise = this.initialize()
    }

    return this.readyPromise
  }

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 })

    if (!this.encryptionKey || this.plaintextMigrationFiles.size === 0) {
      return
    }

    for (const name of [...this.plaintextMigrationFiles]) {
      const file = path.join(this.root, name)
      let content

      try {
        content = await readFile(file)
      } catch (error) {
        if (getRecord(error)?.code === "ENOENT") {
          this.plaintextMigrationFiles.delete(name)
          continue
        }

        throw error
      }

      if (content.byteLength > ASTRAFLOW_ACP_MAX_STATE_BYTES) {
        throw new Error(`Legacy AstraFlow ACP checkpoint ${name} is too large.`)
      }

      const decoded = decodeState(content, this.encryptionKey, name)

      if (decoded.encrypted) {
        this.plaintextMigrationFiles.delete(name)
        continue
      }

      const record = normalizeSessionRecord(decoded.value)

      if (!record || sessionFileName(record.sessionId) !== name) {
        throw new Error(`Legacy AstraFlow ACP checkpoint ${name} is invalid.`)
      }

      await this.writeNormalized(record)
      this.plaintextMigrationFiles.delete(name)
    }
  }

  filePath(sessionId) {
    return path.join(this.root, sessionFileName(sessionId))
  }

  async load(sessionId) {
    await this.ensureReady()
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

    if (
      content.byteLength >
      (this.encryptionKey
        ? ENCRYPTED_STATE_MAX_BYTES
        : ASTRAFLOW_ACP_MAX_STATE_BYTES)
    ) {
      throw new Error(
        `AstraFlow ACP session ${sessionId} exceeds the state limit.`
      )
    }

    try {
      const decoded = decodeState(
        content,
        this.encryptionKey,
        path.basename(file)
      )
      const record = normalizeSessionRecord(decoded.value)

      if (!record || record.sessionId !== sessionId) {
        throw new Error("Session checkpoint is invalid.")
      }

      if (this.encryptionKey && !decoded.encrypted) {
        throw new Error(
          "Unencrypted checkpoint is not an authorized legacy migration."
        )
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
    await this.writeNormalized(record)
  }

  async writeNormalized(record) {
    const normalized = normalizeSessionRecord(record)

    if (!normalized) {
      throw new Error("Refusing to save an invalid AstraFlow ACP session.")
    }

    const plaintext = JSON.stringify(normalized)

    if (Buffer.byteLength(plaintext, "utf8") > ASTRAFLOW_ACP_MAX_STATE_BYTES) {
      throw new Error(
        `AstraFlow ACP session ${normalized.sessionId} exceeds the state limit.`
      )
    }

    const target = this.filePath(normalized.sessionId)
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
    const content = this.encryptionKey
      ? encryptState(plaintext, this.encryptionKey, path.basename(target))
      : plaintext

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
        const content = await readFile(path.join(this.root, name))

        if (
          content.byteLength >
          (this.encryptionKey
            ? ENCRYPTED_STATE_MAX_BYTES
            : ASTRAFLOW_ACP_MAX_STATE_BYTES)
        ) {
          continue
        }

        const decoded = decodeState(content, this.encryptionKey, name)
        const record = normalizeSessionRecord(decoded.value)

        if (
          record &&
          sessionFileName(record.sessionId) === name &&
          (!this.encryptionKey || decoded.encrypted)
        ) {
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
