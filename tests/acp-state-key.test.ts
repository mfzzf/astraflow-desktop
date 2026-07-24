// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { deriveAcpStateEncryptionKey } from "@/lib/agent/sandbox/state-key"

const ENV_NAMES = [
  "ASTRAFLOW_SECRET_KEY",
  "ASTRAFLOW_ACP_STATE_MASTER_KEY",
  "ASTRAFLOW_ACP_STATE_KEY_PATH",
  "ASTRAFLOW_USER_DATA_PATH",
  "ASTRAFLOW_SQLITE_PATH",
] as const

describe("ACP state key", () => {
  let root = ""
  let previousEnvironment: Record<string, string | undefined>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "astraflow-acp-state-key-"))
    previousEnvironment = Object.fromEntries(
      ENV_NAMES.map((name) => [name, process.env[name]])
    )

    for (const name of ENV_NAMES) {
      delete process.env[name]
    }
  })

  afterEach(() => {
    for (const name of ENV_NAMES) {
      const value = previousEnvironment[name]

      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }

    rmSync(root, { force: true, recursive: true })
  })

  test("derives stable owner-isolated keys from the app secret", () => {
    process.env.ASTRAFLOW_SECRET_KEY = "11".repeat(32)

    const first = deriveAcpStateEncryptionKey("session-a")

    expect(first).toHaveLength(64)
    expect(deriveAcpStateEncryptionKey("session-a")).toBe(first)
    expect(deriveAcpStateEncryptionKey("session-b")).not.toBe(first)
  })

  test("creates a private fallback master key and rejects corruption", () => {
    const keyPath = join(root, "private", "acp-state.key")
    process.env.ASTRAFLOW_ACP_STATE_KEY_PATH = keyPath

    expect(deriveAcpStateEncryptionKey("session-a")).toHaveLength(64)
    expect(readFileSync(keyPath, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/)

    if (process.platform !== "win32") {
      expect(statSync(keyPath).mode & 0o777).toBe(0o600)
    }

    writeFileSync(keyPath, "corrupted\n")
    expect(() => deriveAcpStateEncryptionKey("session-a")).toThrow(
      "Refusing to start with unprotected durable state"
    )
  })
})
