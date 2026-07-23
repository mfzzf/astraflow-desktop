// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  isExactStudioGitWorkspaceRoot,
  resolveStudioLocalGitWorkspaceRoot,
} from "@/lib/studio-git-workspace"
import type { StudioLocalProject, StudioWorkspace } from "@/lib/studio-types"

const temporaryPaths: string[] = []

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), "astraflow-git-workspace-"))
  const nested = join(root, "nested")

  temporaryPaths.push(root)
  mkdirSync(nested)
  execFileSync("git", ["-C", root, "init", "-q"], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  })

  return { root, nested }
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe("local Git workspace root", () => {
  test("accepts the exact registered repository root", async () => {
    const { root } = createRepository()

    expect(await isExactStudioGitWorkspaceRoot(root)).toBe(true)
  })

  test("rejects a nested folder so sibling repository paths cannot leak", async () => {
    const { nested } = createRepository()

    expect(await isExactStudioGitWorkspaceRoot(nested)).toBe(false)
  })

  test("rejects an ordinary non-Git workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "astraflow-non-git-workspace-"))
    temporaryPaths.push(root)

    expect(await isExactStudioGitWorkspaceRoot(root)).toBe(false)
  })

  test("rejects sandbox and mismatched local workspace bindings", async () => {
    const { root } = createRepository()
    const timestamps = {
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
      lastOpenedAt: null,
    }
    const project: StudioLocalProject = {
      ...timestamps,
      id: "project-1",
      name: "Project",
      path: root,
    }
    const sandboxWorkspace: StudioWorkspace = {
      ...timestamps,
      id: "workspace-sandbox",
      type: "sandbox",
      origin: "remote_sandbox",
      name: "Sandbox",
      rootPath: "/workspace/project-a",
      sandboxId: "sandbox-1",
      allocationKey: null,
      createdBySessionId: null,
    }
    const mismatchedLocalWorkspace: StudioWorkspace = {
      ...timestamps,
      id: "workspace-local",
      type: "local",
      origin: "selected_local",
      name: "Local",
      rootPath: root,
      localProjectId: "project-2",
      allocationKey: null,
      createdBySessionId: null,
    }

    await expect(
      resolveStudioLocalGitWorkspaceRoot({
        project,
        workspace: sandboxWorkspace,
      })
    ).rejects.toThrow("selected local project workspaces")
    await expect(
      resolveStudioLocalGitWorkspaceRoot({
        project,
        workspace: mismatchedLocalWorkspace,
      })
    ).rejects.toThrow("not bound to the requested project")
  })
})
