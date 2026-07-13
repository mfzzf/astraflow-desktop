// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { resolveSidePanelRootDirectory } from "@/components/studio-chat/side-panel-utils"

describe("side panel root directory", () => {
  test("keeps a generated file inside its session workspace root", () => {
    const workspace =
      "/Users/zzf/Library/Application Support/Electron/sandbox-workspaces/c8e2223a-22f4-489d-9b03-f7e5bf6a3727"

    expect(
      resolveSidePanelRootDirectory(
        `${workspace}/create_slide.js`,
        workspace
      )
    ).toBe(workspace)
  })

  test("uses the file parent when the file is outside the selected project", () => {
    expect(
      resolveSidePanelRootDirectory(
        "/Users/zzf/Library/Application Support/Electron/sandbox-workspaces/session/presentation.pptx",
        "/Users/zzf/projects/example"
      )
    ).toBe(
      "/Users/zzf/Library/Application Support/Electron/sandbox-workspaces/session"
    )
  })

  test("keeps project files rooted at the selected project", () => {
    expect(
      resolveSidePanelRootDirectory(
        "/Users/zzf/projects/example/slides/create_slide.js",
        "/Users/zzf/projects/example"
      )
    ).toBe("/Users/zzf/projects/example")
  })

  test("supports Windows paths case-insensitively", () => {
    expect(
      resolveSidePanelRootDirectory(
        "C:\\Users\\ZZF\\Project\\slides\\create_slide.js",
        "c:\\users\\zzf\\project"
      )
    ).toBe("c:\\users\\zzf\\project")
  })
})
