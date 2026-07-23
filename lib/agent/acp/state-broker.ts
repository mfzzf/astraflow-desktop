import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

import { getLegacyAcpWorkspacePath } from "@/lib/agent/acp/workspace"
import { deriveAcpStateEncryptionKey } from "@/lib/agent/sandbox/state-key"
import { safeFileName } from "@/lib/studio-file-storage"

export const ACP_STATE_BROKER_METHODS = {
  delete: "_astraflow/state/delete",
  list: "_astraflow/state/list",
  load: "_astraflow/state/load",
  save: "_astraflow/state/save",
} as const

const ACP_STATE_SCHEMA_VERSION = 2
const MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024
const MAX_OWNER_STORAGE_BYTES = 64 * 1024 * 1024
const MAX_OWNER_SESSIONS = 512
const ENCRYPTED_STATE_FORMAT = "astraflow-acp-aes-256-gcm"
const ENCRYPTED_STATE_VERSION = 1
const ENCRYPTED_STATE_OVERHEAD_BYTES = 2_048
const MAX_ENCRYPTED_CHECKPOINT_BYTES =
  Math.ceil((MAX_CHECKPOINT_BYTES * 4) / 3) +
  ENCRYPTED_STATE_OVERHEAD_BYTES
const SESSION_FILE_PATTERN = /^[0-9a-f]{64}\.json$/i
const rootWriteTails = new Map<string, Promise<void>>()

type StateRecord = Record<string, unknown> & {
  schemaVersion: number
  sessionId: string
  cwd: string
  history: unknown[]
}

export type AcpStateScopedRequest = {
  desktopSessionId: string
  sessionId: string
}

export type AcpStateListRequest = {
  desktopSessionId: string
}

export type AcpStateSaveRequest = AcpStateScopedRequest & {
  record: StateRecord
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requireNonEmptyString(
  value: unknown,
  label: string,
  maxLength = 2_048
) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    throw new Error(`${label} must be a non-empty bounded string.`)
  }

  return value
}

function normalizeStateRecord(
  value: unknown,
  expectedSessionId?: string
): StateRecord {
  const record = getRecord(value)

  if (
    !record ||
    record.schemaVersion !== ACP_STATE_SCHEMA_VERSION ||
    !Array.isArray(record.history)
  ) {
    throw new Error("AstraFlow ACP checkpoint record is invalid.")
  }

  const sessionId = requireNonEmptyString(
    record.sessionId,
    "AstraFlow ACP checkpoint sessionId"
  )
  const cwd = requireNonEmptyString(
    record.cwd,
    "AstraFlow ACP checkpoint cwd",
    32_768
  )

  if (!isAbsolute(cwd)) {
    throw new Error("AstraFlow ACP checkpoint cwd must be absolute.")
  }
  if (expectedSessionId !== undefined && sessionId !== expectedSessionId) {
    throw new Error(
      "AstraFlow ACP checkpoint sessionId does not match the requested session."
    )
  }

  let serialized: string

  try {
    serialized = JSON.stringify(record)
  } catch {
    throw new Error("AstraFlow ACP checkpoint must be JSON serializable.")
  }

  if (Buffer.byteLength(serialized, "utf8") > MAX_CHECKPOINT_BYTES) {
    throw new Error(
      `AstraFlow ACP session ${sessionId} exceeds the state limit.`
    )
  }

  return record as StateRecord
}

function parseScopedRequest(value: unknown): AcpStateScopedRequest {
  const record = getRecord(value)

  if (!record) {
    throw new Error("AstraFlow ACP state request params must be an object.")
  }

  return {
    desktopSessionId: requireNonEmptyString(
      record.desktopSessionId,
      "AstraFlow Desktop sessionId"
    ),
    sessionId: requireNonEmptyString(
      record.sessionId,
      "AstraFlow ACP sessionId"
    ),
  }
}

export const acpStateScopedRequestParser = {
  parse: parseScopedRequest,
}

export const acpStateListRequestParser = {
  parse(value: unknown): AcpStateListRequest {
    const record = getRecord(value)

    if (!record) {
      throw new Error("AstraFlow ACP state request params must be an object.")
    }

    return {
      desktopSessionId: requireNonEmptyString(
        record.desktopSessionId,
        "AstraFlow Desktop sessionId"
      ),
    }
  },
}

export const acpStateSaveRequestParser = {
  parse(value: unknown): AcpStateSaveRequest {
    const request = parseScopedRequest(value)
    const record = getRecord(value)

    return {
      ...request,
      record: normalizeStateRecord(record?.record, request.sessionId),
    }
  },
}

function sessionFileName(sessionId: string) {
  return `${createHash("sha256").update(sessionId).digest("hex")}.json`
}

function stateAdditionalData(fileName: string) {
  return Buffer.from(
    `astraflow-acp-state:${ENCRYPTED_STATE_VERSION}:${fileName}`,
    "utf8"
  )
}

function isBase64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
}

