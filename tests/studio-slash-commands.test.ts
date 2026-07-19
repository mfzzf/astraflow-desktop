// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { parseSlashCommandText } from "@/lib/agent/composer-types"
import { getAstraFlowPiRuntimeCommands } from "@/lib/agent/pi-packages"
import { dictionaries } from "@/lib/i18n"
import {
  formatSlashSkillPrompt,
  getBuiltinSlashCommands,
  isBuiltinSlashCommandName,
  mergeSlashCommands,
} from "@/components/studio-chat/composer-utils"
import {
  getSessionTitleSummarySource,
  recoverSessionTitleFromUserPrompt,
  shouldAdoptRuntimeSessionTitle,
} from "@/lib/studio-session-title"

describe("studio slash commands", () => {
  test("exposes Pi tools, package, compact, and history commands for AstraFlow", () => {
    const commands = getBuiltinSlashCommands(dictionaries.en, true, true)
    const names = commands.map((command) => command.name)

    expect(names).toContain("compact")
    expect(names).toContain("tools")
    expect(names).toContain("packages")
    expect(names).toContain("reload")
    expect(names).toContain("session")
    expect(names).toContain("undo")
    expect(names).toContain("redo")
    expect(names).toContain("checkpoint")
    expect(names).toContain("tree")
    expect(names).toContain("rewind")
    expect(
      commands.find((command) => command.name === "rewind")?.inputHint
    ).toBe("<assistant message id>")
  })

  test("does not advertise AstraFlow-only commands for other runtimes", () => {
    const names = getBuiltinSlashCommands(dictionaries.en, false, false).map(
      (command) => command.name
    )

    expect(names).toContain("session")
    expect(names).not.toContain("compact")
    expect(names).not.toContain("tools")
    expect(names).not.toContain("undo")
  })

  test("preserves multi-word command arguments", () => {
    expect(
      parseSlashCommandText(
        "/compact Keep API decisions and discard verbose tool output"
      )
    ).toEqual({
      name: "compact",
      args: "Keep API decisions and discard verbose tool output",
    })
    expect(parseSlashCommandText("/rewind assistant-message-42")).toEqual({
      name: "rewind",
      args: "assistant-message-42",
    })
    expect(isBuiltinSlashCommandName("checkpoint")).toBe(true)
  })

  test("serializes a rendered Skill chip back into slash invocation text", () => {
    expect(formatSlashSkillPrompt(["xlsx"], "整理这份销售数据")).toBe(
      "/xlsx 整理这份销售数据"
    )
    expect(formatSlashSkillPrompt(["xlsx", "pdf"], "整理并导出")).toBe(
      "/xlsx /pdf 整理并导出"
    )
    expect(formatSlashSkillPrompt(["xlsx"], "")).toBe("/xlsx")
    expect(formatSlashSkillPrompt([], "普通消息")).toBe("普通消息")
  })

  test("keeps native skill preambles out of conversation titles", () => {
    expect(
      getSessionTitleSummarySource({
        prompt: "修复会话总结",
        skillSlugs: ["frontend-design"],
      })
    ).toBe("修复会话总结")
    expect(
      getSessionTitleSummarySource({ prompt: "", skillSlugs: ["xlsx"] })
    ).toBe("/xlsx")
    expect(recoverSessionTitleFromUserPrompt("/xlsx /pdf 整理并导出")).toBe(
      "整理并导出"
    )
    expect(shouldAdoptRuntimeSessionTitle("New chat", "Fix title bug")).toBe(
      true
    )
    expect(
      shouldAdoptRuntimeSessionTitle(
        "New chat",
        "AstraFlow Skills are registered through the Codex native skill system"
      )
    ).toBe(false)
    expect(
      shouldAdoptRuntimeSessionTitle("修复会话总结", "Different runtime title")
    ).toBe(false)
  })

  test("lets an advertised runtime command override the same builtin", () => {
    const merged = mergeSlashCommands(
      [
        {
          name: "compact",
          description: "runtime duplicate",
          source: "runtime",
          runtimeId: "astraflow",
        },
        {
          name: "parallel-review",
          description: "package prompt",
          source: "runtime",
          runtimeId: "astraflow",
        },
      ],
      getBuiltinSlashCommands(dictionaries.en, true, true)
    )

    expect(merged.filter((command) => command.name === "compact")).toHaveLength(
      1
    )
    expect(merged.find((command) => command.name === "compact")?.source).toBe(
      "runtime"
    )
    expect(merged.map((command) => command.name)).toContain("parallel-review")
  })

  test("exposes installed Pi package prompts and native skills as runtime commands", () => {
    const commands = getAstraFlowPiRuntimeCommands()
    const names = commands.map((command) => command.name)

    expect(names).toContain("parallel-review")
    expect(names).toContain("review-loop")
    expect(names).toContain("skill:pi-subagents")
    expect(
      commands.every(
        (command) =>
          command.source === "runtime" && command.runtimeId === "astraflow"
      )
    ).toBe(true)
  })
})
