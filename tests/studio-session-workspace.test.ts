// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { resolveStudioSessionWorkspacePath } from "@/lib/studio-session-workspace"
import type { StudioLocalProject } from "@/lib/studio-types"

const temporaryPaths: string[] = []

function createProject(path: string): StudioLocalProject {
  return {
    id: "project-1",
    name: "Workspace",
    path,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    lastOpenedAt: null,
  }
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe("studio session workspace resolution", () => {
  test("uses the selected local project as the session working directory", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "astraflow-project-"))
    temporaryPaths.push(projectPath)

    expect(
      resolveStudioSessionWorkspacePath({
        project: createProject(projectPath),
        projectId: "project-1",
        sessionId: "session-1",
      })
    ).toBe(projectPath)
  })

  test("allows an intentionally unbound session to use its default workspace", () => {
    expect(
      resolveStudioSessionWorkspacePath({
        project: null,
        projectId: null,
        sessionId: "session-1",
      })
    ).toBeNull()
  })

  test("fails closed when a bound project is missing or is not a directory", () => {
    expect(() =>
      resolveStudioSessionWorkspacePath({
        project: null,
        projectId: "project-1",
        sessionId: "session-1",
      })
    ).toThrow("no longer registered")

    const testRoot = mkdtempSync(join(tmpdir(), "astraflow-project-file-"))
    const filePath = join(testRoot, "workspace.txt")
    temporaryPaths.push(testRoot)
    writeFileSync(filePath, "not a directory")

    expect(() =>
      resolveStudioSessionWorkspacePath({
        project: createProject(filePath),
        projectId: "project-1",
        sessionId: "session-1",
      })
    ).toThrow("not a directory")
  })
})
