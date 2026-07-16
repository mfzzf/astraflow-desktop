// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  beginPiWorkspaceHistorySnapshot,
  finishPiWorkspaceHistorySnapshot,
  restorePiWorkspaceHistory,
} from "@/lib/agent/pi-workspace-history"

describe("Pi workspace history bridge", () => {
  let testRoot = ""
  let projectPath = ""
  const originalSandboxRoot =
    process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH

  beforeAll(async () => {
    testRoot = await mkdtemp(join(tmpdir(), "astraflow-history-test-"))
    projectPath = join(testRoot, "project")
    process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(
      testRoot,
      "sandboxes"
    )

    await mkdir(join(projectPath, "node_modules", "fixture"), {
      recursive: true,
    })
    await writeFile(join(projectPath, "tracked.txt"), "before\n")
    await writeFile(join(projectPath, "deleted.txt"), "restore me\n")
    await writeFile(join(projectPath, ".env"), "SECRET=before\n")
    await writeFile(
      join(projectPath, "node_modules", "fixture", "cache.txt"),
      "cache-before\n"
    )
  })

  afterAll(async () => {
    if (originalSandboxRoot === undefined) {
      delete process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH
    } else {
      process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = originalSandboxRoot
    }

    await rm(testRoot, { force: true, recursive: true })
  })

  test("restores create/edit/delete changes without touching secrets or dependencies", async () => {
    const snapshot = await beginPiWorkspaceHistorySnapshot({
      projectPath,
      sessionId: "history-session",
      turnId: "turn-1",
    })

    await writeFile(join(projectPath, "tracked.txt"), "after\n")
    await writeFile(join(projectPath, "created.txt"), "created\n")
    await rm(join(projectPath, "deleted.txt"))
    await writeFile(join(projectPath, ".env"), "SECRET=after\n")
    await writeFile(
      join(projectPath, "node_modules", "fixture", "cache.txt"),
      "cache-after\n"
    )

    const finished = await finishPiWorkspaceHistorySnapshot({
      snapshot,
      turnId: "turn-1",
    })

    await restorePiWorkspaceHistory({
      expectedCurrentRef: finished.afterRef,
      projectPath,
      sessionId: "history-session",
      targetRef: finished.beforeRef,
    })

    expect(await readFile(join(projectPath, "tracked.txt"), "utf8")).toBe(
      "before\n"
    )
    expect(await readFile(join(projectPath, "deleted.txt"), "utf8")).toBe(
      "restore me\n"
    )
    await expect(readFile(join(projectPath, "created.txt"), "utf8")).rejects.toThrow()
    expect(await readFile(join(projectPath, ".env"), "utf8")).toBe(
      "SECRET=after\n"
    )
    expect(
      await readFile(
        join(projectPath, "node_modules", "fixture", "cache.txt"),
        "utf8"
      )
    ).toBe("cache-after\n")

    await restorePiWorkspaceHistory({
      expectedCurrentRef: finished.beforeRef,
      projectPath,
      sessionId: "history-session",
      targetRef: finished.afterRef,
    })

    expect(await readFile(join(projectPath, "tracked.txt"), "utf8")).toBe(
      "after\n"
    )
    expect(await readFile(join(projectPath, "created.txt"), "utf8")).toBe(
      "created\n"
    )
    await expect(readFile(join(projectPath, "deleted.txt"), "utf8")).rejects.toThrow()
  })

  test("refuses to overwrite unsnapshotted workspace edits", async () => {
    const snapshot = await beginPiWorkspaceHistorySnapshot({
      projectPath,
      sessionId: "history-session",
      turnId: "turn-2",
    })

    await writeFile(join(projectPath, "tracked.txt"), "turn-two\n")
    const finished = await finishPiWorkspaceHistorySnapshot({
      snapshot,
      turnId: "turn-2",
    })
    await writeFile(join(projectPath, "tracked.txt"), "manual edit\n")

    await expect(
      restorePiWorkspaceHistory({
        expectedCurrentRef: finished.afterRef,
        projectPath,
        sessionId: "history-session",
        targetRef: finished.beforeRef,
      })
    ).rejects.toThrow("Workspace changed after the last checkpoint")
  })
})
