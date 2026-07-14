import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
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

  return {
    schemaVersion: ASTRAFLOW_ACP_STATE_SCHEMA_VERSION,
    sessionId: record.sessionId,
    cwd: record.cwd,
    history: record.history.slice(-ASTRAFLOW_ACP_MAX_HISTORY_MESSAGES),
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof record.updatedAt === "string"
        ? record.updatedAt
        : new Date().toISOString(),
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
      throw new Error(`AstraFlow ACP session ${sessionId} exceeds the state limit.`)
    }

    try {
      const record = normalizeSessionRecord(JSON.parse(content.toString("utf8")))

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
