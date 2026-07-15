// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { getPermissionToolKind } from "@/lib/agent/permission-policy"
import { ensureLocalSandboxWorkspace } from "@/lib/agent/sandbox/local-policy"
import {
  createLocalDownloadFileTool,
  resolveLocalDownloadFilePath,
} from "@/lib/ai/tools/local-download"

describe("local download tool", () => {
  let testRoot = ""
  let projectRoot = ""
  let outsideRoot = ""
  let previousWorkspaceRoot: string | undefined

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "astraflow-local-download-"))
    projectRoot = join(testRoot, "project")
    outsideRoot = join(testRoot, "outside")
    mkdirSync(projectRoot, { recursive: true })
    mkdirSync(outsideRoot, { recursive: true })
    previousWorkspaceRoot = process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH
    process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = join(testRoot, "workspaces")
  })

  afterEach(() => {
    if (previousWorkspaceRoot === undefined) {
      delete process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH
    } else {
      process.env.ASTRAFLOW_SANDBOX_WORKSPACES_PATH = previousWorkspaceRoot
    }

    rmSync(testRoot, { recursive: true, force: true })
  })

  test("allows project and session artifacts but rejects paths outside both", () => {
    const projectFile = join(projectRoot, "outputs", "result.png")
    const sessionRoot = ensureLocalSandboxWorkspace("download-session")
    const sessionFile = join(sessionRoot, "generated", "report.pdf")
    const outsideFile = join(outsideRoot, "private.zip")

    mkdirSync(join(projectRoot, "outputs"), { recursive: true })
    mkdirSync(join(sessionRoot, "generated"), { recursive: true })
    writeFileSync(projectFile, "image")
    writeFileSync(sessionFile, "report")
    writeFileSync(outsideFile, "private")

    expect(
      resolveLocalDownloadFilePath({
        path: projectFile,
        rootDir: projectRoot,
        sessionId: "download-session",
      })
    ).toMatchObject({ path: realpathSync.native(projectFile), size: 5 })
    expect(
      resolveLocalDownloadFilePath({
        path: sessionFile,
        rootDir: projectRoot,
        sessionId: "download-session",
      })
    ).toMatchObject({ path: realpathSync.native(sessionFile), size: 6 })
    expect(() =>
      resolveLocalDownloadFilePath({
        path: outsideFile,
        rootDir: projectRoot,
        sessionId: "download-session",
      })
    ).toThrow("selected project or session workspace")
  })

  test("rejects symlinks that escape an allowed root", () => {
    if (process.platform === "win32") {
      return
    }

    const outsideFile = join(outsideRoot, "escaped.txt")
    const linkedFile = join(projectRoot, "linked.txt")
    writeFileSync(outsideFile, "secret")
    symlinkSync(outsideFile, linkedFile)

    expect(() =>
      resolveLocalDownloadFilePath({
        path: linkedFile,
        rootDir: projectRoot,
        sessionId: "download-session",
      })
    ).toThrow("selected project or session workspace")
  })

  test("is exposed as a no-extra-approval delivery tool", () => {
    const agentTool = createLocalDownloadFileTool({
      rootDir: projectRoot,
      sessionId: "download-session",
    })

    expect(agentTool.name).toBe("download_file")
    expect(getPermissionToolKind(agentTool.name)).toBe("read")
  })
})
