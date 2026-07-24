import { createHmac, randomBytes } from "node:crypto"
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const STATE_KEY_BYTES = 32
const STATE_KEY_PATTERN = /^[0-9a-f]{64}$/i
const STATE_KEY_DERIVATION_LABEL = "astraflow-acp-state:v1"

export function getAcpStateMasterKeyPath() {
  const configured = process.env.ASTRAFLOW_ACP_STATE_KEY_PATH?.trim()

  if (configured) {
    return resolve(configured)
  }

  const userData = process.env.ASTRAFLOW_USER_DATA_PATH?.trim()

  if (userData) {
    return join(resolve(userData), "acp-state.key")
  }

  const sqlitePath = process.env.ASTRAFLOW_SQLITE_PATH?.trim()

  if (sqlitePath) {
    return join(dirname(resolve(sqlitePath)), "acp-state.key")
  }

  return join(process.cwd(), ".data", "acp-state.key")
}

function readMasterKey(path: string) {
  const value = readFileSync(path, "utf8").trim()

  if (!STATE_KEY_PATTERN.test(value)) {
    throw new Error(
      `AstraFlow ACP state key at ${path} is invalid. Refusing to start with unprotected durable state.`
    )
  }

  return Buffer.from(value, "hex")
}

function getOrCreateFallbackMasterKey() {
  const path = getAcpStateMasterKeyPath()

  try {
    return readMasterKey(path)
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : null

    if (code !== "ENOENT") {
      throw error
    }
  }

  const keyDirectory = dirname(path)
  mkdirSync(keyDirectory, { recursive: true, mode: 0o700 })
  if (process.platform !== "win32") {
    chmodSync(keyDirectory, 0o700)
  }
  const generated = randomBytes(STATE_KEY_BYTES).toString("hex")

  try {
    writeFileSync(path, `${generated}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : null

    if (code !== "EEXIST") {
      throw error
    }
  }

  try {
    chmodSync(path, 0o600)
  } catch (error) {
    if (process.platform !== "win32") {
      throw error
    }

    // Windows ACLs are enforced by the OS sandbox account instead of POSIX mode.
  }

  return readMasterKey(path)
}

function getMasterKey() {
  const appSecret = process.env.ASTRAFLOW_SECRET_KEY?.trim()

  if (appSecret) {
    if (!STATE_KEY_PATTERN.test(appSecret)) {
      throw new Error("ASTRAFLOW_SECRET_KEY must be a 32-byte hex value.")
    }

    return Buffer.from(appSecret, "hex")
  }

  const explicit = process.env.ASTRAFLOW_ACP_STATE_MASTER_KEY?.trim()

  if (explicit) {
    if (!STATE_KEY_PATTERN.test(explicit)) {
      throw new Error(
        "ASTRAFLOW_ACP_STATE_MASTER_KEY must be a 32-byte hex value."
      )
    }

    return Buffer.from(explicit, "hex")
  }

  return getOrCreateFallbackMasterKey()
}

export function deriveAcpStateEncryptionKey(stateOwnerId: string) {
  const owner = stateOwnerId.trim()

  if (!owner) {
    throw new Error("AstraFlow ACP state owner id must not be empty.")
  }

  return createHmac("sha256", getMasterKey())
    .update(STATE_KEY_DERIVATION_LABEL)
    .update("\0")
    .update(owner)
    .digest("hex")
}
