// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { getVisibleComposerSubagents } from "@/components/studio-chat/composer-subagent-strip"
import type { StudioStatusSubagentSummary } from "@/components/studio-chat/status-panel"

function summary(
  taskId: string,
  messageId: string,
  status: StudioStatusSubagentSummary["status"]
) {
  return { taskId, messageId, status } as StudioStatusSubagentSummary
}

describe("Synara-style composer subagent strip", () => {
  test("keeps active siblings from the live assistant turn", () => {
    const visible = getVisibleComposerSubagents([
      summary("done-sibling", "live-turn", "complete"),
      summary("active-sibling", "live-turn", "running"),
      summary("old-run", "old-turn", "complete"),
    ])

    expect(visible.map((item) => item.taskId)).toEqual([
      "done-sibling",
      "active-sibling",
    ])
  })

  test("retires the strip after all subagents finish", () => {
    expect(
      getVisibleComposerSubagents([
        summary("first", "turn", "complete"),
        summary("second", "turn", "cancelled"),
      ])
    ).toEqual([])
  })
})
