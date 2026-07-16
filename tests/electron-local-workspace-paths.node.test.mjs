import assert from "node:assert/strict"
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
import { afterEach, beforeEach, test } from "node:test"
import { pathToFileURL } from "node:url"

import localWorkspacePaths from "../electron/local-workspace-paths.cjs"

const { resolveExistingLocalPath, resolveLocalWorkspacePath } =
  localWorkspacePaths

let testRoot = ""
let workspaceRoot = ""
let outsideRoot = ""

beforeEach(() => {
  testRoot = mkdtempSync(join(tmpdir(), "astraflow-local-workspace-paths-"))
  workspaceRoot = join(testRoot, "workspace")
  outsideRoot = join(testRoot, "outside")
  mkdirSync(join(workspaceRoot, "src"), { recursive: true })
  mkdirSync(outsideRoot, { recursive: true })
  writeFileSync(join(workspaceRoot, "src", "index.ts"), "export {}\n")
  writeFileSync(join(outsideRoot, "secret.txt"), "outside\n")
})

afterEach(() => {
  rmSync(testRoot, { recursive: true, force: true })
})

test("resolves local IPC targets only inside the selected workspace root", () => {
  const result = resolveLocalWorkspacePath(workspaceRoot, "src/index.ts", {
    kind: "file",
  })

  assert.equal(result.resolvedRoot, realpathSync(workspaceRoot))
  assert.equal(result.resolvedPath, realpathSync(join(workspaceRoot, "src/index.ts")))
  assert.equal(result.stats.isFile(), true)
})

test("rejects relative, absolute, and file-URL escapes", () => {
  const outsideFile = join(outsideRoot, "secret.txt")

  for (const requestedPath of [
    "../outside/secret.txt",
    outsideFile,
    pathToFileURL(outsideFile).toString(),
  ]) {
    assert.throws(
      () => resolveLocalWorkspacePath(workspaceRoot, requestedPath),
      /outside the local workspace/
    )
  }
})

test("resolves symlinks before enforcing the local IPC boundary", (context) => {
  if (process.platform === "win32") {
    context.skip("Windows symlink creation requires additional privileges.")
    return
  }

  const escapedFileLink = join(workspaceRoot, "escaped-file")
  const escapedDirectoryLink = join(workspaceRoot, "escaped-directory")
  symlinkSync(join(outsideRoot, "secret.txt"), escapedFileLink, "file")
  symlinkSync(outsideRoot, escapedDirectoryLink, "dir")

  assert.throws(
    () => resolveLocalWorkspacePath(workspaceRoot, escapedFileLink),
    /outside the local workspace/
  )
  assert.throws(
    () =>
      resolveLocalWorkspacePath(
        workspaceRoot,
        join(escapedDirectoryLink, "secret.txt")
      ),
    /outside the local workspace/
  )
})

test("enforces terminal-directory and preview-file target kinds", () => {
  assert.throws(
    () =>
      resolveLocalWorkspacePath(workspaceRoot, "src/index.ts", {
        kind: "directory",
      }),
    /not a directory/
  )
  assert.throws(
    () =>
      resolveLocalWorkspacePath(workspaceRoot, "src", {
        kind: "file",
      }),
    /not a file/
  )
  assert.throws(
    () =>
      resolveLocalWorkspacePath(workspaceRoot, workspaceRoot, {
        allowRoot: false,
      }),
    /inside the local workspace/
  )
})

test("resolves existing absolute files outside a selected workspace", () => {
  const externalFile = join(outsideRoot, "报告 result.jsonl")

  writeFileSync(externalFile, "{}\n")

  assert.equal(
    resolveExistingLocalPath(externalFile, { kind: "file" }).resolvedPath,
    realpathSync(externalFile)
  )
  assert.equal(
    resolveExistingLocalPath(pathToFileURL(externalFile).toString(), {
      kind: "file",
    }).resolvedPath,
    realpathSync(externalFile)
  )
})

test("rejects relative and missing direct-open paths", () => {
  assert.throws(
    () => resolveExistingLocalPath("outside/secret.txt"),
    /absolute local path/
  )
  assert.throws(() =>
    resolveExistingLocalPath(join(outsideRoot, "missing.txt"))
  )
})