function decodeEncryptedState(
  content: Buffer,
  key: Buffer,
  fileName: string
): StateRecord {
  if (content.byteLength > MAX_ENCRYPTED_CHECKPOINT_BYTES) {
    throw new Error("Encrypted AstraFlow ACP checkpoint exceeds the limit.")
  }

  let value: unknown

  try {
    value = JSON.parse(content.toString("utf8"))
  } catch {
    throw new Error("Encrypted AstraFlow ACP checkpoint JSON is invalid.")
  }

  const envelope = getRecord(value)

  if (
    envelope?.format !== ENCRYPTED_STATE_FORMAT ||
    envelope.version !== ENCRYPTED_STATE_VERSION ||
    !isBase64(envelope.iv) ||
    !isBase64(envelope.tag) ||
    !isBase64(envelope.ciphertext)
  ) {
    throw new Error("Encrypted AstraFlow ACP checkpoint envelope is invalid.")
  }

  const iv = Buffer.from(envelope.iv, "base64")
  const tag = Buffer.from(envelope.tag, "base64")
  const ciphertext = Buffer.from(envelope.ciphertext, "base64")

  if (iv.byteLength !== 12 || tag.byteLength !== 16) {
    throw new Error("Encrypted AstraFlow ACP checkpoint envelope is invalid.")
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv)

    decipher.setAAD(stateAdditionalData(fileName))
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ])

    if (plaintext.byteLength > MAX_CHECKPOINT_BYTES) {
      throw new Error("Decrypted checkpoint exceeds the state limit.")
    }

    return normalizeStateRecord(JSON.parse(plaintext.toString("utf8")))
  } catch (error) {
    throw new Error(
      `Encrypted AstraFlow ACP checkpoint authentication failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

function encryptState(record: StateRecord, key: Buffer, fileName: string) {
  const plaintext = JSON.stringify(record)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)

  cipher.setAAD(stateAdditionalData(fileName))
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
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

function privateStateRoot(stateOwnerId: string) {
  const userDataRoot = process.env.ASTRAFLOW_USER_DATA_PATH?.trim()
  const sqlitePath = process.env.ASTRAFLOW_SQLITE_PATH?.trim()
  const privateRoot = userDataRoot
    ? resolve(userDataRoot)
    : sqlitePath
      ? dirname(resolve(sqlitePath))
      : join(process.cwd(), ".data")

  return join(privateRoot, "acp-state", safeFileName(stateOwnerId))
}

function secureDirectory(root: string) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const info = lstatSync(root)

  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(
      "AstraFlow ACP checkpoint root must be a private regular directory."
    )
  }
  if (process.platform !== "win32") {
    chmodSync(root, 0o700)
  }
}

function checkpointFileInfo(path: string) {
  try {
    const info = lstatSync(path)

    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(
        "AstraFlow ACP checkpoint storage contains a non-regular file."
      )
    }

    return info
  } catch (error) {
    if (getRecord(error)?.code === "ENOENT") {
      return null
    }
    throw error
  }
}

function readCheckpoint(path: string) {
  const info = checkpointFileInfo(path)

  if (!info) {
    return null
  }

  return readFileSync(path)
}

function writeAtomic(target: string, content: string) {
  const temporary = `${target}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`

  try {
    writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 })
    renameSync(temporary, target)
    if (process.platform !== "win32") {
      chmodSync(target, 0o600)
    }
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      // Best-effort cleanup; the private directory remains owner-only.
    }
    throw error
  }
}

function migrateLegacyState(
  stateOwnerId: string,
  targetRoot: string,
  key: Buffer
) {
  const legacyRoot = join(
    getLegacyAcpWorkspacePath(stateOwnerId),
    ".astraflow-acp-state"
  )

  if (!existsSync(legacyRoot) || resolve(legacyRoot) === resolve(targetRoot)) {
    return
  }
  const legacyInfo = lstatSync(legacyRoot)

  if (!legacyInfo.isDirectory() || legacyInfo.isSymbolicLink()) {
    throw new Error(
      "Legacy AstraFlow ACP checkpoint root must be a regular directory."
    )
  }

  for (const entry of readdirSync(legacyRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !SESSION_FILE_PATTERN.test(entry.name)) {
      continue
    }

    const source = join(legacyRoot, entry.name)
    const target = join(targetRoot, entry.name)

    const existing = readCheckpoint(target)

    if (existing) {
      decodeEncryptedState(existing, key, entry.name)
      unlinkSync(source)
      continue
    }

    const plaintext = readCheckpoint(source)

    if (!plaintext) {
      continue
    }
    if (plaintext.byteLength > MAX_CHECKPOINT_BYTES) {
      throw new Error(`Legacy AstraFlow ACP checkpoint is too large: ${source}`)
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(plaintext.toString("utf8"))
    } catch {
      throw new Error(`Legacy AstraFlow ACP checkpoint is invalid: ${source}`)
    }

    const record = normalizeStateRecord(parsed)

    if (sessionFileName(record.sessionId) !== entry.name) {
      throw new Error(
        `Legacy AstraFlow ACP checkpoint identity is invalid: ${source}`
      )
    }

    writeAtomic(target, encryptState(record, key, entry.name))
    unlinkSync(source)
  }
}

async function withRootWriteLock<T>(
  root: string,
  operation: () => Promise<T> | T
): Promise<T> {
  const previous = rootWriteTails.get(root) ?? Promise.resolve()
  let release: (() => void) | undefined
  const current = new Promise<void>((resolveLock) => {
    release = resolveLock
  })
  const tail = previous.then(() => current)

  rootWriteTails.set(root, tail)
  await previous

  try {
    return await operation()
  } finally {
    release?.()
    if (rootWriteTails.get(root) === tail) {
      rootWriteTails.delete(root)
    }
  }
}

/**
 * Desktop-owned encrypted checkpoint store. Private state and its encryption
 * key stay in private fields so the stdio command can carry this broker
 * capability without serializing either value into child argv/env/sandbox.
 */
export class AcpStateBroker {
  readonly #desktopSessionId: string
  readonly #key: Buffer
  readonly #root: string

  constructor({
    desktopSessionId,
    stateOwnerId,
  }: {
    desktopSessionId: string
    stateOwnerId: string
  }) {
    this.#desktopSessionId = requireNonEmptyString(
      desktopSessionId,
      "AstraFlow Desktop sessionId"
    )
    const ownerId = requireNonEmptyString(
      stateOwnerId,
      "AstraFlow state owner id"
    )

    this.#root = privateStateRoot(ownerId)
    this.#key = Buffer.from(deriveAcpStateEncryptionKey(ownerId), "hex")
    secureDirectory(this.#root)
    migrateLegacyState(ownerId, this.#root, this.#key)
  }

  #assertDesktopScope(desktopSessionId: string) {
    if (desktopSessionId !== this.#desktopSessionId) {
      throw new Error(
        "AstraFlow ACP state request does not belong to this Desktop session."
      )
    }
  }

  #path(sessionId: string) {
    return join(this.#root, sessionFileName(sessionId))
  }

  load({ desktopSessionId, sessionId }: AcpStateScopedRequest) {
    this.#assertDesktopScope(desktopSessionId)
    const target = this.#path(sessionId)

    const content = readCheckpoint(target)

    if (!content) {
      return { record: null }
    }

    const record = decodeEncryptedState(
      content,
      this.#key,
      basename(target)
    )

    if (record.sessionId !== sessionId) {
      throw new Error(
        "AstraFlow ACP checkpoint identity does not match its file name."
      )
    }

    return { record }
  }

  async save({
    desktopSessionId,
    record,
    sessionId,
  }: AcpStateSaveRequest) {
    this.#assertDesktopScope(desktopSessionId)
    const normalized = normalizeStateRecord(record, sessionId)

    await withRootWriteLock(this.#root, () => {
      secureDirectory(this.#root)
      const target = this.#path(sessionId)
      const names = readdirSync(this.#root).filter((name) =>
        SESSION_FILE_PATTERN.test(name)
      )
      const creating = checkpointFileInfo(target) === null

      if (creating && names.length >= MAX_OWNER_SESSIONS) {
        throw new Error(
          "AstraFlow ACP state owner exceeds the session checkpoint limit."
        )
      }

      const content = encryptState(normalized, this.#key, basename(target))
      const currentBytes = names.reduce((total, name) => {
        const path = join(this.#root, name)
        const info = checkpointFileInfo(path)

        return path === target || !info ? total : total + info.size
      }, 0)

      if (
        currentBytes + Buffer.byteLength(content, "utf8") >
        MAX_OWNER_STORAGE_BYTES
      ) {
        throw new Error(
          "AstraFlow ACP state owner exceeds the storage quota."
        )
      }

      writeAtomic(target, content)
    })

    return {}
  }

  async delete({ desktopSessionId, sessionId }: AcpStateScopedRequest) {
    this.#assertDesktopScope(desktopSessionId)
    await withRootWriteLock(this.#root, () => {
      const target = this.#path(sessionId)

      if (checkpointFileInfo(target)) {
        unlinkSync(target)
      }
    })
    return {}
  }

  list({ desktopSessionId }: AcpStateListRequest) {
    this.#assertDesktopScope(desktopSessionId)
    const records: StateRecord[] = []

    for (const name of readdirSync(this.#root).filter((entry) =>
      SESSION_FILE_PATTERN.test(entry)
    )) {
      try {
        const content = readCheckpoint(join(this.#root, name))

        if (!content) {
          continue
        }

        const record = decodeEncryptedState(content, this.#key, name)

        if (sessionFileName(record.sessionId) === name) {
          records.push(record)
        }
      } catch {
        // A damaged checkpoint is omitted from list. Direct load still reports
        // the authenticated failure for the requested session.
      }
    }

    return {
      records: records.sort((left, right) =>
        String(right.updatedAt ?? "").localeCompare(
          String(left.updatedAt ?? "")
        )
      ),
    }
  }
}
