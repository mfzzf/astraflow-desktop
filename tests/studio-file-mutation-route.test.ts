// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { storeFileMutationDiff } from "@/lib/agent/file-mutation-store"
import { resolveStudioFileMutationRoute } from "@/lib/studio-file-mutation-route"

const previousStoreRoot =
  process.env.ASTRAFLOW_FILE_MUTATION_STORE_PATH
const revision = "b".repeat(64)
const previousRevision = "a".repeat(64)
const path = "src/demo file.ts"
const diff = [
  `--- a/${path}`,
  `+++ b/${path}`,
  "@@ -1 +1 @@",
  "-old",
  `+${"new ".repeat(40_000)}`,
].join("\n")
let storeRoot = ""

beforeEach(async () => {
  storeRoot = await mkdtemp(join(tmpdir(), "astraflow-file-mutation-route-"))
  await mkdir(storeRoot, { recursive: true })
  process.env.ASTRAFLOW_FILE_MUTATION_STORE_PATH = storeRoot
})

afterEach(async () => {
  if (previousStoreRoot === undefined) {
    delete process.env.ASTRAFLOW_FILE_MUTATION_STORE_PATH
  } else {
    process.env.ASTRAFLOW_FILE_MUTATION_STORE_PATH = previousStoreRoot
  }

  await rm(storeRoot, { recursive: true, force: true })
})

function fixture() {
  const id = storeFileMutationDiff({
    sessionId: "session-1",
    path,
    revision,
    previousRevision,
    diff,
  })

  expect(id).toMatch(/^[a-f0-9]{64}$/)

  return id!
}

function resolve(
  id: string,
  overrides: Partial<
    Parameters<typeof resolveStudioFileMutationRoute>[0]
  > = {}
) {
  return resolveStudioFileMutationRoute({
    sessionId: "session-1",
    blobId: id,
    path,
    revision,
    sessionExists: (sessionId) =>
      sessionId === "session-1" || sessionId === "session-2",
    ...overrides,
  })
}

describe("file mutation diff route resolution", () => {
  test("serves the full diff for the exact session, path, and revision", () => {
    const result = resolve(fixture())

    expect(result).toMatchObject({
      ok: true,
      mutation: {
        path,
        revision,
        previousRevision,
        diff,
      },
    })
  })

  test("fails closed when session, path, or revision does not match", () => {
    const id = fixture()

    for (const result of [
      resolve(id, { sessionId: "session-2" }),
      resolve(id, { path: "src/other.ts" }),
      resolve(id, { revision: "c".repeat(64) }),
    ]) {
      expect(result).toEqual({
        ok: false,
        status: 404,
        error: "File mutation diff is unavailable or expired.",
      })
    }
  })

  test("rejects incomplete or malformed references before reading", () => {
    const id = fixture()

    for (const result of [
      resolve(id, { path: null }),
      resolve(id, { revision: "untrusted-revision" }),
      resolve("invalid"),
    ]) {
      expect(result).toEqual({
        ok: false,
        status: 400,
        error: "Invalid file mutation reference.",
      })
    }
  })
})
