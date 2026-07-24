// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  getActivityLabel,
  isMcpToolActivity,
} from "@/components/studio-message-parts/tool-labels"
import {
  getProtocolToolIconName,
  getProtocolToolStatusIconName,
} from "@/components/studio-message-parts/tool"
import {
  getPermissionDecisionOptions,
  getPermissionOptionDisplayName,
} from "@/components/studio-message-parts/permission"
import { dictionaries } from "@/lib/i18n"
import type {
  StudioMessageActivity,
  StudioPermissionOption,
} from "@/lib/studio-types"
import type { StudioPermissionPart } from "@/components/studio-message-parts/types"

function activity(
  toolName: string,
  input: Record<string, unknown>,
  status: StudioMessageActivity["status"] = "complete"
): StudioMessageActivity {
  return {
    id: `${toolName}-${status}`,
    toolName,
    status,
    input: JSON.stringify(input),
    output: "",
    error: null,
  }
}

describe("studio tool labels", () => {
  test("localizes Pi file and command tools", () => {
    expect(
      getActivityLabel(activity("bash", { command: "bun test" }), dictionaries.zh)
    ).toBe("已执行命令 bun test")
    expect(
      getActivityLabel(activity("read", { path: "src/app.ts" }), dictionaries.zh)
    ).toBe("已读取文件 src/app.ts")
    expect(
      getActivityLabel(
        activity("write", { path: "src/app.ts" }, "running"),
        dictionaries.en
      )
    ).toBe("Writing file src/app.ts")
  })

  test("labels Pi commands from complete raw parameters during streaming", () => {
    const commandActivity: StudioMessageActivity = {
      ...activity("bash", {}, "running"),
      input: '{"',
      rawInput: {
        command: "printf 'first'\nprintf 'second'",
        timeout: 65,
      },
    }

    expect(getActivityLabel(commandActivity, dictionaries.en)).toBe(
      "Running command printf 'first'\nprintf 'second'"
    )
  })

  test("localizes Pi skill tools without exposing internal names", () => {
    expect(
      getActivityLabel(
        activity("read_skill_file", {
          slug: "pptx",
          path: "templates/base.js",
        }),
        dictionaries.zh
      )
    ).toBe("已读取技能文件 pptx/templates/base.js")
    expect(
      getActivityLabel(
        activity("prepare_skill_sandbox", { slug: "pptx" }),
        dictionaries.zh
      )
    ).toBe("已准备技能沙箱 pptx")
  })

  test("localizes context compaction lifecycle", () => {
    expect(
      getActivityLabel(
        activity("context_compaction", {}, "running"),
        dictionaries.zh
      )
    ).toBe("正在压缩上下文")
    expect(
      getActivityLabel(
        activity("context_compaction", {}, "complete"),
        dictionaries.en
      )
    ).toBe("Context compacted")
    expect(
      getActivityLabel(
        activity("context_compaction", {}, "error"),
        dictionaries.zh
      )
    ).toBe("上下文压缩失败")
  })

  test("prefers AstraFlow ACP summaries and ignores raw protocol titles", () => {
    expect(
      getActivityLabel(
        {
          ...activity("write", { path: "result.txt" }),
          title: "write",
          meta: {
            astraflow: { toolSummary: "Wrote result.txt" },
          },
        },
        dictionaries.en
      )
    ).toBe("Wrote result.txt")
    expect(
      getActivityLabel(
        {
          ...activity("studio_list_image_models", {}),
          title: "studio_list_image_models",
        },
        dictionaries.en
      )
    ).toBe("Listed image models")
  })

  test("provides localized names for badges and detail headers", () => {
    expect(dictionaries.zh.studioToolDisplayName("write")).toBe("写入文件")
    expect(
      dictionaries.zh.studioToolDisplayName("request_user_input")
    ).toBe("请求用户输入")
    expect(dictionaries.en.studioToolDisplayName("read_skill_file")).toBe(
      "Read skill file"
    )
    expect(dictionaries.zh.studioToolDisplayName("subagent")).toBe(
      "委派子任务"
    )
  })

  test("uses ACP MCP metadata and protocol tool kinds", () => {
    const mcpActivity: StudioMessageActivity = {
      ...activity("call_tool", {}, "running"),
      title: "mcp:linear.get_issue",
      kind: "execute",
      rawInput: { server: "linear", tool: "get_issue" },
      meta: { is_mcp_tool_call: true },
    }

    expect(isMcpToolActivity(mcpActivity)).toBe(true)
    expect(getProtocolToolIconName(mcpActivity)).toBe("mcp")
    expect(getActivityLabel(mcpActivity, dictionaries.en)).toBe(
      "Calling MCP tool linear.get_issue"
    )
    expect(
      getProtocolToolIconName({
        ...activity("change_mode", {}, "running"),
        kind: "switch_mode",
      })
    ).toBe("switch_mode")
  })

  test("keeps pending approval visually distinct from active execution", () => {
    const base: StudioMessageActivity = {
      ...activity("bash", { command: "bun test" }, "running"),
      kind: "execute",
    }

    expect(
      getProtocolToolStatusIconName({ ...base, acpStatus: "pending" })
    ).toBe("pending")
    expect(
      getProtocolToolStatusIconName({ ...base, acpStatus: "in_progress" })
    ).toBe("execute")
  })

  test("keeps Claude Plan approval choices distinct in Chinese", () => {
    const part = {
      toolName: "ExitPlanMode",
    } as StudioPermissionPart
    const label = (optionId: string, kind: StudioPermissionOption["kind"]) =>
      getPermissionOptionDisplayName({
        option: { optionId, kind, name: optionId },
        part,
        t: dictionaries.zh,
      })

    expect(label("auto", "allow_always")).toBe("同意，使用自动模式")
    expect(label("acceptEdits", "allow_always")).toBe(
      "同意，自动接受编辑"
    )
    expect(label("default", "allow_once")).toBe("同意，手动批准编辑")
    expect(label("plan", "reject_once")).toBe("不同意，继续规划")
  })

  test("keeps every provider rejection and its original order", () => {
    const options: StudioPermissionOption[] = [
      {
        optionId: "reject-network-rule",
        kind: "reject_always",
        name: "Reject and remember this host",
      },
      { optionId: "allow", kind: "allow_once", name: "Allow once" },
      { optionId: "reject", kind: "reject_once", name: "Reject" },
    ]

    expect(getPermissionDecisionOptions(options)).toEqual({
      feedbackRejectOption: options[2],
      immediateOptions: [options[0], options[1]],
    })
    expect(
      getPermissionOptionDisplayName({
        option: options[0],
        part: { toolName: "execute" } as StudioPermissionPart,
        t: dictionaries.zh,
      })
    ).toBe("Reject and remember this host")
  })
})
