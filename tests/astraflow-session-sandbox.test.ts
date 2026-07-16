// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  createSessionSandboxUploadPath,
  describeAttachmentForPrompt,
} from "@/lib/astraflow-session-sandbox"
import type { StudioSessionFile } from "@/lib/studio-types"

describe("AstraFlow session Sandbox attachments", () => {
  test("places uploaded attachments in the visible workspace attachments directory", () => {
    const file: StudioSessionFile = {
      id: "file-1",
      sessionId: "session-1",
      messageId: "message-1",
      kind: "attachment",
      originalName: "团建投票问卷.html",
      mimeType: "text/html",
      size: 15_000,
      storagePath: "attachments/session-1/message-1/file-1.html",
      sandboxPath: null,
      sourceToolCallId: null,
      savedAt: null,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z",
    }

    expect(
      createSessionSandboxUploadPath(file, "/workspace/project-a")
    ).toBe(
      "/workspace/project-a/attachments/message-1/file-1-团建投票问卷.html"
    )
  })

  test("tells the Agent to use the materialized workspace path directly", () => {
    const prompt = describeAttachmentForPrompt({
      id: "file-1",
      type: "file",
      name: "团建投票问卷.html",
      mimeType: "text/html",
      size: 15_000,
      sandboxPath:
        "/workspace/project-a/attachments/message-1/file-1-团建投票问卷.html",
    })

    expect(prompt).toContain(
      "sandbox_path: /workspace/project-a/attachments/message-1/file-1-团建投票问卷.html"
    )
    expect(prompt).toContain("Use sandbox_path directly")
  })
})
