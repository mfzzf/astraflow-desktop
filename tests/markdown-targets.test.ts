// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  isSessionWorkspaceFileHref,
  resolveRelativeSessionWorkspaceFilePath,
} from "@/components/studio-chat/markdown-targets"

describe("local session markdown file targets", () => {
  const sessionId = "c8e2223a-22f4-489d-9b03-f7e5bf6a3727"
  const macWorkspace =
    "/Users/zzf/Library/Application Support/Electron/sandbox-workspaces/c8e2223a-22f4-489d-9b03-f7e5bf6a3727"

  test("resolves a bare generated filename inside the session workspace", () => {
    expect(
      resolveRelativeSessionWorkspaceFilePath(
        "presentation.pptx",
        sessionId,
        macWorkspace
      )
    ).toBe(`${macWorkspace}/presentation.pptx`)
  })

  test("removes the matching sandbox-workspaces/session prefix", () => {
    const href = `sandbox-workspaces/${sessionId}/presentation.pptx`

    expect(isSessionWorkspaceFileHref(href, sessionId)).toBe(true)
    expect(
      resolveRelativeSessionWorkspaceFilePath(href, sessionId, macWorkspace)
    ).toBe(`${macWorkspace}/presentation.pptx`)
  })

  test("rejects traversal and another session's workspace", () => {
    expect(
      resolveRelativeSessionWorkspaceFilePath(
        "../presentation.pptx",
        sessionId,
        macWorkspace
      )
    ).toBeNull()
    expect(
      resolveRelativeSessionWorkspaceFilePath(
        "sandbox-workspaces/another-session/presentation.pptx",
        sessionId,
        macWorkspace
      )
    ).toBeNull()
  })

  test("preserves Windows path separators from the resolved workspace", () => {
    const windowsWorkspace = `C:\\Users\\zzf\\AppData\\Roaming\\AstraFlow\\sandbox-workspaces\\${sessionId}`

    expect(
      resolveRelativeSessionWorkspaceFilePath(
        "slides/presentation.pptx",
        sessionId,
        windowsWorkspace
      )
    ).toBe(`${windowsWorkspace}\\slides\\presentation.pptx`)
  })
})
