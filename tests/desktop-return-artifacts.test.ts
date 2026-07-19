// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  isSensitiveDesktopArtifactPath,
  resolveSafeDesktopArtifactFile,
} from "@/lib/cross-device/desktop-return-artifacts"
import { crossDeviceRunUsage } from "@/lib/cross-device/run-usage"
import { isSensitiveCloudArtifactPath } from "@/worker/cloud-sandbox-runtime"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe("Desktop returned artifact boundaries", () => {
  test("accepts a regular file inside the project", async () => {
    const root = await temporaryDirectory()
    await mkdir(join(root, "reports"))
    await writeFile(join(root, "reports", "result.md"), "done")

    const file = await resolveSafeDesktopArtifactFile(root, "reports/result.md")
    expect(file.relativePath).toBe(join("reports", "result.md"))
    expect(file.size).toBe(4)
  })

  test("blocks path and symlink escapes", async () => {
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    await writeFile(join(outside, "secret.txt"), "secret")
    await symlink(outside, join(root, "linked"))

    await expect(
      resolveSafeDesktopArtifactFile(root, "../secret.txt")
    ).rejects.toThrow()
    await expect(
      resolveSafeDesktopArtifactFile(root, "linked/secret.txt")
    ).rejects.toThrow()
  })

  test("blocks common secret and credential file names", () => {
    for (const path of [
      ".env",
      ".env.production",
      ".ssh/id_ed25519",
      "config/private.pem",
      ".git/config",
    ]) {
      expect(isSensitiveDesktopArtifactPath(path)).toBeTrue()
      expect(isSensitiveCloudArtifactPath(path)).toBeTrue()
    }
    expect(isSensitiveDesktopArtifactPath("reports/result.pdf")).toBeFalse()
  })
})

test("cross-device usage drops raw provider metadata", () => {
  const usage = crossDeviceRunUsage({
    input_tokens: 12,
    output_tokens: 3,
    cost: { amount: 0.25, currency: "USD", private: "drop-me" },
    provider_secret: "drop-me",
  })
  expect(usage).toEqual({
    inputTokens: 12,
    outputTokens: 3,
    totalTokens: 15,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    reasoningOutputTokens: 0,
    modelContextWindow: null,
    contextTokensUsed: null,
    contextWindowSize: null,
    cost: { amount: 0.25, currency: "USD" },
  })
  expect(JSON.stringify(usage)).not.toContain("drop-me")
})

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "astraflow-artifact-"))
  directories.push(directory)
  return directory
}
