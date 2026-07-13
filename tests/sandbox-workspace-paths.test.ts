// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  getSandboxWorkspaceOutputRoot,
  normalizeSandboxWorkspaceRoot,
  resolveSandboxWorkspacePath,
} from "@/lib/sandbox-workspace-paths"

describe("sandbox workspace paths", () => {
  const workspaceRoot = "/workspace/project-a"

  test("uses the selected workspace as the root for relative paths", () => {
    expect(
      resolveSandboxWorkspacePath({ path: "src/index.ts", workspaceRoot })
    ).toBe("/workspace/project-a/src/index.ts")
    expect(
      resolveSandboxWorkspacePath({ path: "/", workspaceRoot })
    ).toBe(workspaceRoot)
    expect(getSandboxWorkspaceOutputRoot(workspaceRoot)).toBe(
      "/workspace/project-a/outputs"
    )
  })

  test("rejects workspace traversal and sibling workspace paths", () => {
    expect(() =>
      resolveSandboxWorkspacePath({ path: "../project-b/secret.txt", workspaceRoot })
    ).toThrow("inside workspace root")
    expect(() =>
      resolveSandboxWorkspacePath({
        path: "/workspace/project-b/secret.txt",
        workspaceRoot,
      })
    ).toThrow("inside workspace root")
  })

  test("allows runtime skill reads without turning private paths into outputs", () => {
    expect(
      resolveSandboxWorkspacePath({
        allowPrivateRead: true,
        path: "/home/user/astraflow/skills/slides/scripts/render.py",
        workspaceRoot,
      })
    ).toBe("/home/user/astraflow/skills/slides/scripts/render.py")
    expect(() =>
      resolveSandboxWorkspacePath({
        path: "/home/user/astraflow/skills/slides/output.pptx",
        workspaceRoot,
      })
    ).toThrow("inside workspace root")
  })

  test("requires sandbox workspaces to live below the gateway root", () => {
    expect(normalizeSandboxWorkspaceRoot("/workspace/project-a/../project-a")).toBe(
      workspaceRoot
    )
    expect(() => normalizeSandboxWorkspaceRoot("/home/user/astraflow")).toThrow(
      "must stay under /workspace"
    )
  })

  test("canonicalizes a trailing slash before resolving child paths", () => {
    expect(normalizeSandboxWorkspaceRoot("/workspace/project-a/")).toBe(
      "/workspace/project-a"
    )
    expect(
      resolveSandboxWorkspacePath({
        path: "src/index.ts",
        workspaceRoot: "/workspace/project-a/",
      })
    ).toBe("/workspace/project-a/src/index.ts")
  })
})
