// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  getSandboxWorkspaceAttachmentsRoot,
  getSandboxWorkspaceOutputRoot,
  normalizeSandboxReadableFilePath,
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
    expect(getSandboxWorkspaceAttachmentsRoot(workspaceRoot)).toBe(
      "/workspace/project-a/attachments"
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

  test("allows conventional external Sandbox artifact roots", () => {
    expect(
      normalizeSandboxReadableFilePath({
        gatewayRoot: "/workspace",
        path: "/tmp/rendered/report.pptx",
      })
    ).toBe("/tmp/rendered/report.pptx")
    expect(
      normalizeSandboxReadableFilePath({
        gatewayRoot: "/workspace",
        path: "/mnt/data/report.csv",
      })
    ).toBe("/mnt/data/report.csv")
  })

  test("does not expose runtime-private or arbitrary system files", () => {
    expect(() =>
      normalizeSandboxReadableFilePath({
        gatewayRoot: "/workspace",
        path: "/opt/astraflow/workspace-gateway/src/server.mjs",
      })
    ).toThrow("must stay inside")
    expect(() =>
      normalizeSandboxReadableFilePath({
        gatewayRoot: "/workspace",
        path: "/etc/passwd",
      })
    ).toThrow("must stay inside")
  })
})
