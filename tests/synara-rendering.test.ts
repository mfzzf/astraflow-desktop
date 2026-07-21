import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  formatSynaraTurnDuration,
  formatSynaraWorkingDuration,
} from "@/components/studio-message-parts/activity"
import { getAutomationCopy } from "@/components/automations/automation-copy"
import {
  deriveSynaraReadableCommandDisplay,
  resolveSynaraCommandVisualKind,
} from "@/lib/synara-tool-call-label"
import {
  computeStudioMessageTrailFocusedIndex,
  computeStudioMessageTrailGeometry,
  computeStudioMessageTrailWeights,
  deriveStudioMessageTrailItems,
} from "@/lib/studio-message-trail"
import { shouldShowStreamingThinking } from "@/lib/studio-streaming-state"
import { buildPermissionNotificationCopy } from "@/lib/studio-notification-copy"
import type { StudioMessagePart } from "@/lib/studio-types"

describe("Synara turn timing", () => {
  test("uses tenths below ten seconds for settled turns", () => {
    assert.equal(formatSynaraTurnDuration(9_400), "9.4s")
    assert.equal(formatSynaraTurnDuration(875), "875ms")
    assert.equal(formatSynaraTurnDuration(10_400), "10s")
  })

  test("uses a whole-second counting clock while working", () => {
    assert.equal(formatSynaraWorkingDuration(1_999), "1s")
    assert.equal(formatSynaraWorkingDuration(61_000), "1m 1s")
  })
})

describe("Synara command presentation", () => {
  test("unwraps shell calls and describes directory listings", () => {
    assert.deepEqual(
      deriveSynaraReadableCommandDisplay("/bin/zsh -lc 'ls -la'"),
      {
        verb: "Listed",
        target: "directory",
        fullCommand: "/bin/zsh -lc 'ls -la'",
      }
    )
    assert.equal(
      resolveSynaraCommandVisualKind("/bin/zsh -lc 'ls -la'"),
      "inspect"
    )
  })

  test("keeps execution commands on the terminal visual", () => {
    assert.deepEqual(deriveSynaraReadableCommandDisplay("bun run typecheck"), {
      verb: "Ran",
      target: "bun run typecheck",
      fullCommand: "bun run typecheck",
    })
    assert.equal(
      resolveSynaraCommandVisualKind("bun run typecheck"),
      "terminal"
    )
  })
})

describe("Synara message trail", () => {
  test("projects user turns with the final assistant preview", () => {
    const items = deriveStudioMessageTrailItems([
      {
        id: "user-1",
        role: "user",
        content: "  First   request ",
        attachments: [],
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Starting work",
        attachments: [],
      },
      {
        id: "assistant-2",
        role: "assistant",
        content: "Finished response",
        attachments: [],
      },
      {
        id: "user-2",
        role: "user",
        content: "Second request",
        attachments: [],
      },
    ])

    assert.deepEqual(items, [
      {
        id: "user-1",
        ordinal: 1,
        preview: "First request",
        responsePreview: "Finished response",
        attachmentCount: 0,
      },
      {
        id: "user-2",
        ordinal: 2,
        preview: "Second request",
        responsePreview: "",
        attachmentCount: 0,
      },
    ])
  })

  test("focuses and magnifies the nearest trail tick", () => {
    const geometry = computeStudioMessageTrailGeometry({ count: 3 })

    assert.ok(geometry)
    assert.equal(
      computeStudioMessageTrailFocusedIndex(geometry.centerYs[1]!, geometry),
      1
    )
    const weights = computeStudioMessageTrailWeights(
      geometry.centerYs,
      geometry.centerYs[1]!,
      10
    )
    assert.equal(weights[1], 1)
    assert.ok(weights[0]! < weights[1]!)
    assert.ok(weights[2]! < weights[1]!)
  })
})

describe("Synara streaming state", () => {
  test("shows Thinking whenever the stream is waiting for its next active part", () => {
    assert.equal(
      shouldShowStreamingThinking({
        streaming: true,
        hasActiveStreamingPart: false,
      }),
      true
    )
    assert.equal(
      shouldShowStreamingThinking({
        streaming: true,
        hasActiveStreamingPart: true,
      }),
      false
    )
    assert.equal(
      shouldShowStreamingThinking({
        streaming: false,
        hasActiveStreamingPart: false,
      }),
      false
    )
  })
})

describe("Synara automation copy", () => {
  test("keeps the migrated automation surfaces bilingual", () => {
    assert.deepEqual(
      {
        title: getAutomationCopy("en").title,
        current: getAutomationCopy("en").current,
        details: getAutomationCopy("en").details,
      },
      { title: "Automations", current: "Current", details: "Details" }
    )
    assert.deepEqual(
      {
        title: getAutomationCopy("zh").title,
        current: getAutomationCopy("zh").current,
        details: getAutomationCopy("zh").details,
      },
      { title: "自动化", current: "当前", details: "详细信息" }
    )
  })
})

describe("desktop approval notifications", () => {
  test("summarizes the pending tool and exposes localized actions", () => {
    const part: Extract<StudioMessagePart, { type: "permission" }> = {
      type: "permission",
      id: "permission-1",
      toolName: "run_command",
      input: '{"command":"bun run typecheck"}',
      status: "pending",
      options: [],
      selectedOptionId: null,
    }

    assert.deepEqual(
      buildPermissionNotificationCopy({
        locale: "zh",
        part,
        sessionTitle: "修复设置功能",
      }),
      {
        title: "工具调用需要批准",
        body:
          '修复设置功能 · run_command · {"command":"bun run typecheck"}',
        allowLabel: "允许一次",
        denyLabel: "拒绝",
      }
    )
  })
})
