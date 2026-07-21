// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  selectStudioDesktopTasks,
  summarizeStudioDesktopTask,
} from "@/lib/studio-desktop-tasks"
import type { StudioMessage, StudioSession } from "@/lib/studio-types"

function session(
  input: Partial<StudioSession> & Pick<StudioSession, "id" | "isRunning">
) {
  return {
    mode: "chat",
    title: input.id,
    archivedAt: null,
    createdAt: "2026-07-21T08:00:00.000Z",
    updatedAt: "2026-07-21T08:00:00.000Z",
    ...input,
  } as StudioSession
}

describe("Studio desktop task summaries", () => {
  test("surfaces a pending tool approval as the active tray detail", () => {
    const currentSession = session({
      id: "permission-session",
      isRunning: true,
      title: "修复通知",
    })
    const messages = [
      {
        id: "assistant-1",
        activities: [],
        parts: [
          {
            id: "permission-1",
            type: "permission",
            toolName: "run_command",
            input: '{"command":"bun run lint"}',
            status: "pending",
            options: [],
            selectedOptionId: null,
          },
        ],
      },
    ] as unknown as StudioMessage[]

    const summary = summarizeStudioDesktopTask(currentSession, messages, "zh")

    expect(summary.task).toMatchObject({
      id: "permission-session",
      status: "waiting",
      detail: "等待批准 · 执行命令",
      path: "/studio/chat/permission-session",
    })
    expect(summary.pendingPermission?.id).toBe("permission-1")
  })

  test("keeps running tasks ahead of newer recent tasks", () => {
    const running = session({
      id: "running",
      isRunning: true,
      updatedAt: "2026-07-21T08:00:00.000Z",
    })
    const recent = session({
      id: "recent",
      isRunning: false,
      updatedAt: "2026-07-21T09:00:00.000Z",
    })

    const summaries = selectStudioDesktopTasks(
      [recent, running],
      new Map(),
      "en"
    )

    expect(summaries.map((summary) => summary.task.id)).toEqual([
      "running",
      "recent",
    ])
    expect(summaries.map((summary) => summary.task.status)).toEqual([
      "running",
      "recent",
    ])
  })
})
