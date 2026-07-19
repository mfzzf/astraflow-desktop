// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { parseSlashCommandText } from "@/lib/agent/composer-types"
import {
  CODEX_COLLABORATION_MODE_CONFIG_ID,
  CODEX_PLAN_COLLABORATION_MODE,
  getCodexAcpRuntimeCommands,
  getCodexFastMode,
  getCodexPlanMode,
} from "@/lib/agent/acp/codex-features"
import {
  ASTRAFLOW_MODE_CONFIG_ID,
  ASTRAFLOW_PLAN_MODE,
  getAstraFlowPlanMode,
} from "@/lib/agent/acp/astraflow-features"
import { getAstraFlowPiRuntimeCommands } from "@/lib/agent/pi-packages"
import {
  getStaticAcpRuntimeCommands,
  materializeAcpRuntimeCommands,
  mergeAcpRuntimeCommands,
} from "@/lib/agent/acp/runtime-commands"
import { dictionaries } from "@/lib/i18n"
import {
  formatSlashSkillPrompt,
  getBuiltinSlashCommands,
  getSlashCommandTokenAtCursor,
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
    expect(names).toContain("export")
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
    expect(names).toContain("export")
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
    expect(parseSlashCommandText("/$anthropic-docs hooks")).toEqual({
      name: "$anthropic-docs",
      args: "hooks",
    })
    expect(getSlashCommandTokenAtCursor("/$anth", 7)).toEqual({
      start: 0,
      end: 6,
      prefix: "$anth",
    })
    expect(isBuiltinSlashCommandName("checkpoint")).toBe(true)
    expect(isBuiltinSlashCommandName("export")).toBe(true)
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

  test("exposes every builtin command from the pinned Codex ACP adapter", () => {
    const commands = getCodexAcpRuntimeCommands()

    expect(commands.map((command) => command.name)).toEqual([
      "plan",
      "mcp",
      "skills",
      "status",
      "review",
      "review-branch",
      "review-commit",
      "compact",
      "goal",
      "logout",
    ])
    expect(commands.find((command) => command.name === "plan")?.meta).toEqual({
      commandAction: {
        kind: "setConfigOption",
        configId: CODEX_COLLABORATION_MODE_CONFIG_ID,
        value: CODEX_PLAN_COLLABORATION_MODE,
        resetValue: "default",
        presentation: "state",
      },
    })
    expect(commands.find((command) => command.name === "goal")?.inputHint).toBe(
      "[<objective>|clear|pause|resume]"
    )
  })

  test("reads Codex Plan and Fast state from ACP config options", () => {
    expect(
      getCodexPlanMode([
        {
          id: CODEX_COLLABORATION_MODE_CONFIG_ID,
          name: "Collaboration mode",
          type: "select",
          currentValue: CODEX_PLAN_COLLABORATION_MODE,
          options: [
            { value: "default", name: "Default" },
            { value: CODEX_PLAN_COLLABORATION_MODE, name: "Plan" },
          ],
        },
      ])
    ).toEqual({ active: true, available: true })
    expect(
      getCodexFastMode([
        {
          id: "fast-mode",
          name: "Fast mode",
          type: "boolean",
          currentValue: true,
        },
      ])
    ).toEqual({ active: true, available: true })
  })

  test("reads AstraFlow Plan state from ACP modes and config options", () => {
    expect(
      getAstraFlowPlanMode([
        {
          id: ASTRAFLOW_MODE_CONFIG_ID,
          name: "Session mode",
          category: "mode",
          type: "select",
          currentValue: ASTRAFLOW_PLAN_MODE,
          options: [
            { value: "default", name: "Agent" },
            { value: ASTRAFLOW_PLAN_MODE, name: "Plan" },
          ],
        },
      ])
    ).toEqual({ active: true, available: true })
  })

  test("materializes dynamic commands before the first prompt for every ACP runtime", async () => {
    for (const runtimeId of ["codex", "claude-code", "opencode"]) {
      const calls: string[] = []
      const command = {
        name: `${runtimeId}-workspace-command`,
        description: "Workspace command",
        inputHint: "arguments",
        source: "runtime" as const,
        runtimeId,
      }

      await expect(
        materializeAcpRuntimeCommands({
          announcedCommands: [],
          runtimeId,
          sessionId: "session-1",
          prepare: async () => {
            calls.push("prepare")
          },
          activate: async () => {
            calls.push("activate")
            return {
              phase: "session" as const,
              session: { availableCommands: [command] },
            }
          },
        })
      ).resolves.toEqual([command])
      expect(calls).toEqual(["prepare", "activate"])
    }
  })

  test("keeps exact runtime commands ahead of static recovery commands", () => {
    expect(
      getStaticAcpRuntimeCommands("claude-code").map((command) => command.name)
    ).toEqual(["compact"])
    expect(
      getStaticAcpRuntimeCommands("opencode").map((command) => command.name)
    ).toEqual(["compact"])
    expect(
      mergeAcpRuntimeCommands([
        {
          name: "/compact",
          description: "Provider compact",
          source: "runtime",
          runtimeId: "opencode",
          meta: { provider: true },
        },
        ...getStaticAcpRuntimeCommands("opencode"),
        {
          name: "review",
          description: "Provider review",
          source: "runtime",
          runtimeId: "opencode",
        },
      ])
    ).toEqual([
      {
        name: "compact",
        description: "Provider compact",
        source: "runtime",
        runtimeId: "opencode",
        meta: { provider: true },
      },
      {
        name: "review",
        description: "Provider review",
        source: "runtime",
        runtimeId: "opencode",
      },
    ])
  })
})
