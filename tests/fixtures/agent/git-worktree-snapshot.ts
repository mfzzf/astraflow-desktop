import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  beginGitWorktreeSnapshot,
  finishGitWorktreeSnapshot,
} from "@/lib/agent/git-worktree-snapshot"
import {
  createUnifiedFileDiff,
  parseUnifiedDiffToFileChanges,
} from "@/lib/agent/unified-diff"

const temporaryDirectories: string[] = []

function createTemporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "astraflow-snapshot-test-"))

  temporaryDirectories.push(directory)

  return directory
}

function git(repository: string, args: string[]) {
  return execFileSync("git", ["-C", repository, ...args], {
    encoding: "utf8",
  })
}

function initializeRepository() {
  const repository = createTemporaryDirectory()

  git(repository, ["init", "--quiet"])
  git(repository, ["config", "user.email", "snapshot@example.com"])
  git(repository, ["config", "user.name", "Snapshot Test"])

  return repository
}

try {
  const patchRepository = initializeRepository()
  const patchFilePath = join(patchRepository, "app.ts")

  writeFileSync(patchFilePath, "old\nkeep\n")
  const diff = createUnifiedFileDiff({
    path: "app.ts",
    previousContent: "old\nkeep\n",
    nextContent: "new\nkeep\n",
  })

  assert.ok(diff)
  writeFileSync(join(patchRepository, "change.patch"), diff)
  git(patchRepository, ["apply", "--check", "change.patch"])
  git(patchRepository, ["apply", "change.patch"])
  assert.equal(readFileSync(patchFilePath, "utf8"), "new\nkeep\n")

  const subdirectoryPatchRepository = initializeRepository()
  const subdirectoryPatchRoot = join(subdirectoryPatchRepository, "project")

  mkdirSync(subdirectoryPatchRoot)
  writeFileSync(join(subdirectoryPatchRoot, "nested.ts"), "before\n")
  git(subdirectoryPatchRepository, ["add", "-A"])
  git(subdirectoryPatchRepository, ["commit", "--quiet", "-m", "initial"])

  const relativePatch = createUnifiedFileDiff({
    path: "nested.ts",
    previousContent: "before\n",
    nextContent: "after\n",
  })

  assert.ok(relativePatch)
  writeFileSync(
    join(subdirectoryPatchRepository, "relative.patch"),
    relativePatch
  )
  git(subdirectoryPatchRepository, [
    "apply",
    "--check",
    "--directory=project",
    "relative.patch",
  ])
  git(subdirectoryPatchRepository, [
    "apply",
    "--directory=project",
    "relative.patch",
  ])
  assert.equal(
    readFileSync(join(subdirectoryPatchRoot, "nested.ts"), "utf8"),
    "after\n"
  )

  assert.deepEqual(
    parseUnifiedDiffToFileChanges(
      "diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n"
    ),
    [
      {
        type: "file_change",
        path: "image.png",
        kind: "edit",
        status: "complete",
        diff: "diff --git a/image.png b/image.png\nBinary files a/image.png and b/image.png differ\n",
      },
    ]
  )
  assert.equal(
    parseUnifiedDiffToFileChanges(
      'diff --git "a/\\344\\270\\255\\346\\226\\207.ts" "b/\\344\\270\\255\\346\\226\\207.ts"\nold mode 100644\nnew mode 100755\n'
    )[0]?.path,
    "中文.ts"
  )

  const repository = initializeRepository()
  const projectPath = join(repository, "project")

  mkdirSync(projectPath)
  writeFileSync(join(projectPath, "tracked.txt"), "base\n")
  writeFileSync(join(projectPath, "deleted.txt"), "delete me\n")
  writeFileSync(join(repository, "outside.txt"), "outside base\n")
  writeFileSync(join(repository, ".gitignore"), "project/ignored.txt\n")
  git(repository, ["add", "-A"])
  git(repository, ["commit", "--quiet", "-m", "initial"])

  // This dirty line predates the agent run and must only be context in the
  // run-level patch, not an attributed addition.
  writeFileSync(join(projectPath, "tracked.txt"), "base\nuser\n")
  const realIndexBefore = readFileSync(join(repository, ".git", "index"))
  const snapshot = await beginGitWorktreeSnapshot(projectPath)

  assert.ok(snapshot)

  writeFileSync(join(projectPath, "tracked.txt"), "base\nuser\nagent\n")
  writeFileSync(join(projectPath, "created.txt"), "created\n")
  rmSync(join(projectPath, "deleted.txt"))
  writeFileSync(join(projectPath, "ignored.txt"), "ignored\n")
  // A concurrent change outside the bound project must not be attributed.
  writeFileSync(join(repository, "outside.txt"), "outside changed\n")

  const changes = await finishGitWorktreeSnapshot(snapshot)

  assert.deepEqual(
    changes?.map((change) => [change.path, change.kind]).sort(),
    [
      ["created.txt", "create"],
      ["deleted.txt", "delete"],
      ["tracked.txt", "edit"],
    ]
  )

  const trackedDiff = changes?.find(
    (change) => change.path === "tracked.txt"
  )?.diff

  assert.match(trackedDiff ?? "", /^\+agent$/m)
  assert.doesNotMatch(trackedDiff ?? "", /^\+user$/m)
  assert.equal(
    changes?.some((change) => change.path === "outside.txt"),
    false
  )
  assert.deepEqual(
    readFileSync(join(repository, ".git", "index")),
    realIndexBefore
  )

  assert.equal(await beginGitWorktreeSnapshot(createTemporaryDirectory()), null)
} finally {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { force: true, recursive: true })
  }
}
