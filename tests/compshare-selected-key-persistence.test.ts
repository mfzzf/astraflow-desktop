import assert from "node:assert/strict"
import { beforeEach, describe, test } from "node:test"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { mock } from "bun:test"

const settings = new Map<
  string,
  { key: string; value: string; updated_at: string }
>()
let writeSequence = 0

mock.module("server-only", () => ({}))
mock.module("@/lib/compshare/config", () => ({
  COMPSHARE_CHANNEL_SLUG: "compshare",
  isCompShareChannel: () => true,
}))
mock.module(
  new URL("../lib/studio-db/helpers.ts", import.meta.url).href,
  () => ({
    deleteStudioSetting: (key: string) => settings.delete(key),
    readSecretSetting: (key: string) => settings.get(key) ?? null,
    writeSecretSetting: (key: string, value: string) => {
      const updatedAt = `2026-07-22T00:00:${String(writeSequence++).padStart(2, "0")}.000Z`
      settings.set(key, { key, value, updated_at: updatedAt })
      return updatedAt
    },
  })
)
mock.module(
  new URL("../lib/studio-db/api-keys.ts", import.meta.url).href,
  () => ({
    getStudioOAuthTokens: () => null,
  })
)

const storage = await import("@/lib/studio-db/compshare")

const accountA = {
  publicKey: "public-account-a",
  privateKey: "private-account-a",
}
const accountB = {
  publicKey: "public-account-b",
  privateKey: "private-account-b",
}
const selectedKey = {
  keyCode: "key-selected",
  apiKey: "sk-selected",
  userPlanCode: "user-plan-selected",
  planCode: "plan-selected",
  name: "Selected key",
}

beforeEach(() => {
  settings.clear()
  writeSequence = 0
})

describe("CompShare selected key logout persistence", () => {
  test("restores the selected key after logging back into the same account", () => {
    storage.saveCompShareCredentials(accountA)
    storage.saveCompShareSelectedApiKey(selectedKey)

    storage.clearCompShareCredentials()

    assert.equal(storage.getCompShareControlCredentials(), null)
    assert.equal(storage.getCompShareSelectedApiKey(), null)

    storage.saveCompShareCredentials(accountA)

    const restored = storage.getCompShareSelectedApiKey()
    assert.ok(restored)
    const { updatedAt, ...persistedKey } = restored
    assert.deepEqual(persistedKey, selectedKey)
    assert.match(updatedAt, /^2026-07-22T/)
  })

  test("discards a remembered key when a different account logs in", () => {
    storage.saveCompShareCredentials(accountA)
    storage.saveCompShareSelectedApiKey(selectedKey)
    storage.clearCompShareCredentials()

    storage.saveCompShareCredentials(accountB)

    assert.equal(storage.getCompShareSelectedApiKey(), null)
  })
})
